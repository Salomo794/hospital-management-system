const { loadEnvironment } = require('./environment');
loadEnvironment();

const pool = require('./database');
const schemaTables = require('./mysqlSchema');

const generatedColumns = [
  ['appointments', 'active_slot', "TINYINT GENERATED ALWAYS AS (CASE WHEN status IN ('scheduled','in_progress','completed') THEN 1 ELSE NULL END) STORED"],
  ['admissions', 'active_admission_slot', "TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'admitted' THEN 1 ELSE NULL END) STORED"],
  ['admissions', 'active_bed_slot', "TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'admitted' AND ward IS NOT NULL AND bed_number IS NOT NULL THEN 1 ELSE NULL END) STORED"],
  ['checkins', 'active_checkin_slot', "TINYINT GENERATED ALWAYS AS (CASE WHEN status IN ('waiting','in_consultation') THEN 1 ELSE NULL END) STORED"],
  ['payments', 'transaction_reference_key', "VARCHAR(255) COLLATE utf8mb4_0900_bin GENERATED ALWAYS AS (NULLIF(transaction_reference, '')) STORED"],
  ['inventory_transactions', 'reference_number_key', "VARCHAR(255) COLLATE utf8mb4_0900_bin GENERATED ALWAYS AS (NULLIF(reference_number, '')) STORED"],
];

const indexes = [
  ['idx_active_appointment_slot', 'appointments', ['doctor_id', 'appointment_date', 'appointment_time', 'active_slot'], true],
  ['idx_active_admission_patient', 'admissions', ['patient_id', 'active_admission_slot'], true],
  ['idx_active_checkin_patient_date', 'checkins', ['patient_id', 'checkin_date', 'active_checkin_slot'], true],
  ['idx_active_admission_bed', 'admissions', ['ward', 'bed_number', 'active_bed_slot'], true],
  ['idx_payment_transaction_reference', 'payments', ['transaction_reference_key'], true],
  ['idx_payments_pending', 'payments', ['status', 'bill_id', 'created_at'], false],
  ['idx_inventory_reference_number', 'inventory_transactions', ['reference_number_key'], true],
  ['idx_refunds_payment', 'payment_refunds', ['payment_id'], false],
  ['idx_refunds_bill', 'payment_refunds', ['bill_id'], false],
  ['idx_refunds_date', 'payment_refunds', ['refund_date'], false],
  ['idx_audit_log_created', 'audit_log', ['created_at'], false],
  ['idx_audit_log_user', 'audit_log', ['user_id'], false],
  ['idx_audit_log_action', 'audit_log', ['action'], false],
  ['idx_password_reset_hash', 'password_reset_tokens', ['token_hash'], true],
  ['idx_password_reset_user', 'password_reset_tokens', ['user_id', 'created_at'], false],
  ['idx_appointments_patient', 'appointments', ['patient_id'], false],
  ['idx_appointments_doctor_date', 'appointments', ['doctor_id', 'appointment_date'], false],
  ['idx_medical_records_patient', 'medical_records', ['patient_id'], false],
  ['idx_lab_orders_patient', 'lab_orders', ['patient_id'], false],
  ['idx_bills_patient', 'bills', ['patient_id'], false],
  ['idx_admissions_ward_status', 'admissions', ['ward', 'status'], false],
  ['idx_notifications_user_read', 'notifications', ['user_id', 'is_read'], false],
  ['idx_prescription_items_medicine', 'prescription_items', ['medicine_id'], false],
  ['idx_purchase_orders_status', 'purchase_orders', ['status'], false],
  ['idx_purchase_orders_supplier', 'purchase_orders', ['supplier_id'], false],
  ['idx_purchase_orders_created', 'purchase_orders', ['created_at'], false],
  ['idx_purchase_order_items_order', 'purchase_order_items', ['purchase_order_id'], false],
  ['idx_purchase_order_items_medicine', 'purchase_order_items', ['medicine_id'], false],
];

