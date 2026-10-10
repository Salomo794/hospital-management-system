const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-migration-test-'));
const serverDirectory = path.join(__dirname, '..');
const dbPath = path.join(tempDirectory, 'legacy.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

function createLegacyDatabase(filePath, { duplicateActiveCheckins = false } = {}) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      mrn TEXT NOT NULL,
      access_code TEXT
    );
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER,
      doctor_id INTEGER,
      appointment_date TEXT,
      appointment_time TEXT,
      status TEXT
    );
    CREATE TABLE checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      checkin_time TEXT DEFAULT (datetime('now')),
      checkin_date TEXT,
      purpose TEXT,
      status TEXT DEFAULT 'waiting',
      qr_token TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    );
    INSERT INTO patients (id, mrn, access_code) VALUES (1, 'MRN-LEGACY', 'LEGACY');
    INSERT INTO appointments (id) VALUES (1);
    INSERT INTO checkins
      (uuid, patient_id, appointment_id, checkin_time, checkin_date, status)
    VALUES
      ('legacy-checkin-1', 1, 1, '2024-02-03 09:30:00', NULL, 'waiting');
  `);
  if (duplicateActiveCheckins) {
    db.exec(`
      INSERT INTO checkins
        (uuid, patient_id, appointment_id, checkin_time, checkin_date, status)
      VALUES
        ('legacy-checkin-2', 1, 1, '2024-02-03 10:30:00', '2024-02-03', 'in_consultation');
    `);
  }
  db.close();
}

function createLegacyPaymentsDatabase(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      mrn TEXT NOT NULL,
      access_code TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      payment_number TEXT UNIQUE NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','insurance','online','bank_transfer','other')),
      transaction_reference TEXT,
      received_by INTEGER,
      payment_date TEXT DEFAULT (datetime('now')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (received_by) REFERENCES users(id)
    );
    INSERT INTO patients (id, mrn, access_code) VALUES (1, 'MRN-PAY', 'PAY');
    INSERT INTO bills (id) VALUES (1);
    INSERT INTO payments
      (uuid, payment_number, bill_id, patient_id, amount, payment_method, transaction_reference, payment_date)
    VALUES
      ('legacy-payment-1', 'PAY-1', 1, 1, 10, 'cash', 'legacy-ref-1', '2024-02-03 09:30:00'),
      ('legacy-payment-2', 'PAY-2', 1, 1, 20, 'bank_transfer', 'legacy-ref-2', '2024-02-04 09:30:00');
  `);
  db.close();
}

createLegacyDatabase(dbPath);
const pool = require('../config/database');
const { sqlite } = pool;

