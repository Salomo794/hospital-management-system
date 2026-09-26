const { loadEnvironment, serverDirectory } = require('./environment');
loadEnvironment();

const {
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUSES,
  PAYMENTS_TABLE_COLUMNS,
  isPaymentMethod,
  paymentMethodConstraint,
  paymentMethodValueList,
  paymentStatusConstraint,
} = require('./paymentMethods');

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const configuredPath = process.env.DB_PATH || path.join(serverDirectory, 'hospital.db');
const dbPath = configuredPath === ':memory:'
  ? configuredPath
  : (path.isAbsolute(configuredPath) ? configuredPath : path.resolve(serverDirectory, configuredPath));
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
if (dbPath !== ':memory:') {
  sqlite.pragma('journal_mode = WAL');
}

function tableExists(table) {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some(candidate => candidate.name === column);
}

function createIndexIfPossible(sql) {
  try {
    sqlite.exec(sql);
  } catch (error) {
    console.warn(`[database] Could not create index: ${error.message}`);
  }
}

function createRequiredIndex(sql, invariant) {
  try {
    sqlite.exec(sql);
  } catch (error) {
    throw new Error(`[database] Could not enforce ${invariant}: ${error.message}`);
  }
}

function assertNoActiveCheckinDuplicates() {
  const duplicates = sqlite.prepare(`
    SELECT patient_id, checkin_date, COUNT(*) AS duplicate_count
    FROM checkins
    WHERE status IN ('waiting', 'in_consultation')
    GROUP BY patient_id, checkin_date
    HAVING COUNT(*) > 1
    ORDER BY patient_id, checkin_date
    LIMIT 10
  `).all();
  if (duplicates.length > 0) {
    const summary = duplicates
      .map(row => `patient ${row.patient_id} on ${row.checkin_date || 'an unknown date'} (${row.duplicate_count} rows)`)
      .join('; ');
    throw new Error(
      `[database] Cannot enforce one active check-in per patient per day. `
      + `Resolve duplicate legacy check-ins (${summary}) and restart.`
    );
  }

  const undated = sqlite.prepare(`
    SELECT id
    FROM checkins
    WHERE status IN ('waiting', 'in_consultation') AND checkin_date IS NULL
    ORDER BY id
    LIMIT 10
  `).all();
  if (undated.length > 0) {
    throw new Error(
      '[database] Cannot enforce active check-in dates because legacy check-ins have no valid checkin_date '
      + `(check-in IDs: ${undated.map(row => row.id).join(', ')}). Repair those rows and restart.`
    );
  }
}

function assertNoActiveAdmissionDuplicates() {
  const duplicates = sqlite.prepare(`
    SELECT patient_id, COUNT(*) AS duplicate_count
    FROM admissions
    WHERE status = 'admitted'
    GROUP BY patient_id
    HAVING COUNT(*) > 1
    ORDER BY patient_id
    LIMIT 10
  `).all();
  if (duplicates.length > 0) {
    const summary = duplicates
      .map(row => `patient ${row.patient_id} (${row.duplicate_count} rows)`)
      .join('; ');
    throw new Error(
      '[database] Cannot enforce one active admission per patient. '
      + `Resolve duplicate legacy admissions (${summary}) and restart.`
    );
  }
}

// SQLite cannot ALTER a CHECK constraint in place, and the status column is
// part of one, so widening the accepted payment methods means rebuilding the
// payments table. The rebuild is driven by the canonical column list so rows
// are never lost, and it is a no-op once the stored table already matches.
function paymentsTableIsCurrent() {
  const table = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'")
    .get();
  if (!table || typeof table.sql !== 'string') return true;
  if (!PAYMENT_METHOD_VALUES.every(value => table.sql.includes(`'${value}'`))) return false;
  // A table predating settlement states has no way to tell an approved charge
  // from an abandoned one, so it counts as stale even when its methods match.
  if (!columnExists('payments', 'status')) return false;
  return PAYMENT_STATUSES.every(value => table.sql.includes(`'${value}'`));
}

