const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'hospital.db');
const sqlite = new Database(dbPath);

// Enable WAL mode for better performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// MySQL2-compatible pool interface
const pool = {
  query(sql, params = []) {
    // MySQL2 returns [rows, fields]. We emulate that.
    const trimmed = sql.trim().toUpperCase();

    // SELECT queries
    if (trimmed.startsWith('SELECT')) {
      try {
        const stmt = sqlite.prepare(sql);
        const rows = stmt.all(...params);
        return Promise.resolve([rows, []]);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    // INSERT queries
    if (trimmed.startsWith('INSERT')) {
      try {
        const stmt = sqlite.prepare(sql);
        const result = stmt.run(...params);
        return Promise.resolve([{ insertId: result.lastInsertRowid, affectedRows: result.changes }, []]);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    // UPDATE / DELETE queries
    if (trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE')) {
      try {
        const stmt = sqlite.prepare(sql);
        const result = stmt.run(...params);
        return Promise.resolve([{ affectedRows: result.changes }, []]);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    // CREATE TABLE and other DDL
    try {
      sqlite.exec(sql);
      return Promise.resolve([{}, []]);
    } catch (err) {
      return Promise.reject(err);
    }
  },

  getConnection() {
    return {
      query(sql, params = []) { return pool.query(sql, params); },
      beginTransaction() { sqlite.pragma('defer_foreign_keys'); sqlite.exec('BEGIN'); return Promise.resolve(); },
      commit() { sqlite.exec('COMMIT'); sqlite.pragma('foreign_keys = ON'); return Promise.resolve(); },
      rollback() { sqlite.exec('ROLLBACK'); sqlite.pragma('foreign_keys = ON'); return Promise.resolve(); },
      release() { /* no-op for SQLite */ }
    };
  }
};

module.exports = pool;
