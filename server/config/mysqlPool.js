'use strict';

/**
 * MySQL connection layer.
 *
 * This module is the single entry point for the MySQL engine. It exposes the
 * same async contract the application already uses everywhere
 * (`pool.query(sql, params)` resolving to `[rows, fields]`,
 * `pool.runTransaction(fn)`, `pool.getConnection()`, `pool.isReady()`,
 * `pool.close()`), so call sites do not need to know which driver is behind it.
 *
 * Design notes
 * ------------
 * - `dateStrings: true` keeps DATETIME/TIMESTAMP/DATE columns as strings in the
 *   exact `YYYY-MM-DD HH:MM:SS` shape the application already stores and
 *   compares against, so existing date logic keeps working after the move.
 * - `decimalNumbers: true` returns DECIMAL (money) as JS numbers instead of
 *   strings; the RWF amounts in this system are integer francs, so float drift
 *   is not a concern at these magnitudes.
 * - Errors are sanitised before they leave this module: driver errors can carry
 *   the full SQL text (which may include patient data) and, in some paths, the
 *   connection config. Callers get a stable code/errno/sqlState and a generic
 *   message; the raw error is only available via `error.cause` in non-production.
 * - InnoDB is required (the default). Foreign keys are enforced by the engine
 *   itself, so no per-connection `PRAGMA` equivalent is needed.
 */

const { loadEnvironment } = require('./environment');
loadEnvironment();

const mysql = require('mysql2/promise');

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
  host: firstDefined(process.env.DB_HOST, process.env.MYSQL_HOST, '127.0.0.1'),
  port: parsePositiveInt(firstDefined(process.env.DB_PORT, process.env.MYSQL_PORT), 3306),
  user: firstDefined(process.env.DB_USER, process.env.MYSQL_USER, 'root'),
  password: firstDefined(process.env.DB_PASSWORD, process.env.MYSQL_PASSWORD, ''),
  database: firstDefined(process.env.DB_NAME, process.env.MYSQL_DATABASE, 'hms'),
  connectionLimit: parsePositiveInt(process.env.DB_CONNECTION_LIMIT, 10),
  queueLimit: parsePositiveInt(process.env.DB_QUEUE_LIMIT, 0),
  connectTimeout: parsePositiveInt(process.env.DB_CONNECT_TIMEOUT, 10000),
  idleTimeout: parsePositiveInt(process.env.DB_IDLE_TIMEOUT, 60000),
};

const isProduction = process.env.NODE_ENV === 'production';

/** Error codes that mean "the database is not reachable right now". */
const UNAVAILABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ENOTFOUND',
  'EPIPE',
]);

/**
 * Wrap a driver error so no SQL text, parameter values or credentials escape.
 * The original error is preserved on `cause` outside production for debugging.
 */
function sanitizeError(error, context = 'query') {
  const code = error && error.code ? error.code : 'ER_UNKNOWN';
  const wrapped = new Error(
    context === 'connection'
      ? `Database connection failed (${code}).`
      : `Database operation failed (${code}).`
  );
  wrapped.code = code;
  wrapped.errno = error && error.errno !== undefined ? error.errno : undefined;
  wrapped.sqlState = error && error.sqlState !== undefined ? error.sqlState : undefined;
  wrapped.name = 'DatabaseError';
  wrapped.isDatabaseError = true;
  wrapped.isUnavailable = UNAVAILABLE_ERROR_CODES.has(code);
  wrapped.isUniqueViolation = code === 'ER_DUP_ENTRY';
  wrapped.isForeignKeyViolation = code === 'ER_NO_REFERENCED_ROW_2'
    || code === 'ER_ROW_IS_REFERENCED_2';
  wrapped.isDeadlock = code === 'ER_LOCK_DEADLOCK';
  wrapped.isLockTimeout = code === 'ER_LOCK_WAIT_TIMEOUT';
  if (!isProduction) {
    wrapped.cause = error;
  }
  return wrapped;
}

