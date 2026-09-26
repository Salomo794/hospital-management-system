#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadEnvironment, serverDirectory } = require('./environment');
const crypto = require('crypto');
const os = require('os');
const backupCrypto = require('../utils/backupCrypto');

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
  --require          Treat a missing database as a failure rather than a
                     first run, for unattended scheduled jobs
  --restore <file>   Restore a backup into the configured database, then exit
  --verify <file>    Check a backup opens and passes its integrity check
  --list             Show retained backups, newest first

Exit codes:
  0  a backup was taken and verified, or there was no database to copy yet
  1  the backup failed, could not be verified, or was refused

Examples:
  npm run db:backup -- --label nightly
  npm run db:backup -- --list
  npm run db:backup -- --verify server/backups/hospital-2026-01-16.db
  npm run db:backup -- --restore server/backups/hospital-2026-01-16.db
  npm run db:backup -- --label nightly --require
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
      case '--require': options.requireDatabase = true; break;
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

// Milliseconds are included because a name with only second precision collides:
// the launcher takes a backup on every start, and two restarts inside the same
// second - a crash loop, a supervised restart - would produce the same filename
// and the second run would refuse rather than overwrite. The format is
// fixed-width, so the names still sort chronologically as plain strings.
function timestamp(date = new Date()) {
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    '-',
    pad(date.getUTCMilliseconds(), 3),
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

// An encrypted backup cannot be opened as a database, so it is decrypted to a
// scratch file first and that is what gets checked. The decrypted copy is removed
// whatever happens: a temporary plaintext database of patient records is exactly
// the thing this feature exists to avoid leaving behind.
function withDecryptedCopy(file, action) {
  if (!backupCrypto.looksEncrypted(file)) return action(file);

  const scratch = path.join(
    os.tmpdir(),
    `hms-verify-${process.pid}-${crypto.randomBytes(6).toString('hex')}.db`
  );
  try {
    try {
      backupCrypto.decryptFile(file, scratch);
    } catch (error) {
      // A wrong key is an operator mistake, not a crash. Report it as one
      // instead of letting a stack trace be the user interface.
      console.error(`Could not open ${file}: ${error.message}`);
      process.exit(1);
    }
    return action(scratch);
  } finally {
    // A temporary plaintext copy of every patient record is exactly the thing
    // this feature exists to avoid leaving behind, so it goes either way.
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(`${scratch}${suffix}`, { force: true }); } catch { /* best effort */ }
    }
  }
}

function verify(file) {
  if (!fs.existsSync(file)) {
    console.error(`Backup not found: ${file}`);
    process.exit(1);
  }
  if (backupCrypto.looksEncrypted(file) && !backupCrypto.isEnabled()) {
    console.error(`${file} is encrypted, but BACKUP_ENCRYPTION_KEY is not set, so it cannot be checked.`);
    process.exit(1);
  }
  withDecryptedCopy(file, decrypted => verifyDatabase(decrypted, file));
}

function verifyDatabase(target, original) {
  const Database = require('better-sqlite3');
  const db = new Database(target, { readonly: true, fileMustExist: true });
  try {
    // integrity_check is the only way to know a copy is actually usable.
    const [result] = db.pragma('integrity_check');
    if (result.integrity_check !== 'ok') {
      console.error(`Integrity check failed for ${original}: ${JSON.stringify(result)}`);
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
    console.log(`Backup is valid: ${original}`);
    console.log('  integrity_check  ok');
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
    // A first run has no database to copy yet. That is a normal state, not a
    // failure, so the launcher can take a backup before migrating without
    // blocking a fresh install. This keeps the contract simple: exit 0 means
    // "there is a good copy, or there was nothing to copy".
    console.log(`No database at ${databasePath} yet, so there is nothing to back up yet.`);
    if (options.requireDatabase) {
      console.error('--require was passed, so this counts as a failure.');
      process.exit(1);
    }
    process.exit(0);
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
    // Recorded so an operator can tell at a glance whether a given archive was
    // written with encryption, without having to open it.
    encrypted: false,
  };

  // Encrypt in place, then drop the plaintext copy immediately. If encryption
  // fails the plaintext is removed rather than left behind, because leaving an
  // unencrypted patient archive next to a failed attempt is the worst outcome.
  if (backupCrypto.isEnabled()) {
    try {
      backupCrypto.encryptFile(target, `${target}.tmp`);
      fs.rmSync(target, { force: true });
      fs.renameSync(`${target}.tmp`, target);
      manifest.encrypted = true;
      manifest.size_bytes = fs.statSync(target).size;
    } catch (error) {
      fs.rmSync(`${target}.tmp`, { force: true });
      fs.rmSync(target, { force: true });
      console.error(`Backup failed during encryption, and the plaintext copy has been removed: ${error.message}`);
      process.exit(1);
    }
  }

  fs.writeFileSync(`${target}.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const finalMb = (fs.statSync(target).size / (1024 * 1024)).toFixed(2);
  console.log(`Backup written: ${target}  (${finalMb} MB${manifest.encrypted ? ', encrypted' : ''})`);
  if (options.label) console.log(`  label: ${options.label}`);
  if (!manifest.encrypted) {
    console.log('  note: BACKUP_ENCRYPTION_KEY is not set, so this archive is in plaintext.');
  }

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

  if (backupCrypto.looksEncrypted(file)) {
    // Decrypt straight onto the database path: the plaintext never exists as a
    // separate file that could be left behind by a failure partway through.
    try {
      backupCrypto.decryptFile(file, databasePath);
    } catch (error) {
      console.error(`Restore failed: ${error.message}`);
      console.error(`The previous database is preserved at ${path.join(directory, 'pre-restore-' + timestamp() + '.db')}`);
      process.exit(1);
    }
  } else {
    fs.copyFileSync(file, databasePath);
  }
  console.log('Restored. Restart the API to pick up the restored data.');
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
