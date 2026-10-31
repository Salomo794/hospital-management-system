'use strict';

/**
 * MySQL schema bootstrap.
 *
 * This module is the single place that creates the HMS database structure. It
 * replaces the old SQLite `setup.js` DDL and the ad-hoc `migrate()` routine that
 * used to live in `database.js` (PRAGMA table_info, sqlite_master lookups and
 * table rebuilds), none of which exist in MySQL.
 *
 * Three things have to be translated rather than copied from the SQLite world:
 *
 *  1. Filtered ("partial") unique indexes. SQLite allows
 *     `CREATE UNIQUE INDEX ... WHERE status = 'admitted'`, MySQL does not have
 *     partial indexes at all. Each one becomes a STORED generated column that
 *     evaluates to NULL when the row is not "active", plus a plain unique index
 *     on that column. MySQL permits any number of NULLs in a unique index, so
 *     the exclusion semantics of the original index are preserved exactly.
 *
 *  2. `updated_at` triggers. SQLite used `AFTER UPDATE ... WHEN NEW.updated_at =
 *     OLD.updated_at BEGIN UPDATE ... END`. In MySQL the equivalent is a BEFORE
 *     UPDATE trigger that assigns NEW.updated_at directly (assigning through a
 *     second UPDATE on the same row is not allowed).
 *
 *  3. CHECK-driven validation that cannot express an empty string, e.g. the
 *     check-in date guard, becomes a SIGNAL in a BEFORE INSERT/UPDATE trigger.
 *
 * Everything here is idempotent: every object is created only after checking
 * information_schema, so running `npm run setup` repeatedly is safe.
 */

const fs = require('fs');
const path = require('path');
const { query, config, createBootstrapConnection } = require('./mysqlPool');

const SCHEMA_FILE = path.join(__dirname, 'schema.mysql.sql');

/**
 * Split a SQL script into individual statements.
 *
 * A naive `split(';')` corrupts this schema because CHECK constraints, DEFAULT
 * values and trigger bodies all contain semicolons inside quotes. This scanner
 * tracks single/double/backtick quoting plus line (`--`) and block comments.
 */
