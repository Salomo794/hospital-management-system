const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const configuredPath = process.env.DB_PATH || path.join(__dirname, '..', 'hospital.db');
const dbPath = configuredPath === ':memory:' ? configuredPath : path.resolve(configuredPath);
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
    checkin_date TEXT DEFAULT (date('now')),
    purpose TEXT,
    status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','in_consultation','completed','no_show','cancelled')),
    qr_token TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
  )`);

  const migrateCheckinDate = sqlite.transaction(() => {
    if (!columnExists('checkins', 'checkin_date')) {
      sqlite.exec('ALTER TABLE checkins ADD COLUMN checkin_date TEXT');
    }
    sqlite.exec(`
      UPDATE checkins
      SET checkin_date = date(checkin_time)
      WHERE checkin_date IS NULL OR TRIM(checkin_date) = ''
    `);
    assertNoActiveCheckinDuplicates();
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
    createIndexIfPossible(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transaction_reference
      ON payments(transaction_reference)
      WHERE transaction_reference IS NOT NULL AND transaction_reference != ''`);
  }
  if (tableExists('inventory_transactions')) {
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
