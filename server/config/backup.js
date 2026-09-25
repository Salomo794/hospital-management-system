#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadEnvironment, serverDirectory } = require('./environment');

// A hospital database is the only copy of every patient record, so a backup
// that has never been restored is not a backup. This script makes a consistent
// online copy, keeps a rolling window, and can verify the result.
//
// SQLite's VACUUM INTO is used rather than a file copy: it takes a read lock,
// writes a fully defragmented single file, and is safe to run while the API is
// serving traffic. Copying the .db file directly would capture a torn page if a
// write landed mid-copy.

const DEFAULT_KEEP = 14;
const USAGE = `Usage: npm run db:backup [options]

Options:
  --dir <path>       Where to write backups (default: server/backups)
  --keep <n>         How many backups to retain (default: ${DEFAULT_KEEP})
  --label <text>     Extra note recorded in the manifest, e.g. "pre-upgrade"
  --restore <file>   Restore a backup into the configured database, then exit
  --verify <file>    Check a backup opens and passes its integrity check
  --list             Show retained backups, newest first

Examples:
  npm run db:backup -- --label nightly
  npm run db:backup -- --list
  npm run db:backup -- --verify server/backups/hospital-2026-01-16.db
  npm run db:backup -- --restore server/backups/hospital-2026-01-16.db
`;

function parseArgs(argv) {
  const options = { keep: DEFAULT_KEEP };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) {
        console.error(`Error: ${arg} needs a value.`);
        process.exit(1);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case '--dir': options.dir = next(); break;
      case '--keep': options.keep = Number.parseInt(next(), 10); break;
      case '--label': options.label = next(); break;
      case '--restore': options.restore = next(); break;
      case '--verify': options.verify = next(); break;
      case '--list': options.list = true; break;
      case '--help':
      case '-h': console.log(USAGE); process.exit(0); break;
      default:
        console.error(`Unknown option "${arg}".\n\n${USAGE}`);
        process.exit(1);
    }
  }
  return options;
}

function timestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('');
}

function resolveDatabasePath() {
  const configured = process.env.DB_PATH || 'hospital.db';
  if (configured === ':memory:') {
    console.error('Refusing to back up an in-memory database. Set DB_PATH to a file first.');
    process.exit(1);
  }
  return path.isAbsolute(configured) ? configured : path.resolve(serverDirectory, configured);
}

function backupDirectory(options) {
  return options.dir
    ? path.resolve(options.dir)
    : path.join(serverDirectory, 'backups');
}

function listBackups(options) {
  const directory = backupDirectory(options);
  if (!fs.existsSync(directory)) {
    console.log(`No backups yet. Expected them in ${directory}`);
    return [];
  }
  const files = fs
    .readdirSync(directory)
    .filter(name => /^hospital-.*\.db$/.test(name))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.log(`No backups found in ${directory}`);
    return [];
  }
  console.log(`Backups in ${directory} (${files.length}):`);
  for (const name of files) {
    const full = path.join(directory, name);
    const sizeMb = (fs.statSync(full).size / (1024 * 1024)).toFixed(2);
    console.log(`  ${name}  ${sizeMb} MB`);
  }
  return files.map(name => path.join(directory, name));
}

function verify(file) {
  if (!fs.existsSync(file)) {
    console.error(`Backup not found: ${file}`);
    process.exit(1);
  }
  const Database = require('better-sqlite3');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    // integrity_check is the only way to know a copy is actually usable.
    const [result] = db.pragma('integrity_check');
    if (result.integrity_check !== 'ok') {
      console.error(`Integrity check failed for ${file}: ${JSON.stringify(result)}`);
      process.exit(1);
    }
    const tableCount = db
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'")
      .get().c;
    let rowCounts = '';
    for (const table of ['patients', 'users', 'bills', 'payments', 'medical_records', 'lab_orders']) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      if (!exists) continue;
      const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
      rowCounts += `\n    ${table.padEnd(18)} ${c} rows`;
    }
    console.log(`Backup is valid: ${file}`);
    console.log(`  integrity_check  ok`);
    console.log(`  tables           ${tableCount}`);
    console.log(`  row counts:${rowCounts}`);
    return true;
  } finally {
    db.close();
  }
}

function rotate(directory, keep) {
  const files = fs
    .readdirSync(directory)
    .filter(name => /^hospital-.*\.db$/.test(name))
    .sort()
    .reverse();
  const doomed = files.slice(keep);
  for (const name of doomed) {
    fs.rmSync(path.join(directory, name), { force: true });
    console.log(`  removed old backup ${name}`);
  }
  return files.length - doomed.length;
}

function create(options) {
  const databasePath = resolveDatabasePath();
  if (!fs.existsSync(databasePath)) {
    console.error(`No database at ${databasePath}. Run npm run db:setup first.`);
    process.exit(1);
  }

  const directory = backupDirectory(options);
  fs.mkdirSync(directory, { recursive: true });

  const name = `hospital-${timestamp()}.db`;
  const target = path.join(directory, name);
  if (fs.existsSync(target)) {
    console.error(`Refusing to overwrite an existing backup: ${target}`);
    process.exit(1);
  }

  const Database = require('better-sqlite3');
  // Opening the source read-only means a backup can never mutate live data, and
  // the WAL is checkpointed into the copy by VACUUM INTO.
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    db.prepare('VACUUM INTO ?').run(target);
  } catch (error) {
    fs.rmSync(target, { force: true });
    console.error(`Backup failed: ${error.message}`);
    process.exit(1);
  } finally {
    db.close();
  }

  const sizeMb = (fs.statSync(target).size / (1024 * 1024)).toFixed(2);
  const manifest = {
    created_at: new Date().toISOString(),
    source: path.basename(databasePath),
    file: name,
    size_bytes: fs.statSync(target).size,
    label: options.label || null,
    app_timezone: process.env.APP_TIMEZONE || 'Africa/Kigali',
  };
  fs.writeFileSync(`${target}.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Backup written: ${target}  (${sizeMb} MB)`);
  if (options.label) console.log(`  label: ${options.label}`);

  // Never report success on a copy that cannot be read back.
  verify(target);

  const kept = rotate(directory, options.keep);
  console.log(`  retaining ${kept} backup(s) in ${directory}`);
  console.log('  restore with: npm run db:backup -- --restore ' + target);
  return target;
}

function restore(file) {
  verify(file);
  const databasePath = resolveDatabasePath();
  const directory = path.dirname(databasePath);

  console.log('');
  console.log(`This will replace ${databasePath} with ${file}.`);
  // Preserve whatever is there now, so a restore is itself reversible.
  if (fs.existsSync(databasePath)) {
    const safety = path.join(directory, `pre-restore-${timestamp()}.db`);
    fs.copyFileSync(databasePath, safety);
    console.log(`The current database has been copied to ${safety} first.`);
  }
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  fs.copyFileSync(file, databasePath);
  console.log(`Restored. Restart the API to pick up the restored data.`);
}

function main() {
  loadEnvironment();
  const options = parseArgs(process.argv.slice(2));
  if (options.list) { listBackups(options); return; }
  if (options.verify) { verify(path.resolve(options.verify)); return; }
  if (options.restore) { restore(path.resolve(options.restore)); return; }
  create(options);
}

main();