function rebuildPaymentsTable() {
  const existingColumns = new Set(
    sqlite.prepare('PRAGMA table_info(payments)').all().map(column => column.name)
  );
  const copied = PAYMENTS_TABLE_COLUMNS.filter(column => existingColumns.has(column));
  if (copied.length === 0) {
    throw new Error(
      '[database] The payments table has no recognised columns, so its payment_method constraint cannot be '
      + 'migrated automatically. Recreate the database with `npm run db:setup` and restore your data.'
    );
  }

  // A table created outside setup.js may hold method values the constraint
  // rejects. Fold them into "other" instead of leaving the API unable to boot.
  const unexpected = sqlite
    .prepare('SELECT DISTINCT payment_method FROM payments')
    .all()
    .map(row => row.payment_method)
    .filter(value => !isPaymentMethod(value));
  if (unexpected.length > 0) {
    console.warn(
      `[database] Stored payment method(s) ${unexpected.map(value => JSON.stringify(value)).join(', ')} are no longer `
      + 'supported and were migrated to "other".'
    );
  }

  // Money recorded before settlement states existed was taken in hand, so it
  // counts as collected. Any status the new constraint rejects is likewise
  // folded into a settled state rather than silently dropped from the bill.
  const selectList = copied
    .map(column => {
      if (column === 'payment_method') {
        return `CASE WHEN payment_method IN (${paymentMethodValueList()}) THEN payment_method ELSE 'other' END`;
      }
      if (column === 'status') {
        return `CASE WHEN status IN (${PAYMENT_STATUSES.map(value => `'${value}'`).join(',')}) THEN status ELSE 'completed' END`;
      }
      return column;
    })
    .join(', ');

  // foreign_keys is a no-op inside a transaction, so toggle it around the rebuild.
  sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec('DROP TABLE IF EXISTS payments_rebuild');
      sqlite.exec(`CREATE TABLE payments_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        payment_number TEXT UNIQUE NOT NULL,
        bill_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0),
        payment_method TEXT NOT NULL ${paymentMethodConstraint()},
        status TEXT NOT NULL DEFAULT 'completed' ${paymentStatusConstraint()},
        transaction_reference TEXT,
        provider TEXT,
        provider_reference TEXT,
        failure_reason TEXT,
        received_by INTEGER,
        payment_date TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (received_by) REFERENCES users(id)
      )`);
      sqlite.exec(`INSERT INTO payments_rebuild (${copied.join(', ')}) SELECT ${selectList} FROM payments`);
      sqlite.exec('DROP TABLE payments');
      sqlite.exec('ALTER TABLE payments_rebuild RENAME TO payments');
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}

