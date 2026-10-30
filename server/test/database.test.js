const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:root@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const pool = require('../config/database');
const setupDatabase = require('../config/setup');
const { translateSql } = require('../config/mysqlSql');

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
    '2026-10-30 16:33:14',
    '2026-10-30 16:33:14',
  ]);
  const [rows] = await pool.query('SELECT ? AS date_from_object, ? AS date_from_string', [
    date,
    '2026-10-30T16:33:14.162Z',
  ]);
  assert.equal(rows[0].date_from_object, '2026-10-30 16:33:14');
  assert.equal(rows[0].date_from_string, '2026-10-30 16:33:14');
});

test('translates legacy string concatenation to MySQL CONCAT', () => {
  assert.equal(
    translateSql("SELECT first_name || ' ' || last_name AS full_name FROM users"),
    "SELECT CONCAT(first_name, ' ', last_name) AS full_name FROM users"
  );
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
});
