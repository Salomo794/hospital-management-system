const { loadEnvironment } = require('./environment');
loadEnvironment();

const fs = require('fs');
const mysql = require('mysql2/promise');
const { translateSql } = require('./mysqlSql');
const isTestEnvironment = process.env.NODE_ENV === 'test';
if (isTestEnvironment) require('./testDatabase');

function toMysqlDateTime(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'string') {
    return value.replace(
      /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/,
      '$1 $2'
    );
  }
  return value;
}

function normalizeParams(params = []) {
  return params.map(param => {
    if (param === undefined || param === null) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    return toMysqlDateTime(param);
  });
}

function mysqlDatabaseOptions(connectionUrl) {
  if (!connectionUrl) {
    throw new Error('DATABASE_URL is required. Set it to a MySQL connection URL such as ******host:3306/hospital.');
  }

  let url;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid MySQL connection URL.');
  }

  if (url.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL must use the mysql:// scheme.');
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const user = decodeURIComponent(url.username);
  if (!url.hostname || !database || !user) {
    throw new Error('DATABASE_URL must include a MySQL user, host, and database name.');
  }

  const sslEnabled = process.env.DATABASE_SSL === 'true';
  const sslCaPath = String(process.env.DATABASE_SSL_CA || '').trim();
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user,
    password: decodeURIComponent(url.password),
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    decimalNumbers: true,
    ...(sslEnabled
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(sslCaPath ? { ca: fs.readFileSync(sslCaPath, 'utf8') } : {}),
          },
        }
      : {}),
  };
}

const configuredDatabaseUrl = String(
  isTestEnvironment ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL || ''
).trim();
const mysqlPool = mysql.createPool(mysqlDatabaseOptions(configuredDatabaseUrl));

async function setUtcTimezone(connection) {
  await connection.query("SET time_zone = '+00:00'");
}

function wrapConnection(connection) {
  return {
    query(sql, params = []) {
      return connection.query(translateSql(sql), normalizeParams(params));
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
    destroy() {
      connection.destroy();
    },
    release() {
      connection.release();
    },
  };
}

const pool = {
  async query(sql, params = []) {
    const connection = await mysqlPool.getConnection();
    try {
      await setUtcTimezone(connection);
      return await connection.query(translateSql(sql), normalizeParams(params));
    } finally {
      connection.release();
    }
  },

  async getConnection() {
    const connection = await mysqlPool.getConnection();
    try {
      await setUtcTimezone(connection);
      return wrapConnection(connection);
    } catch (error) {
      connection.release();
      throw error;
    }
  },

  async runTransaction(callback) {
    const connection = await mysqlPool.getConnection();
    let destroyed = false;
    try {
      await setUtcTimezone(connection);
      await connection.beginTransaction();
      const result = await callback(wrapConnection(connection));
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        connection.destroy();
        destroyed = true;
        throw new AggregateError(
          [error, rollbackError],
          'Database operation and rollback both failed.'
        );
      }
      throw error;
    } finally {
      if (!destroyed) connection.release();
    }
  },

  async isReady() {
    await pool.query('SELECT 1');
    const [tables] = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'users'`
    );
    if (tables.length === 0) {
      throw new Error('MySQL schema is not initialized. Run npm run db:setup.');
    }
    return true;
  },

  close() {
    return mysqlPool.end();
  },
};

module.exports = Object.assign(pool, {
  useMySQL: true,
  mysqlPool,
  databaseOptions: mysqlDatabaseOptions,
  normalizeParams,
});