function splitStatements(script) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    const next = script[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        current += ' ';
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle || inDouble || inBacktick) {
      current += char;
      // MySQL also accepts a backslash escape inside string literals.
      if (char === '\\' && (inSingle || inDouble)) {
        if (next !== undefined) {
          current += next;
          i += 1;
        }
        continue;
      }
      if (inSingle && char === "'") {
        if (next === "'") {
          current += next;
          i += 1;
        } else {
          inSingle = false;
        }
      } else if (inDouble && char === '"') {
        if (next === '"') {
          current += next;
          i += 1;
        } else {
          inDouble = false;
        }
      } else if (inBacktick && char === '`') {
        if (next === '`') {
          current += next;
          i += 1;
        } else {
          inBacktick = false;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      current += char;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      current += char;
      continue;
    }
    if (char === '`') {
      inBacktick = true;
      current += char;
      continue;
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function tableExists(table) {
  const [rows] = await query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`
    ,
    [table]
  );
  return rows.length > 0;
}

async function columnExists(table, column) {
  const [rows] = await query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(table, index) {
  const [rows] = await query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

async function triggerExists(trigger) {
  const [rows] = await query(
    `SELECT 1 FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ? LIMIT 1`,
    [trigger]
  );
  return rows.length > 0;
}

/**
 * SQLite partial unique indexes, expressed as generated columns.
 *
 * `keyExpression` must evaluate to NULL for rows that should not participate in
 * the constraint. MySQL's unique index ignores NULLs, which is precisely the
 * "only enforce while the row is active" behaviour the SQLite index had.
 */
const DERIVED_UNIQUE_KEYS = [
  {
    table: 'appointments',
    column: 'active_slot_key',
    definition:
      "VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN status IN ('scheduled','in_progress','completed') "
      + 'THEN CONCAT(doctor_id, \'|\', appointment_date, \'|\', appointment_time) END) STORED',
    index: 'uq_appointments_active_slot',
    comment: 'one live appointment per doctor slot',
  },
  {
    table: 'admissions',
    column: 'active_patient_key',
    definition:
      "INT GENERATED ALWAYS AS (CASE WHEN status = 'admitted' THEN patient_id END) STORED",
    index: 'uq_admissions_active_patient',
    comment: 'a patient can only be admitted once at a time',
  },
  {
    table: 'admissions',
    column: 'active_bed_key',
    definition:
      "VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN status = 'admitted' AND ward IS NOT NULL "
      + "AND bed_number IS NOT NULL THEN CONCAT(ward, '|', bed_number) END) STORED",
    index: 'uq_admissions_active_bed',
    comment: 'a bed can only hold one admitted patient',
  },
  {
    table: 'checkins',
    column: 'active_patient_date_key',
    definition:
      "VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN status IN ('waiting','in_consultation') "
      + "THEN CONCAT(patient_id, '|', checkin_date) END) STORED",
    index: 'uq_checkins_active_patient_date',
    comment: 'one active check-in per patient per day',
  },
  {
    table: 'payments',
    column: 'active_transaction_reference',
    definition:
      "VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN transaction_reference IS NOT NULL "
      + "AND transaction_reference <> '' THEN transaction_reference END) STORED",
    index: 'uq_payments_transaction_reference',
    comment: 'a provider reference cannot be replayed across payments',
  },
  {
    table: 'inventory_transactions',
    column: 'active_reference_number',
    definition:
      "VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN reference_number IS NOT NULL "
      + "AND reference_number <> '' THEN reference_number END) STORED",
    index: 'uq_inventory_reference_number',
    comment: 'a stock document number cannot be applied twice',
  },
];

/** Plain (non-unique) secondary indexes that used to be created in setup.js. */
const SECONDARY_INDEXES = [
  ['appointments', 'idx_appointments_patient', ['patient_id']],
  // `appointment_date` is stored as TEXT (carried over from the SQLite schema),
  // so the index needs an explicit prefix length: a full TEXT column would be
  // 65535*4 bytes and every composite key would fail with ER_TOO_LONG_KEY.
  // 32 characters covers `YYYY-MM-DD HH:MM:SS` completely, so prefix ordering
  // is identical to full-value ordering for ISO-formatted stamps.
  ['appointments', 'idx_appointments_doctor_date', ['doctor_id', 'appointment_date(32)']],
  ['medical_records', 'idx_medical_records_patient', ['patient_id']],
  ['lab_orders', 'idx_lab_orders_patient', ['patient_id']],
  ['bills', 'idx_bills_patient', ['patient_id']],
  ['admissions', 'idx_admissions_ward_status', ['ward(64)', 'status']],
  ['notifications', 'idx_notifications_user_read', ['user_id', 'is_read']],
  ['prescription_items', 'idx_prescription_items_medicine', ['medicine_id']],
  ['purchase_orders', 'idx_purchase_orders_status', ['status']],
  ['purchase_orders', 'idx_purchase_orders_supplier', ['supplier_id']],
  ['purchase_orders', 'idx_purchase_orders_created', ['created_at']],
  ['purchase_order_items', 'idx_purchase_order_items_order', ['purchase_order_id']],
  ['purchase_order_items', 'idx_purchase_order_items_medicine', ['medicine_id']],
  ['payment_refunds', 'idx_refunds_payment', ['payment_id']],
  ['payment_refunds', 'idx_refunds_bill', ['bill_id']],
  ['payment_refunds', 'idx_refunds_date', ['refund_date']],
  ['audit_log', 'idx_audit_log_created', ['created_at']],
  ['audit_log', 'idx_audit_log_user', ['user_id']],
  ['audit_log', 'idx_audit_log_action', ['action(64)']],
  ['password_reset_tokens', 'idx_password_reset_user', ['user_id', 'created_at']],
  ['checkin_tokens', 'idx_checkin_tokens_expires', ['expires_at(32)']],
  ['checkin_tokens', 'idx_checkin_tokens_patient', ['patient_id']],
];

/** Tables whose `updated_at` column is maintained by the database itself. */
const TIMESTAMPED_TABLES = [
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

/**
 * The kiosk check-in flow must never create a check-in without a business date:
 * the "one active check-in per patient per day" index is only meaningful if the
 * date is present. SQLite enforced this with a trigger that aborts the write;
 * MySQL uses SIGNAL for the same effect.
 */
const CHECKIN_GUARD_TRIGGERS = [
  {
    name: 'checkins_require_date_before_insert',
    sql: `CREATE TRIGGER checkins_require_date_before_insert
          BEFORE INSERT ON checkins
          FOR EACH ROW
          BEGIN
            IF NEW.checkin_date IS NULL THEN
              SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'checkin_date is required';
            END IF;
          END`,
  },
  {
    name: 'checkins_require_date_before_update',
    sql: `CREATE TRIGGER checkins_require_date_before_update
          BEFORE UPDATE ON checkins
          FOR EACH ROW
          BEGIN
            IF NEW.checkin_date IS NULL THEN
              SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'checkin_date is required';
            END IF;
          END`,
  },
];

/**
 * `safety_reference` is a singleton table: exactly one row (id = 1) describes the
 * loaded interaction reference set.
 *
 * SQLite expressed this as `CHECK(id = 1)`, which cannot be ported: MariaDB
 * rejects a CHECK constraint that mentions an AUTO_INCREMENT column
 * (`ERROR 1901: Function or expression 'AUTO_INCREMENT' cannot be used in the
 * CHECK clause`), and that blocks the whole schema apply. A BEFORE INSERT
 * trigger keeps the same guarantee while leaving the id an ordinary
 * auto-increment primary key, so the documented upsert
 * (`INSERT ... (id, ...) VALUES (1, ...) ON DUPLICATE KEY UPDATE`) still works.
 * MySQL assigns the auto-increment value before the trigger body runs, which is
 * why an insert that omits the id is rejected instead of silently adding row 2.
 */
const SAFETY_REFERENCE_TRIGGERS = [
  {
    name: 'safety_reference_single_row_before_insert',
    sql: `CREATE TRIGGER safety_reference_single_row_before_insert
          BEFORE INSERT ON safety_reference
          FOR EACH ROW
          BEGIN
            IF NEW.id IS NULL OR NEW.id <> 1 THEN
              SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'safety_reference is a singleton table; only id = 1 is allowed';
            END IF;
          END`,
  },
  {
    name: 'safety_reference_single_row_before_update',
    sql: `CREATE TRIGGER safety_reference_single_row_before_update
          BEFORE UPDATE ON safety_reference
          FOR EACH ROW
          BEGIN
            IF NEW.id <> 1 THEN
              SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'safety_reference is a singleton table; id cannot change';
            END IF;
          END`,
  },
];

/**
 * Create the configured database if it does not exist yet.
 *
 * The pool connects to a specific database, so on a fresh server the very first
 * statement would fail with ER_BAD_DB_ERROR. Connecting without selecting a
 * database is the only portable way to create it. The name is validated because
 * identifiers cannot be parameterised.
 */
async function ensureDatabase() {
  const name = config.database;
  if (!/^[A-Za-z0-9_$]+$/.test(name)) {
    throw new Error(`Refusing to create a database with an unsafe name: ${name}`);
  }
  // Use the pool's standalone connection factory: the exported `config` above is
  // redacted (no password), so building the options here would connect
  // anonymously and fail with "Access denied ... (using password: NO)".
  const connection = await createBootstrapConnection();
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function applyBaseSchema(log) {
  const statements = splitStatements(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  if (statements.length === 0) {
    throw new Error(`Schema file ${SCHEMA_FILE} contains no statements`);
  }
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    try {
      await query(statement);
    } catch (error) {
      const label = statement.slice(0, 60).replace(/\s+/g, ' ');
      error.message = `Schema statement ${index + 1}/${statements.length} failed (${label}...): ${error.message}`;
      throw error;
    }
  }
  log(`Applied ${statements.length} schema statements`);
  return statements.length;
}

async function applyDerivedUniqueKeys(log) {
  for (const key of DERIVED_UNIQUE_KEYS) {
    if (!(await tableExists(key.table))) continue;
    if (!(await columnExists(key.table, key.column))) {
      await query(`ALTER TABLE \`${key.table}\` ADD COLUMN \`${key.column}\` ${key.definition}`);
      log(`Added generated column ${key.table}.${key.column} (${key.comment})`);
    }
    if (!(await indexExists(key.table, key.index))) {
      await query(`ALTER TABLE \`${key.table}\` ADD UNIQUE KEY \`${key.index}\` (\`${key.column}\`)`);
      log(`Added unique key ${key.index} on ${key.table}`);
    }
  }
}

