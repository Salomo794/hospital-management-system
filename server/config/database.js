const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'hospital.db');
const sqlite = new Database(dbPath);

// Enable WAL mode for better performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// --- Lightweight idempotent migrations (keeps existing DBs in sync) ---
function columnExists(table, column) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

function migrate() {
  // drug_interactions (was missing from setup.js — fresh DBs would fail to seed)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS drug_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_a_id INTEGER NOT NULL,
    medicine_b_id INTEGER NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('mild','moderate','severe','contraindicated')),
    description TEXT,
    clinical_management TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (medicine_a_id) REFERENCES medicines(id) ON DELETE CASCADE,
    FOREIGN KEY (medicine_b_id) REFERENCES medicines(id) ON DELETE CASCADE
  )`);

  // checkins — kiosk / patient portal quick flow
  sqlite.exec(`CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    patient_id INTEGER NOT NULL,
    appointment_id INTEGER,
    checkin_time TEXT DEFAULT (datetime('now')),
    purpose TEXT,
    status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','in_consultation','completed','no_show','cancelled')),
    qr_token TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
  )`);

  // patients.portal_pin — patient self-service login
  if (!columnExists('patients', 'portal_pin')) {
    sqlite.exec('ALTER TABLE patients ADD COLUMN portal_pin TEXT');
    sqlite.exec("UPDATE patients SET portal_pin = '' WHERE portal_pin IS NULL");
  }

  // Backfill a default demo PIN for any patient that still lacks one.
  // COALESCE keeps already-set pins untouched on subsequent starts.
  const defaultPinHash = bcrypt.hashSync('password123', 4);
  sqlite.prepare('UPDATE patients SET portal_pin = COALESCE(portal_pin, ?) WHERE portal_pin IS NULL OR portal_pin = ?').run(defaultPinHash, '');
}

migrate();

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
