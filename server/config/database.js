'use strict';

/**
 * Application data layer.
 *
 * MySQL is the only supported database. This module used to wrap `better-sqlite3`
 * (single file, `PRAGMA`, table rebuilds in `migrate()`); it is now a thin adapter
 * over `config/mysqlPool.js` so the rest of the codebase keeps the same shape it
 * already used:
 *
 *   const [rows]     = await pool.query('SELECT ...', [params]);
 *   const [result]   = await pool.query('INSERT ...', [params]); // .insertId/.affectedRows
 *   await pool.runTransaction(async (conn) => { ... });
 *
 * Two behaviours from the SQLite era are preserved deliberately:
 *
 *  1. Parameter normalisation. The SQLite layer accepted `undefined`, booleans and
 *     `Date` objects. mysql2 does not treat all of those the same way, so they are
 *     normalised once, here.
 *  2. `isReady()` throws an actionable message when the schema is missing instead
 *     of letting every request fail with a raw "table doesn't exist" error.
 */

const mysqlPool = require('./mysqlPool');

/**
 * MySQL DATETIME columns reject the ISO-8601 form (`2025-01-31T08:00:00.000Z`)
 * that the SQLite-era code wrote into TEXT columns, and mysql2 would send it
 * verbatim. Converting here fixes the TEXT-vs-DATETIME mismatch in one place
 * rather than at each of the hundreds of call sites.
 */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function toMysqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeParams(params) {
  if (params === undefined || params === null) return [];
  const list = Array.isArray(params) ? params : [params];
  return list.map(param => {
    if (param === undefined || param === null) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    if (param instanceof Date) return toMysqlDateTime(param);
    if (typeof param === 'string' && ISO_DATE_TIME.test(param)) return toMysqlDateTime(param);
    return param;
  });
}

const pool = {
  async query(sql, params = []) {
    return mysqlPool.query(sql, normalizeParams(params));
  },

  async getConnection() {
    const connection = await mysqlPool.getConnection();
    return {
      async query(sql, params = []) {
        return connection.query(sql, normalizeParams(params));
      },
      beginTransaction() {
        return connection.beginTransaction();
      },
      commit() {
        return connection.commit();
      },
      rollback() {
        return connection.rollback();
      },
      release() {
        return connection.release();
      },
      get raw() {
        return connection.raw;
      },
    };
  },

  async runTransaction(callback) {
    return mysqlPool.runTransaction(connection => callback({
      async query(sql, params = []) {
        return connection.query(sql, normalizeParams(params));
      },
      beginTransaction() {
        return connection.beginTransaction();
      },
      commit() {
        return connection.commit();
      },
      rollback() {
        return connection.rollback();
      },
      release() {
        return connection.release();
      },
      get raw() {
        return connection.raw;
      },
    }));
  },

  /** Verify the connection works and the schema has been applied. */
  async isReady() {
    await mysqlPool.isReady();
    const [rows] = await mysqlPool.query(
      `SELECT COUNT(*) AS count FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    const count = rows.length ? Number(rows[0].count) : 0;
    if (count === 0) {
      throw new Error('Database schema is not initialized. Run npm run setup.');
    }
    return true;
  },

  /** Engine/database metadata, used by health endpoints and tests. */
  getEngineInfo() {
    return mysqlPool.getEngineInfo();
  },

  close() {
    return mysqlPool.close();
  },

  config: mysqlPool.config,
};

module.exports = pool;
module.exports.normalizeParams = normalizeParams;
module.exports.toMysqlDateTime = toMysqlDateTime;