/**
 * Render one index column. Accepts `name` or `name(prefixLength)`; the prefix
 * form is required for TEXT/BLOB columns. Values are validated rather than
 * interpolated, because identifiers cannot be bound as parameters.
 */
function renderIndexColumn(column) {
  const match = /^([A-Za-z0-9_$]+)(?:\((\d+)\))?$/.exec(String(column));
  if (!match) throw new Error(`Unsafe index column specification: ${column}`);
  return match[2] ? `\`${match[1]}\`(${match[2]})` : `\`${match[1]}\``;
}

async function applySecondaryIndexes(log) {
  for (const [table, index, columns] of SECONDARY_INDEXES) {
    if (!(await tableExists(table))) continue;
    if (await indexExists(table, index)) continue;
    const columnList = columns.map(renderIndexColumn).join(', ');
    try {
      await query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columnList})`);
    } catch (error) {
      // Sanitised database errors drop the SQL text, so name the index here or
      // the failure is unidentifiable.
      error.message = `Failed to create index ${index} on ${table}(${columns.join(', ')}): ${error.message}`;
      throw error;
    }
    log(`Added index ${index} on ${table}(${columns.join(', ')})`);
  }
}

async function applyUpdatedAtTriggers(log) {
  for (const table of TIMESTAMPED_TABLES) {
    if (!(await tableExists(table))) continue;
    if (!(await columnExists(table, 'updated_at'))) continue;
    const name = `${table}_set_updated_at`;
    if (await triggerExists(name)) continue;
    // Only refresh the timestamp when the writer did not set it explicitly,
    // matching the SQLite trigger's WHEN clause.
    await query(`CREATE TRIGGER \`${name}\`
      BEFORE UPDATE ON \`${table}\`
      FOR EACH ROW
      BEGIN
        IF NEW.updated_at <=> OLD.updated_at THEN
          SET NEW.updated_at = CURRENT_TIMESTAMP;
        END IF;
      END`);
    log(`Added BEFORE UPDATE trigger ${name}`);
  }
}