async function ensureGeneratedColumn(conn, table, column, definition) {
  const [existing] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (existing.length === 0) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function ensureIndex(conn, name, table, columns, unique) {
  const [existing] = await conn.query(
    `SELECT COLUMN_NAME AS column_name, NON_UNIQUE AS non_unique
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     ORDER BY SEQ_IN_INDEX`,
    [table, name]
  );
  const matches = existing.length === columns.length &&
    existing.every((row, index) =>
      row.column_name === columns[index] && Number(row.non_unique) === (unique ? 0 : 1)
    );
  if (matches) return;
  if (existing.length > 0) await conn.query(`DROP INDEX \`${name}\` ON \`${table}\``);
  const quotedColumns = columns.map(column => `\`${column}\``).join(', ');
  await conn.query(
    `CREATE ${unique ? 'UNIQUE ' : ''}INDEX \`${name}\` ON \`${table}\` (${quotedColumns})`
  );
}

async function setup() {
  const conn = await pool.getConnection();

  try {
    if (process.env.NODE_ENV === 'test') {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const [existingTables] = await conn.query(
          "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
        );
        for (const { table_name: tableName } of existingTables) {
          await conn.query(`DROP TABLE IF EXISTS \`${tableName}\``);
        }
      } finally {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      }
    }
    for (const statement of schemaTables) await conn.query(statement);

    await conn.query(`
      UPDATE checkins
      SET checkin_date = COALESCE(DATE(checkin_time), DATE(created_at), CURRENT_DATE)
      WHERE checkin_date IS NULL OR TRIM(checkin_date) = ''
    `);

    const [duplicateCheckins] = await conn.query(`
      SELECT patient_id, checkin_date, COUNT(*) AS duplicate_count
      FROM checkins
      WHERE status IN ('waiting', 'in_consultation')
      GROUP BY patient_id, checkin_date
      HAVING COUNT(*) > 1
      ORDER BY patient_id, checkin_date
      LIMIT 10
    `);
    if (duplicateCheckins.length > 0) {
      const summary = duplicateCheckins
        .map(row => `patient ${row.patient_id} on ${row.checkin_date || 'an unknown date'} (${row.duplicate_count} rows)`)
        .join('; ');
      throw new Error(
        'Cannot create the active check-in index because duplicate legacy check-ins remain '
        + `(${summary}). Resolve them and rerun setup.`
      );
    }
    const [undatedCheckins] = await conn.query(`
      SELECT id FROM checkins
      WHERE status IN ('waiting', 'in_consultation') AND checkin_date IS NULL
      ORDER BY id LIMIT 10
    `);
    if (undatedCheckins.length > 0) {
      throw new Error(
        'Cannot create the active check-in index because legacy check-ins have no valid checkin_date '
        + `(check-in IDs: ${undatedCheckins.map(row => row.id).join(', ')}). Repair them and rerun setup.`
      );
    }
    const [duplicateAdmissions] = await conn.query(`
      SELECT patient_id, COUNT(*) AS duplicate_count
      FROM admissions
      WHERE status = 'admitted'
      GROUP BY patient_id
      HAVING COUNT(*) > 1
      ORDER BY patient_id
      LIMIT 10
    `);
    if (duplicateAdmissions.length > 0) {
      const summary = duplicateAdmissions
        .map(row => `patient ${row.patient_id} (${row.duplicate_count} rows)`)
        .join('; ');
      throw new Error(
        'Cannot create the active admission index because duplicate legacy admissions remain '
        + `(${summary}). Resolve them and rerun setup.`
      );
    }

    for (const [table, column, definition] of generatedColumns) {
      await ensureGeneratedColumn(conn, table, column, definition);
    }
    for (const [name, table, columns, unique] of indexes) {
      await ensureIndex(conn, name, table, columns, unique);
    }

    await pool.isReady();
    console.log('All tables and indexes created successfully (MySQL)!');
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  setup()
    .then(() => pool.close())
    .catch(async () => {
    process.exitCode = 1;
    await pool.close();
  });
}

module.exports = setup;