function removeDatabase(filePath) {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${filePath}${suffix}`, { force: true });
  }
}

after(() => {
  pool.close();
  removeDatabase(dbPath);
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('legacy check-in and portal-session migrations close null bypasses', () => {
  const patientColumns = sqlite.prepare('PRAGMA table_info(patients)').all();
  assert.equal(
    patientColumns.some(column => column.name === 'portal_session_version' && column.notnull === 1),
    true
  );
  const [patient] = sqlite.prepare('SELECT portal_session_version FROM patients WHERE id = 1').all();
  assert.equal(patient.portal_session_version, 1);

  const [checkin] = sqlite.prepare('SELECT checkin_date FROM checkins WHERE id = 1').all();
  assert.equal(checkin.checkin_date, '2024-02-03');
  assert.throws(
    () => sqlite.prepare(`
      INSERT INTO checkins (uuid, patient_id, appointment_id, checkin_time, status)
      VALUES ('legacy-checkin-null', 1, 1, '2024-02-04 09:00:00', 'waiting')
    `).run(),
    /checkin_date is required/
  );
  assert.throws(
    () => sqlite.prepare("UPDATE checkins SET checkin_date = NULL WHERE id = 1").run(),
    /checkin_date is required/
  );
});

test('duplicate active legacy check-ins fail with an actionable migration error', () => {
  const duplicatePath = path.join(tempDirectory, 'duplicates.test.db');
  createLegacyDatabase(duplicatePath, { duplicateActiveCheckins: true });
  try {
    const result = spawnSync(process.execPath, ['-e', "require('./config/database')"], {
      cwd: serverDirectory,
      env: { ...process.env, DB_PATH: duplicatePath, JWT_SECRET: process.env.JWT_SECRET },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot enforce one active check-in per patient per day/i);
  } finally {
    removeDatabase(duplicatePath);
  }
});

test('widening the payment method constraint preserves existing payments', () => {
  const paymentsPath = path.join(tempDirectory, 'legacy-payments.test.db');
  createLegacyPaymentsDatabase(paymentsPath);
  const db = new Database(paymentsPath);
  try {
    const script = `
      const pool = require(process.env.HMS_DATABASE_MODULE);
      const { sqlite } = pool;
      const methods = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'").get().sql;
      if (!methods.includes("'upi'") || !methods.includes("'cheque'")) {
        throw new Error('payment method constraint was not widened');
      }
      if (!methods.includes("'mobile_money'")) {
        throw new Error('mobile_money was not added to the payment method constraint');
      }
      const columns = sqlite.prepare('PRAGMA table_info(payments)').all().map(column => column.name);
      for (const expected of ['status', 'provider', 'provider_reference', 'failure_reason', 'completed_at']) {
        if (!columns.includes(expected)) throw new Error('missing payments column: ' + expected);
      }
      const rows = sqlite.prepare('SELECT payment_number, payment_method, transaction_reference, status FROM payments ORDER BY id').all();
      const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_payment_transaction_reference'").all();
      if (rows.length !== 2) throw new Error('expected 2 preserved payments, got ' + rows.length);
      if (rows[0].transaction_reference !== 'legacy-ref-1') throw new Error('payment rows were not copied verbatim');
      // Money taken before settlement states existed was collected by hand, so
      // it must be migrated as completed or every historical bill would read as
      // unpaid.
      if (rows.some(row => row.status !== 'completed')) throw new Error('legacy payments were not migrated as completed');
      if (indexes.length !== 1) throw new Error('the transaction reference index was not recreated');
      // The rebuilt table must still reject values outside the configured list.
      let rejected = false;
      try {
        sqlite.prepare("INSERT INTO payments (uuid, payment_number, bill_id, patient_id, amount, payment_method) VALUES ('x', 'PAY-X', 1, 1, 1, 'cryptocurrency')").run();
      } catch (error) {
        rejected = /CHECK constraint failed/i.test(error.message);
      }
      if (!rejected) throw new Error('the rebuilt table accepted an unknown payment method');
      let badStatus = false;
      try {
        sqlite.prepare("INSERT INTO payments (uuid, payment_number, bill_id, patient_id, amount, payment_method, status) VALUES ('y', 'PAY-Y', 1, 1, 1, 'cash', 'maybe')").run();
      } catch (error) {
        badStatus = /CHECK constraint failed/i.test(error.message);
      }
      if (!badStatus) throw new Error('the rebuilt table accepted an unknown payment status');
      pool.close();
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: serverDirectory,
      env: {
        ...process.env,
        DB_PATH: paymentsPath,
        JWT_SECRET: process.env.JWT_SECRET,
        HMS_DATABASE_MODULE: path.join(serverDirectory, 'config', 'database.js'),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    // Re-running the migration must be a no-op rather than a second rebuild.
    const rerun = spawnSync(process.execPath, ['-e', "require(process.env.HMS_DATABASE_MODULE).close();"], {
      cwd: serverDirectory,
      env: {
        ...process.env,
        DB_PATH: paymentsPath,
        JWT_SECRET: process.env.JWT_SECRET,
        HMS_DATABASE_MODULE: path.join(serverDirectory, 'config', 'database.js'),
      },
      encoding: 'utf8',
    });
    assert.equal(rerun.status, 0, rerun.stderr);
    const verified = new Database(paymentsPath, { readonly: true });
    assert.equal(verified.prepare('SELECT COUNT(*) AS count FROM payments').get().count, 2);
    verified.close();
  } finally {
    db.close();
    removeDatabase(paymentsPath);
  }
});

test('relative DB paths resolve from the server directory', () => {
  const fileName = `hms-relative-${randomUUID()}.db`;
  const expectedPath = path.join(serverDirectory, fileName);
  try {
    const result = spawnSync(
      process.execPath,
      ['-e', "const pool=require(process.env.HMS_DATABASE_MODULE); console.log(pool.dbPath); pool.close();"],
      {
        cwd: tempDirectory,
        env: {
          ...process.env,
          DB_PATH: fileName,
          HMS_DATABASE_MODULE: path.join(serverDirectory, 'config', 'database.js'),
          NODE_ENV: 'test',
        },
        encoding: 'utf8',
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), expectedPath);
    assert.equal(fs.existsSync(expectedPath), true);
  } finally {
    removeDatabase(expectedPath);
  }
});

test('production demo seeding is rejected before a database is created', () => {
  const guardedPath = path.join(tempDirectory, 'production-seed-guard.db');
  removeDatabase(guardedPath);
  const result = spawnSync(process.execPath, ['config/seed.js'], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      DB_PATH: guardedPath,
      NODE_ENV: 'production',
      ALLOW_DEMO_SEED: 'false',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Demo seeding is disabled in production/i);
  assert.equal(fs.existsSync(guardedPath), false);
});

test('demo seeding refuses to add fixtures to a non-empty database', () => {
  const guardedPath = path.join(tempDirectory, 'nonempty-seed-guard.db');
  removeDatabase(guardedPath);
  const setup = spawnSync(process.execPath, ['config/setup.js'], {
    cwd: serverDirectory,
    env: { ...process.env, DB_PATH: guardedPath, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  assert.equal(setup.status, 0, setup.stderr);

  const database = new Database(guardedPath);
  database.prepare("INSERT INTO specialties (name, description) VALUES ('Existing', 'Must be preserved')").run();
  database.close();

  const seedResult = spawnSync(process.execPath, ['config/seed.js'], {
    cwd: serverDirectory,
    env: { ...process.env, DB_PATH: guardedPath, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  assert.notEqual(seedResult.status, 0);
  assert.match(`${seedResult.stdout}\n${seedResult.stderr}`, /requires an empty application database/i);

  const verified = new Database(guardedPath, { readonly: true });
  const [specialty] = verified.prepare("SELECT name FROM specialties WHERE name = 'Existing'").all();
  verified.close();
  assert.equal(specialty.name, 'Existing');
  removeDatabase(guardedPath);
});
