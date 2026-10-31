/**
 * Guards the MySQL schema (config/schema.mysql.sql) that is replacing the
 * SQLite DDL in config/setup.js.
 *
 * The static checks run everywhere, including CI without a database: they
 * encode the exact mistakes that a hand-written SQLite -> MySQL port makes
 * (AUTOINCREMENT, DEFAULT on TEXT, REAL money, dangling foreign keys, mixed
 * signed/unsigned key types). The live check additionally proves the file is
 * actually executable, and skips visibly — never passes — without a server.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const schemaPath = path.join(__dirname, '..', 'config', 'schema.mysql.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

/** Split the file into individual CREATE TABLE statements. */
function createTableStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => /^CREATE TABLE/i.test(s));
}

const statements = createTableStatements(schema);
const tableNames = statements.map((s) => s.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i)[1]);

test('schema defines the full set of hospital tables', () => {
  assert.ok(statements.length >= 25, `expected >=25 tables, found ${statements.length}`);
  for (const required of [
    'users', 'patients', 'appointments', 'medical_records', 'prescriptions',
    'prescription_items', 'medicines', 'lab_orders', 'lab_order_items',
    'bills', 'payments', 'admissions', 'suppliers', 'purchase_orders',
    'audit_log', 'notifications'
  ]) {
    assert.ok(tableNames.includes(required), `missing table: ${required}`);
  }
  assert.strictEqual(new Set(tableNames).size, tableNames.length, 'duplicate table definition');
});

test('schema contains no SQLite-only syntax', () => {
  const banned = [
    [/AUTOINCREMENT/i, 'AUTOINCREMENT is SQLite-only; use AUTO_INCREMENT'],
    [/datetime\s*\(\s*'now'\s*\)/i, "datetime('now') is SQLite-only; use CURRENT_TIMESTAMP"],
    [/date\s*\(\s*'now'\s*\)/i, "date('now') is SQLite-only; use CURRENT_DATE"],
    [/\bPRAGMA\b/i, 'PRAGMA is SQLite-only'],
    [/sqlite_master/i, 'sqlite_master is SQLite-only'],
    [/\bINSERT OR (IGNORE|REPLACE)\b/i, 'use INSERT IGNORE / REPLACE on MySQL'],
    [/\bAUTOINCREMENT\b/i, 'duplicate AUTOINCREMENT marker']
  ];
  for (const [pattern, message] of banned) {
    assert.ok(!pattern.test(schema), message);
  }
});

test('every table is InnoDB with utf8mb4', () => {
  for (const statement of statements) {
    const name = statement.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i)[1];
    assert.match(statement, /ENGINE=InnoDB/i, `${name}: must use InnoDB for foreign keys/transactions`);
    assert.match(statement, /CHARSET=utf8mb4/i, `${name}: must use utf8mb4 (Kinyarwanda accents)`);
  }
});

test('no TEXT/BLOB column carries a DEFAULT (rejected by MySQL)', () => {
  for (const statement of statements) {
    const name = statement.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i)[1];
    for (const line of statement.split('\n')) {
      if (/\b(TEXT|BLOB|LONGTEXT|MEDIUMTEXT)\b/i.test(line) && /\bDEFAULT\b/i.test(line)) {
        assert.fail(`${name}: MySQL rejects DEFAULT on TEXT -> ${line.trim()}`);
      }
    }
  }
});

test('money is DECIMAL, never floating point', () => {
  for (const statement of statements) {
    const name = statement.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i)[1];
    assert.ok(
      !/\b(amount|total|price|cost|discount|tax|fee)\w*\s+REAL\b/i.test(statement),
      `${name}: monetary column uses REAL; use DECIMAL to avoid rounding drift`
    );
  }
});

test('every foreign key points at a table defined in this schema', () => {
  const known = new Set(tableNames);
  const refs = [...schema.matchAll(/REFERENCES\s+`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)/gi)];
  assert.ok(refs.length >= 40, `expected >=40 foreign keys, found ${refs.length}`);
  for (const [, table, column] of refs) {
    assert.ok(known.has(table), `foreign key references undefined table: ${table}`);
    assert.strictEqual(column, 'id', `unexpected foreign key target ${table}(${column})`);
  }
});

test('foreign key column types match the referenced primary key type', () => {
  // users.id etc. are signed INT; a port that emits INT UNSIGNED for the
  // parent breaks every child FK with errno 150 "incorrectly formed".
  assert.ok(!/INT\s+UNSIGNED/i.test(schema), 'key types must not mix signed and unsigned integers');
  for (const statement of statements) {
    const name = statement.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i)[1];
    assert.match(
      statement,
      /\bid\s+INT\s+NOT\s+NULL\s+AUTO_INCREMENT\s+PRIMARY\s+KEY/i,
      `${name}: primary key must be INT NOT NULL AUTO_INCREMENT PRIMARY KEY`
    );
    for (const [, refTable] of statement.matchAll(/REFERENCES\s+`?(\w+)`?/gi)) {
      const parent = statements.find((s) => new RegExp(`CREATE TABLE IF NOT EXISTS\\s+\`?${refTable}\`?\\b`, 'i').test(s));
      assert.ok(parent, `${name}: references ${refTable} which is not defined`);
      assert.match(parent, /\bid\s+INT\s+NOT\s+NULL\s+AUTO_INCREMENT/i,
        `${name} -> ${refTable}: referenced id is not a matching INT AUTO_INCREMENT column`);
    }
  }
});

test('delete rules are explicit on every foreign key', () => {
  for (const statement of statements) {
    const name = statement.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i)[1];
    for (const line of statement.split('\n')) {
      if (/FOREIGN KEY/i.test(line)) {
        assert.match(line, /ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)/i,
          `${name}: foreign key without an explicit ON DELETE rule -> ${line.trim()}`);
      }
    }
  }
});

test('live: schema applies to a real MySQL/MariaDB server', async (t) => {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    t.skip('mysql2 not installed');
    return;
  }

  const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  };

  let connection;
  try {
    connection = await mysql.createConnection(config);
  } catch (error) {
    t.skip(`MySQL unavailable (${error.code || error.message})`);
    return;
  }

  const dbName = `hms_schema_test_${process.pid}`;
  try {
    await connection.query(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4`);
    await connection.query(`USE ${dbName}`);
    await connection.query(schema);

    const [tables] = await connection.query(
      'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ?', [dbName]);
    assert.strictEqual(Number(tables[0].c), statements.length, 'not every table was created');

    const [fks] = await connection.query(
      'SELECT COUNT(*) AS c FROM information_schema.referential_constraints WHERE constraint_schema = ?', [dbName]);
    assert.ok(Number(fks[0].c) >= 40, `expected >=40 foreign keys, got ${fks[0].c}`);

    // Re-applying must be safe: setup() runs on every boot.
    await connection.query(schema);
  } finally {
    await connection.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
    await connection.end().catch(() => {});
  }
});
