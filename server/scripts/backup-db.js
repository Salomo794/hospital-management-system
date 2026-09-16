const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'hospital.db');
const BACKUP_DIR = path.resolve(__dirname, '..', process.env.BACKUP_DIR || './backups');

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database file not found: ${DB_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `hospital-backup-${stamp}.db`);

  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(dest);
    console.log(`Backup created: ${dest}`);
  } finally {
    db.close();
  }
}

main();