let pool = null;

function getRawPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: config.queueLimit,
    connectTimeout: config.connectTimeout,
    idleTimeout: config.idleTimeout,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    // Do not let a single pathological query pin a pooled connection forever.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });
  return pool;
}

/**
 * Run a statement through the pool.
 * Returns `[rows, fields]` — the shape the previous layer produced.
 */
async function query(sql, params = []) {
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw Object.assign(new Error('query() requires a non-empty SQL string.'), {
      code: 'ER_INVALID_ARGUMENT',
      isDatabaseError: true,
    });
  }
  try {
    const [rows, fields] = await getRawPool().query(sql, params);
    return [rows, fields || []];
  } catch (error) {
    throw sanitizeError(error);
  }
}

/** Minimal wrapper around a single pooled connection used inside transactions. */
function wrapConnection(connection) {
  return {
    async query(sql, params = []) {
      try {
        const [rows, fields] = await connection.query(sql, params);
        return [rows, fields || []];
      } catch (error) {
        throw sanitizeError(error);
      }
    },
    async beginTransaction() {
      try {
        await connection.beginTransaction();
      } catch (error) {
        throw sanitizeError(error);
      }
    },
    async commit() {
      try {
        await connection.commit();
      } catch (error) {
        throw sanitizeError(error);
      }
    },
    async rollback() {
      try {
        await connection.rollback();
      } catch (error) {
        throw sanitizeError(error);
      }
    },
    release() {
      try {
        connection.release();
      } catch {
        // Releasing twice is harmless; never let cleanup mask the real error.
      }
    },
    get raw() {
      return connection;
    },
  };
}

/**
 * Acquire a dedicated connection. The caller owns it and must call `release()`
 * in a `finally` block.
 */
async function getConnection() {
  try {
    const connection = await getRawPool().getConnection();
    return wrapConnection(connection);
  } catch (error) {
    throw sanitizeError(error, 'connection');
  }
}

/**
 * Run `callback` inside a transaction. Commits when the callback resolves,
 * rolls back when it throws (including on commit failure), and always releases
 * the connection back to the pool.
 */
async function runTransaction(callback) {
  if (typeof callback !== 'function') {
    throw Object.assign(new Error('runTransaction() requires a callback.'), {
      code: 'ER_INVALID_ARGUMENT',
      isDatabaseError: true,
    });
  }
  const connection = await getConnection();
  let settled = false;
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    settled = true;
    return result;
  } catch (error) {
    if (!settled) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        // A failing rollback means the server already aborted the transaction.
        // Surface the original failure; log the rollback problem for operators.
        console.error('[database] rollback failed:', sanitizeError(rollbackError).message);
      }
    }
    throw error && error.isDatabaseError ? error : sanitizeError(error);
  } finally {
    connection.release();
  }
}

/** Health probe used by readiness endpoints and the startup check. */
async function isReady() {
  try {
    const [rows] = await getRawPool().query('SELECT 1 AS ok');
    return Array.isArray(rows) && rows.length === 1 && rows[0].ok === 1;
  } catch (error) {
    throw sanitizeError(error, 'connection');
  }
}

/** Verify the schema exists and the server is InnoDB-backed (FK enforcement). */
async function getEngineInfo() {
  const [tables] = await query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE table_schema = ?`,
    [config.database]
  );
  const [engines] = await query(
    `SELECT DISTINCT engine
       FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
    [config.database]
  );
  return {
    database: config.database,
    tableCount: tables.length ? Number(tables[0].table_count) : 0,
    engines: engines.map(row => row.engine),
  };
}

async function close() {
  if (!pool) return;
  const current = pool;
  pool = null;
  try {
    await current.end();
  } catch (error) {
    throw sanitizeError(error, 'connection');
  }
}

module.exports = {
  query,
  runTransaction,
  getConnection,
  isReady,
  getEngineInfo,
  close,
  config: {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    connectionLimit: config.connectionLimit,
  },
};