function migrate() {
  // These tables are also declared by setup.js. Keeping their lightweight
  // migrations here allows the API to be inspected before a full setup run.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS drug_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_a_id INTEGER NOT NULL,
    medicine_b_id INTEGER NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('mild','moderate','severe','contraindicated')),
    description TEXT,
    clinical_management TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (medicine_a_id) REFERENCES medicines(id) ON DELETE CASCADE,
    FOREIGN KEY (medicine_b_id) REFERENCES medicines(id) ON DELETE CASCADE
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    patient_id INTEGER NOT NULL,
    appointment_id INTEGER,
    checkin_time TEXT DEFAULT (datetime('now')),
    checkin_date TEXT NOT NULL DEFAULT (date('now')),
    purpose TEXT,
    status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','in_consultation','completed','no_show','cancelled')),
    qr_token TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
  )`);

  // Procurement tables are also declared by setup.js. Declaring them here lets
  // the API serve a database created before procurement existed, so a running
  // install does not need a full setup pass before the routes work.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    lead_time_days INTEGER NOT NULL DEFAULT 7 CHECK(lead_time_days >= 0),
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    order_number TEXT UNIQUE NOT NULL,
    supplier_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','partially_received','received','cancelled')),
    total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
    ordered_by INTEGER,
    approved_by INTEGER,
    expected_date TEXT,
    notes TEXT,
    cancellation_reason TEXT,
    submitted_at TEXT,
    approved_at TEXT,
    received_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
    FOREIGN KEY (ordered_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_order_id INTEGER NOT NULL,
    medicine_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
    quantity_received INTEGER NOT NULL DEFAULT 0 CHECK(quantity_received >= 0),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE RESTRICT
  )`);

  const migrateCheckinDate = sqlite.transaction(() => {
    if (!columnExists('checkins', 'checkin_date')) {
      sqlite.exec('ALTER TABLE checkins ADD COLUMN checkin_date TEXT');
    }
    sqlite.exec(`
      UPDATE checkins
      SET checkin_date = COALESCE(date(checkin_time), date(created_at), date('now'))
      WHERE checkin_date IS NULL OR TRIM(checkin_date) = ''
    `);
    assertNoActiveCheckinDuplicates();
    sqlite.exec('DROP TRIGGER IF EXISTS checkins_require_date_before_insert');
    sqlite.exec('DROP TRIGGER IF EXISTS checkins_require_date_before_update');
    sqlite.exec(`
      CREATE TRIGGER checkins_require_date_before_insert
      BEFORE INSERT ON checkins
      WHEN NEW.checkin_date IS NULL OR TRIM(NEW.checkin_date) = ''
      BEGIN
        SELECT RAISE(ABORT, 'checkin_date is required');
      END
    `);
    sqlite.exec(`
      CREATE TRIGGER checkins_require_date_before_update
      BEFORE UPDATE OF checkin_date, checkin_time ON checkins
      WHEN NEW.checkin_date IS NULL OR TRIM(NEW.checkin_date) = ''
      BEGIN
        SELECT RAISE(ABORT, 'checkin_date is required');
      END
    `);
    createRequiredIndex(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_active_checkin_patient_date
       ON checkins(patient_id, checkin_date)
       WHERE status IN ('waiting', 'in_consultation')`,
      'one active check-in per patient per day'
    );
  });
  migrateCheckinDate();

  if (tableExists('patients')) {
    if (!columnExists('patients', 'portal_pin')) {
      sqlite.exec('ALTER TABLE patients ADD COLUMN portal_pin TEXT');
    }
    if (!columnExists('patients', 'portal_session_version')) {
      sqlite.exec('ALTER TABLE patients ADD COLUMN portal_session_version INTEGER NOT NULL DEFAULT 1');
    }
    if (!columnExists('patients', 'access_code')) {
      sqlite.exec('ALTER TABLE patients ADD COLUMN access_code TEXT');
    }

    const patientsWithoutCode = sqlite
      .prepare("SELECT id, mrn FROM patients WHERE access_code IS NULL OR access_code = ''")
      .all();
    if (patientsWithoutCode.length > 0) {
      const { generateAccessCode } = require('../utils/ids');
      const updateCode = sqlite.prepare('UPDATE patients SET access_code = ? WHERE id = ?');
      const insertCode = sqlite.transaction(() => {
        for (const patient of patientsWithoutCode) {
          let code = generateAccessCode(patient.mrn);
          while (sqlite.prepare('SELECT 1 FROM patients WHERE access_code = ?').get(code)) {
            code = generateAccessCode(patient.mrn);
          }
          updateCode.run(code, patient.id);
        }
      });
      insertCode();
    }
  }

  if (tableExists('admissions')) {
    if (!columnExists('admissions', 'chief_complaint')) {
      sqlite.exec('ALTER TABLE admissions ADD COLUMN chief_complaint TEXT');
    }
    if (!columnExists('admissions', 'triage_severity')) {
      sqlite.exec("ALTER TABLE admissions ADD COLUMN triage_severity TEXT CHECK(triage_severity IS NULL OR triage_severity IN ('low','moderate','high','critical'))");
    }
    if (!columnExists('admissions', 'updated_at')) {
      // SQLite rejects non-constant expressions (including CURRENT_TIMESTAMP)
      // in ALTER TABLE column defaults. Add a nullable column, backfill it,
      // and let the update trigger/application populate future values.
      sqlite.exec('ALTER TABLE admissions ADD COLUMN updated_at TEXT');
      sqlite.exec("UPDATE admissions SET updated_at = datetime('now') WHERE updated_at IS NULL");
    }
  }

  if (tableExists('prescription_items') && !columnExists('prescription_items', 'dispensed_quantity')) {
    sqlite.exec('ALTER TABLE prescription_items ADD COLUMN dispensed_quantity INTEGER NOT NULL DEFAULT 0');
    sqlite.exec('UPDATE prescription_items SET dispensed_quantity = quantity WHERE dispensed = 1');
  }
  if (tableExists('prescription_items') && columnExists('prescription_items', 'dispensed_quantity')) {
    sqlite.exec('UPDATE prescription_items SET dispensed_quantity = MIN(quantity, MAX(dispensed_quantity, 0))');
  }

  if (tableExists('doctor_profiles')) {
    createIndexIfPossible('CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_profiles_user ON doctor_profiles(user_id)');
  }
  if (tableExists('appointments')) {
    createIndexIfPossible(`CREATE UNIQUE INDEX IF NOT EXISTS idx_active_appointment_slot
      ON appointments(doctor_id, appointment_date, appointment_time)
      WHERE status IN ('scheduled','in_progress','completed')`);
  }
  if (tableExists('admissions')) {
    assertNoActiveAdmissionDuplicates();
    createRequiredIndex(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_active_admission_patient
       ON admissions(patient_id)
       WHERE status = 'admitted'`,
      'one active admission per patient'
    );
    createIndexIfPossible(`CREATE UNIQUE INDEX IF NOT EXISTS idx_active_admission_bed
      ON admissions(ward, bed_number)
      WHERE status = 'admitted' AND ward IS NOT NULL AND bed_number IS NOT NULL`);
  }
  if (tableExists('payments')) {
    // Dropping the table removes its indexes, so settle the table shape first
    // and then re-create them.
    if (!paymentsTableIsCurrent()) rebuildPaymentsTable();
    createIndexIfPossible(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transaction_reference
      ON payments(transaction_reference)
      WHERE transaction_reference IS NOT NULL AND transaction_reference != ''`);
    createIndexIfPossible(`CREATE INDEX IF NOT EXISTS idx_payments_pending
      ON payments(bill_id, created_at)
      WHERE status = 'pending'`);
  }
  if (tableExists('audit_log')) {
    // audit_log shipped in the schema but was never written to. These columns
    // distinguish a staff actor from a patient-portal actor; patient ids share
    // a namespace with user ids, so they are kept out of user_id entirely.
    if (!columnExists('audit_log', 'actor_type')) {
      sqlite.exec("ALTER TABLE audit_log ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'staff'");
    }
    if (!columnExists('audit_log', 'actor_label')) {
      sqlite.exec('ALTER TABLE audit_log ADD COLUMN actor_label TEXT');
    }
    // Kept separate from `action` so actions stay a clean, filterable set.
    if (!columnExists('audit_log', 'summary')) {
      sqlite.exec('ALTER TABLE audit_log ADD COLUMN summary TEXT');
    }
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)');
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)');
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)');
  }
  if (tableExists('users')) {
    // Added with the forgot-password flow. A database predating it has no way
    // to tell a session issued before a password change from one issued after,
    // so existing accounts start with null and keep their current sessions.
    if (!columnExists('users', 'password_changed_at')) {
      sqlite.exec('ALTER TABLE users ADD COLUMN password_changed_at TEXT');
    }
  }
  if (tableExists('users')) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    createIndexIfPossible('CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_hash ON password_reset_tokens(token_hash)');
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at)');
  }

  // Created here as well as in setup.js so an existing deployment keeps working
  // across a restart before anyone reruns `npm run db:setup`.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS payment_refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    refund_number TEXT UNIQUE NOT NULL,
    payment_id INTEGER NOT NULL,
    bill_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    payment_method TEXT NOT NULL ${paymentMethodConstraint()},
    reason TEXT NOT NULL,
    refunded_by INTEGER NOT NULL,
    refund_date TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (refunded_by) REFERENCES users(id)
  )`);
  if (tableExists('payment_refunds')) {
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_refunds_payment ON payment_refunds(payment_id)');
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_refunds_bill ON payment_refunds(bill_id)');
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_refunds_date ON payment_refunds(refund_date)');
  }

  if (tableExists('inventory_transactions')) {
    if (!columnExists('inventory_transactions', 'prescription_item_id')) {
      sqlite.exec('ALTER TABLE inventory_transactions ADD COLUMN prescription_item_id INTEGER');
    }
    createIndexIfPossible('CREATE INDEX IF NOT EXISTS idx_inventory_prescription_item ON inventory_transactions(prescription_item_id)');
    createIndexIfPossible(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_reference_number
      ON inventory_transactions(reference_number)
      WHERE reference_number IS NOT NULL AND reference_number != ''`);
  }

  const indexes = [
    ['appointments', 'CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id)'],
    ['appointments', 'CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, appointment_date)'],
    ['medical_records', 'CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON medical_records(patient_id)'],
    ['lab_orders', 'CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id)'],
    ['bills', 'CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id)'],
    ['admissions', 'CREATE INDEX IF NOT EXISTS idx_admissions_ward_status ON admissions(ward, status)'],
    ['notifications', 'CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)'],
    ['prescription_items', 'CREATE INDEX IF NOT EXISTS idx_prescription_items_medicine ON prescription_items(medicine_id)'],
    ['purchase_orders', 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)'],
    ['purchase_orders', 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id)'],
    ['purchase_orders', 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_created ON purchase_orders(created_at)'],
    ['purchase_order_items', 'CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchase_order_id)'],
    ['purchase_order_items', 'CREATE INDEX IF NOT EXISTS idx_purchase_order_items_medicine ON purchase_order_items(medicine_id)'],
  ];
  indexes.forEach(([table, sql]) => {
    if (tableExists(table)) createIndexIfPossible(sql);
  });

  const timestampTables = [
    'users',
    'patients',
    'appointments',
    'medical_records',
    'medicines',
    'bills',
    'admissions',
    'suppliers',
    'purchase_orders',
  ];
  for (const table of timestampTables) {
    if (!tableExists(table) || !columnExists(table, 'updated_at')) continue;
    const trigger = `${table}_set_updated_at`;
    sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    sqlite.exec(`CREATE TRIGGER ${trigger}
      AFTER UPDATE ON ${table}
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE ${table} SET updated_at = datetime('now') WHERE id = NEW.id;
      END`);
  }
}

migrate();

function normalizeParams(params) {
  return (params || []).map(param => {
    if (param === undefined || param === null) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    if (param instanceof Date) return Number.isNaN(param.getTime()) ? null : param.toISOString();
    return param;
  });
}

let transactionOpen = false;
let transactionQueue = Promise.resolve();
let transactionCompletion = Promise.resolve();
let resolveTransactionCompletion = null;

function executeQuery(sql, params = []) {
  const normalized = normalizeParams(params);
  const trimmed = sql.trim().toUpperCase();

  if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.startsWith('PRAGMA')) {
    const statement = sqlite.prepare(sql);
    return [statement.all(...normalized), []];
  }

  if (trimmed.startsWith('INSERT')) {
    const result = sqlite.prepare(sql).run(...normalized);
    return [{ insertId: result.lastInsertRowid, affectedRows: result.changes }, []];
  }

  if (trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE')) {
    const result = sqlite.prepare(sql).run(...normalized);
    return [{ affectedRows: result.changes }, []];
  }

  sqlite.exec(sql);
  return [{}, []];
}

async function runTransaction(callback) {
  let releaseQueue;
  const previous = transactionQueue;
  transactionQueue = new Promise(resolve => { releaseQueue = resolve; });
  await previous;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    connection.release();
    releaseQueue();
  }
}

const pool = {
  async query(sql, params = []) {
    // Do not let an unrelated request read or write the single SQLite
    // connection in the middle of a transaction. Connection.query() below
    // intentionally bypasses this wait for the transaction callback itself.
    if (transactionOpen && transactionCompletion) await transactionCompletion;
    return executeQuery(sql, params);
  },

  runTransaction,

  async getConnection() {
    return {
      query(sql, params = []) {
        return Promise.resolve(executeQuery(sql, params));
      },
      async beginTransaction() {
        if (transactionOpen) throw new Error('A database transaction is already active');
        sqlite.exec('BEGIN IMMEDIATE');
        transactionOpen = true;
        transactionCompletion = new Promise(resolve => { resolveTransactionCompletion = resolve; });
      },
      async commit() {
        if (!transactionOpen) throw new Error('No database transaction is active');
        sqlite.exec('COMMIT');
        transactionOpen = false;
        if (resolveTransactionCompletion) resolveTransactionCompletion();
        resolveTransactionCompletion = null;
        transactionCompletion = Promise.resolve();
      },
      async rollback() {
        if (!transactionOpen) return;
        sqlite.exec('ROLLBACK');
        transactionOpen = false;
        if (resolveTransactionCompletion) resolveTransactionCompletion();
        resolveTransactionCompletion = null;
        transactionCompletion = Promise.resolve();
      },
      release() {
        // The application intentionally uses one SQLite connection.
      },
    };
  },

  async isReady() {
    if (!tableExists('users')) {
      throw new Error('Database schema is not initialized. Run npm run db:setup.');
    }
    sqlite.prepare('SELECT 1').get();
    return true;
  },

  close() {
    if (transactionOpen) {
      sqlite.exec('ROLLBACK');
      if (resolveTransactionCompletion) resolveTransactionCompletion();
    }
    transactionOpen = false;
    resolveTransactionCompletion = null;
    transactionCompletion = Promise.resolve();
    if (sqlite.open) sqlite.close();
  },
};

module.exports = pool;
module.exports.sqlite = sqlite;
module.exports.dbPath = dbPath;
