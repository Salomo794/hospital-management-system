'use strict';
/**
 * Per-test-file MySQL database.
 *
 * The suite used to give every test file a throwaway SQLite file. MySQL is now
 * the only database, so each test file instead gets a private `hms_test_*`
 * schema: files already run sequentially (`node --test --test-concurrency=1`)
 * but separate schemas keep them isolated and let the whole suite share one
 * server.
 *
 * Call useTestDatabase() BEFORE requiring ../index or ../config/database:
 * config/mysqlPool snapshots the environment when it is first loaded.
 */
const path = require('path');

function connectionConfig() {
  return {
    host: process.env.DB_HOST || process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    multipleStatements: false,
  };
}

function sanitizeName(value) {
  const cleaned = String(value).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-40).replace(/^_+/, '') || 'test';
}

function uniqueName(testFile, suffix = '') {
  const base = sanitizeName(path.basename(testFile, '.test.js'));
  const extra = suffix ? `_${sanitizeName(suffix)}` : '';
  return `hms_test_${base}${extra}`.slice(0, 64);
}

/** Points DB_NAME at a private schema for this file and drops any SQLite fixture. */
function useTestDatabase(testFile, options = {}) {
  const name = uniqueName(testFile, options.suffix);
  process.env.DB_NAME = name;
  // A leftover DB_PATH would make it look as though a SQLite database is still
  // in play; the schema is created from scratch by config/setup.js instead.
  delete process.env.DB_PATH;
  return name;
}

/** A new schema name for code that must observe a genuinely empty database. */
function freshTestDatabaseName(prefix = 'scratch') {
  return uniqueName(prefix, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
}

async function dropTestDatabase(name) {
  if (!name) return;
  let connection;
  try {
    const mysql = require('mysql2/promise');
    connection = await mysql.createConnection(connectionConfig());
    await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
  } catch (error) {
    // Cleanup must never mask the assertion result.
    if (process.env.DEBUG_TEST_DB) console.error(`drop database ${name} failed:`, error.message);
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

module.exports = {
  useTestDatabase,
  freshTestDatabaseName,
  dropTestDatabase,
  connectionConfig,
};
