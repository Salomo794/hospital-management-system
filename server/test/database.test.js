const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:root@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const pool = require('../config/database');
const setupDatabase = require('../config/setup');

before(async () => {
  await setupDatabase();
});

after(async () => {
  await pool.close();
});

test('database adapter requires and connects only to MySQL', async () => {
  assert.equal(pool.useMySQL, true);
  assert.equal(await pool.isReady(), true);
});

test('normalizes UTC dates to MySQL DATETIME values', async () => {
  const date = new Date('2026-10-30T16:33:14.162Z');
  assert.deepEqual(pool.normalizeParams([date, '2026-10-30T16:33:14.162Z']), [
    '2026-10-30 16:33:14.162000',
    '2026-10-30 16:33:14.162000',
  ]);
  const [rows] = await pool.query('SELECT ? AS date_from_object, ? AS date_from_string', [
    date,
    '2026-10-30T16:33:14.162Z',
  ]);
  assert.equal(rows[0].date_from_object, '2026-10-30 16:33:14.162000');
  assert.equal(rows[0].date_from_string, '2026-10-30 16:33:14.162000');
});

test('schema setup creates MySQL tables with the payment constraints', async () => {
  const [engines] = await pool.query(
    `SELECT ENGINE AS engine FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'payments'`
  );
  assert.equal(engines[0].engine, 'InnoDB');

  const [constraints] = await pool.query(
    `SELECT cc.CHECK_CLAUSE AS check_clause
     FROM information_schema.CHECK_CONSTRAINTS cc
     JOIN information_schema.TABLE_CONSTRAINTS tc
       ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
       AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
     WHERE tc.TABLE_SCHEMA = DATABASE()
       AND tc.TABLE_NAME = 'payments'
       AND tc.CONSTRAINT_TYPE = 'CHECK'`
  );
  assert.ok(constraints.some(row => row.check_clause.includes('mobile_money')));

  const [tables] = await pool.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND engine = 'InnoDB'`
  );
  assert.equal(Number(tables[0].count), 27);

  const [amountColumns] = await pool.query(
    `SELECT DATA_TYPE AS data_type FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'amount'`
  );
  assert.equal(amountColumns[0].data_type, 'decimal');
});

test('conditional unique indexes allow history but protect active records', async () => {
  const [user] = await pool.query(
    `INSERT INTO users (uuid, email, password, role, first_name, last_name)
     VALUES (?, ?, 'hash', 'admin', 'Test', 'User')`,
    [`${Date.now()}-user`, `${Date.now()}@example.test`]
  );
  const [patient] = await pool.query(
    `INSERT INTO patients (uuid, mrn, first_name, last_name, date_of_birth, gender)
     VALUES (?, ?, 'Test', 'Patient', '2000-01-01', 'other')`,
    [`${Date.now()}-patient`, `${Date.now()}`]
  );
  const appointmentValues = [patient.insertId, user.insertId, '2030-01-01', '09:00:00'];
  await pool.query(
    `INSERT INTO appointments
     (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, status)
     VALUES (?, ?, ?, ?, ?, ?, 'cancelled'), (?, ?, ?, ?, ?, ?, 'cancelled')`,
    [`${Date.now()}-a1`, `${Date.now()}-n1`, ...appointmentValues,
      `${Date.now()}-a2`, `${Date.now()}-n2`, ...appointmentValues]
  );
  await pool.query(
    `INSERT INTO appointments
     (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`${Date.now()}-a3`, `${Date.now()}-n3`, ...appointmentValues]
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO appointments
       (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`${Date.now()}-a4`, `${Date.now()}-n4`, ...appointmentValues]
    ),
    error => error.code === 'ER_DUP_ENTRY'
  );
});