async function applyCheckinTriggers(log) {
  if (!(await tableExists('checkins'))) return;
  for (const trigger of CHECKIN_GUARD_TRIGGERS) {
    if (await triggerExists(trigger.name)) continue;
    await query(trigger.sql);
    log(`Added trigger ${trigger.name}`);
  }
}

/**
 * Refuse to build the "one active row" constraints on top of legacy data that
 * already violates them. MySQL would fail the ALTER with a duplicate key error;
 * a readable message naming the offending rows is far more useful.
 */
async function assertNoConflictingRows() {
  const checks = [
    {
      sql: `SELECT patient_id, COUNT(*) AS duplicate_count FROM admissions
             WHERE status = 'admitted' GROUP BY patient_id HAVING COUNT(*) > 1 LIMIT 10`,
      describe: row => `patient ${row.patient_id} (${row.duplicate_count} admissions)`,
      message: 'duplicate active admissions must be resolved before the unique index can be created',
    },
    {
      sql: `SELECT ward, bed_number, COUNT(*) AS duplicate_count FROM admissions
             WHERE status = 'admitted' AND ward IS NOT NULL AND bed_number IS NOT NULL
             GROUP BY ward, bed_number HAVING COUNT(*) > 1 LIMIT 10`,
      describe: row => `bed ${row.ward}/${row.bed_number} (${row.duplicate_count} patients)`,
      message: 'a bed occupied by several admitted patients must be resolved first',
    },
    {
      sql: `SELECT patient_id, checkin_date, COUNT(*) AS duplicate_count FROM checkins
             WHERE status IN ('waiting', 'in_consultation')
             GROUP BY patient_id, checkin_date HAVING COUNT(*) > 1 LIMIT 10`,
      describe: row => `patient ${row.patient_id} on ${row.checkin_date || 'an unknown date'} (${row.duplicate_count} rows)`,
      message: 'duplicate active check-ins must be resolved first',
    },
    {
      sql: `SELECT id FROM checkins
             WHERE status IN ('waiting', 'in_consultation') AND checkin_date IS NULL LIMIT 10`,
      describe: row => `check-in ${row.id}`,
      message: 'active check-ins without a checkin_date must be repaired first',
    },
  ];

  for (const check of checks) {
    if (!(await tableExists('checkins')) || !(await tableExists('admissions'))) continue;
    const [rows] = await query(check.sql);
    if (rows.length > 0) {
      const summary = rows.map(check.describe).join('; ');
      throw new Error(`Cannot apply schema constraints: ${check.message} (${summary}).`);
    }
  }
}

/**
 * Apply the full schema. Safe to call on an empty database or an existing one.
 */
async function applySchema({ log = () => {}, createDatabase = true } = {}) {
  if (createDatabase) await ensureDatabase();
  await applyBaseSchema(log);
  await assertNoConflictingRows();
  await applyDerivedUniqueKeys(log);
  await applySecondaryIndexes(log);
  await applyUpdatedAtTriggers(log);
  await applyCheckinTriggers(log);
  return {
    statements: splitStatements(fs.readFileSync(SCHEMA_FILE, 'utf8')).length,
    tables: (await query(
      'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    ))[0][0].count,
  };
}

module.exports = {
  applySchema,
  ensureDatabase,
  splitStatements,
  tableExists,
  columnExists,
  indexExists,
  triggerExists,
  SCHEMA_FILE,
  DERIVED_UNIQUE_KEYS,
  SECONDARY_INDEXES,
  TIMESTAMPED_TABLES,
};
