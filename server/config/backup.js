#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadEnvironment, serverDirectory } = require('./environment');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');
const backupCrypto = require('../utils/backupCrypto');
const { restrictFile, restrictDirectory } = require('../utils/filePermissions');

// A hospital database is the only copy of every patient record, so a backup
// that has never been restored is not a backup. This script makes a consistent
// online dump, keeps a rolling window, verifies the archive by actually loading
// it into a scratch database, and can restore it.
//
// The engine is MySQL, so the unit of backup is a logical SQL dump taken with
// `mysqldump --single-transaction`. That flag opens a consistent repeatable-read
// snapshot for InnoDB: the dump sees one point in time while the API keeps
// serving writes, so a backup taken at 09:00 cannot contain half of a
// transaction committed at 09:00:01. Copying the data directory instead would
// require a lock and risks a torn copy.

const DEFAULT_KEEP = 14;
const BACKUP_PATTERN = /^hospital-.*\.sql$/;
const COUNTED_TABLES = ['patients', 'users', 'bills', 'payments', 'medical_records', 'lab_orders'];
const USAGE = `Usage: npm run db:backup [options]

Options:
  --dir <path>       Where to write backups (default: server/backups)
  --keep <n>         How many backups to retain (default: ${DEFAULT_KEEP})
  --label <text>     Extra note recorded in the manifest, e.g. "pre-upgrade"
  --require          Treat a missing/empty database as a failure rather than a
                     first run, for unattended scheduled jobs
  --restore <file>   Restore a backup into the configured database, then exit
  --verify <file>    Load a backup into a scratch database to prove it restores
  --list             Show retained backups, newest first

Connection settings come from DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME.

Exit codes:
  0  a backup was taken and verified, or there was no data to dump yet
  1  the backup failed, could not be verified, or was refused

Examples:
  npm run db:backup -- --label nightly
  npm run db:backup -- --list
  npm run db:backup -- --verify server/backups/hospital-2026-01-16.sql
  npm run db:backup -- --restore server/backups/hospital-2026-01-16.sql
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
// two restarts inside the same second - a crash loop, a supervised restart -
// would produce the same filename and the second run would refuse rather than
// overwrite. The format is fixed-width, so the names still sort chronologically
// as plain strings.
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

function databaseConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: String(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'hospital',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hospital',
  };
}

function backupDirectory(options) {
  return options.dir
    ? path.resolve(options.dir)
    : path.join(serverDirectory, 'backups');
}

// The password is passed through MYSQL_PWD rather than argv so it never appears
// in the process list, where any local user could read it with ps.
function clientEnv(config) {
  return { ...process.env, MYSQL_PWD: config.password };
}

function mysqldumpArgs(config) {
  return [
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--user=${config.user}`,
    // One consistent snapshot for every InnoDB table, no long read locks.
    '--single-transaction',
    // Stream rows instead of buffering the whole table set in memory, so a
    // large database does not need to fit in RAM to be backed up.
    '--quick',
    '--routines',
    '--triggers',
    '--events',
    '--no-tablespaces',
    '--default-character-set=utf8mb4',
    '--skip-dump-date',
    config.database,
  ];
}

function runClient(binary, args, { config, stdoutFd = 'ignore', stdinFd = 'ignore', query } = {}) {
  const finalArgs = query ? [...args, '-e', query] : args;
  const result = spawnSync(binary, finalArgs, {
    env: clientEnv(config),
    stdio: [stdinFd, stdoutFd, 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    const friendly = result.error.code === 'ENOENT'
      ? `${binary} was not found on PATH. Install the MySQL client tools on the API host.`
      : result.error.message;
    return { ok: false, message: friendly };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    message: (result.stderr || '').trim(),
  };
}

// Table count in the configured database. Zero means "nothing to back up yet",
// which is different from "the database is unreachable".
function tableCount(config) {
  const result = runClient('mysql', [
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--user=${config.user}`,
    '--batch',
    '--skip-column-names',
    config.database,
  ], {
    config,
    query: 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, count: Number.parseInt(result.stdout.trim(), 10) || 0 };
}

function listBackups(options) {
  const directory = backupDirectory(options);
  if (!fs.existsSync(directory)) {
    console.log(`No backups yet. Expected them in ${directory}`);
    return [];
  }
  const files = fs
    .readdirSync(directory)
    .filter(name => BACKUP_PATTERN.test(name))
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

// An encrypted backup cannot be read as SQL, so it is decrypted to a scratch
// file first and that is what gets checked. The decrypted copy is removed
// whatever happens: a temporary plaintext dump of patient records is exactly
// the thing this feature exists to avoid leaving behind.
function withDecryptedCopy(file, action) {
  if (!backupCrypto.looksEncrypted(file)) return action(file);

  const scratch = path.join(
    os.tmpdir(),
    `hms-verify-${process.pid}-${crypto.randomBytes(6).toString('hex')}.sql`
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
    try { fs.rmSync(scratch, { force: true }); } catch { /* best effort */ }
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
  withDecryptedCopy(file, decrypted => verifyDump(decrypted, file));
}

// The only honest proof that a dump is usable is to load it. It is imported into
// a throw-away database that is dropped immediately, so the live database is
// never touched and nothing is left behind for the next operator to find.
function verifyDump(dumpFile, original) {
  const config = databaseConfig();
  const scratchDatabase = `hms_verify_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;

  const created = runClient('mysql', [
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--user=${config.user}`,
  ], { config, query: `CREATE DATABASE \`${scratchDatabase}\` CHARACTER SET utf8mb4` });
  if (!created.ok) {
    console.error(`Could not create a scratch database to verify ${original}: ${created.message}`);
    console.error('The backup file itself is untouched; re-run with a user that may CREATE/DROP databases.');
    process.exit(1);
  }

  try {
    const loaded = runClient('mysql', [
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.user}`,
      scratchDatabase,
    ], { config, stdinFd: fs.openSync(dumpFile, 'r') });
    if (!loaded.ok) {
      console.error(`Integrity check failed for ${original}: the dump did not load cleanly.`);
      if (loaded.message) console.error(`  ${loaded.message.split('\n').slice(0, 5).join('\n  ')}`);
      process.exit(1);
    }

    const counted = runClient('mysql', [
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.user}`,
      '--batch',
      '--skip-column-names',
      scratchDatabase,
    ], {
      config,
      query: 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    });
    if (!counted.ok) {
      console.error(`The restored copy of ${original} could not be inspected: ${counted.message}`);
      process.exit(1);
    }
    const tableCountValue = Number.parseInt(counted.stdout.trim(), 10) || 0;

    let rowCounts = '';
    for (const table of COUNTED_TABLES) {
      const counted2 = runClient('mysql', [
        `--host=${config.host}`,
        `--port=${config.port}`,
        `--user=${config.user}`,
        '--batch',
        '--skip-column-names',
        scratchDatabase,
      ], {
        config,
        query: `SELECT COUNT(*) FROM \`${table}\``,
      });
      // A table that is not part of this schema is skipped rather than fatal.
      if (!counted2.ok) continue;
      rowCounts += `\n    ${table.padEnd(18)} ${counted2.stdout.trim()} rows`;
    }

    console.log(`Backup is valid: ${original}`);
    console.log(`  restored into    ${scratchDatabase} (then dropped)`);
    console.log(`  tables           ${tableCountValue}`);
    console.log(`  row counts:${rowCounts}`);
    return true;
  } finally {
    runClient('mysql', [
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.user}`,
    ], { config, query: `DROP DATABASE IF EXISTS \`${scratchDatabase}\`` });
  }
}

function rotate(directory, keep) {
  const files = fs
    .readdirSync(directory)
    .filter(name => BACKUP_PATTERN.test(name))
    .sort()
    .reverse();
  const doomed = files.slice(keep);
  for (const name of doomed) {
    fs.rmSync(path.join(directory, name), { force: true });
    fs.rmSync(path.join(directory, `${name}.json`), { force: true });
    console.log(`  removed old backup ${name}`);
  }
  return files.length - doomed.length;
}

function create(options) {
  const config = databaseConfig();
  const existing = tableCount(config);
  if (!existing.ok) {
    console.error(`Could not reach MySQL to take a backup of "${config.database}": ${existing.message}`);
    if (options.requireDatabase) {
      console.error('--require was passed, so this counts as a failure.');
      process.exit(1);
    }
    process.exit(1);
  }
  if (existing.count === 0) {
    // A first run has no schema yet. That is a normal state, not a failure, so
    // the launcher can take a backup before migrating without blocking a fresh
    // install. This keeps the contract simple: exit 0 means "there is a good
    // copy, or there was nothing to copy".
    console.log(`Database "${config.database}" has no tables yet, so there is nothing to back up yet.`);
    if (options.requireDatabase) {
      console.error('--require was passed, so this counts as a failure.');
      process.exit(1);
    }
    process.exit(0);
  }

  const directory = backupDirectory(options);
  fs.mkdirSync(directory, { recursive: true });
  // A backup is a full copy of the patient database. Keep the directory and the
  // archives inside it owner-only instead of inheriting the process umask.
  restrictDirectory(directory, { label: 'backup directory' });

  const name = `hospital-${timestamp()}.sql`;
  const target = path.join(directory, name);
  if (fs.existsSync(target)) {
    console.error(`Refusing to overwrite an existing backup: ${target}`);
    process.exit(1);
  }

  const partial = `${target}.partial`;
  const fd = fs.openSync(partial, 'w', 0o600);
  let dumped;
  try {
    dumped = runClient('mysqldump', mysqldumpArgs(config), { config, stdoutFd: fd });
  } finally {
    fs.closeSync(fd);
  }
  if (!dumped.ok) {
    fs.rmSync(partial, { force: true });
    console.error(`Backup failed: ${dumped.message || `mysqldump exited with status ${dumped.status}`}`);
    process.exit(1);
  }
  // A dump that never completed must not be presented as an archive, even if
  // mysqldump exited 0 on a truncated pipe.
  if (fs.statSync(partial).size === 0) {
    fs.rmSync(partial, { force: true });
    console.error('Backup failed: mysqldump produced an empty file.');
    process.exit(1);
  }
  fs.renameSync(partial, target);

  const manifest = {
    created_at: new Date().toISOString(),
    engine: 'mysql',
    source_database: config.database,
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
  restrictFile(target, { label: 'backup archive' });
  restrictFile(`${target}.json`, { label: 'backup manifest' });

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
  const config = databaseConfig();

  console.log('');
  console.log(`This will replace the contents of database "${config.database}" with ${file}.`);
  // Preserve whatever is there now, so a restore is itself reversible.
  const safety = path.join(backupDirectory({}), `pre-restore-${timestamp()}.sql`);
  fs.mkdirSync(path.dirname(safety), { recursive: true });
  const fd = fs.openSync(safety, 'w', 0o600);
  let safetyDump;
  try {
    safetyDump = runClient('mysqldump', mysqldumpArgs(config), { config, stdoutFd: fd });
  } finally {
    fs.closeSync(fd);
  }
  if (!safetyDump.ok) {
    fs.rmSync(safety, { force: true });
    console.error(`Restore aborted: could not snapshot the current database first (${safetyDump.message || 'mysqldump failed'}).`);
    process.exit(1);
  }
  restrictFile(safety, { label: 'pre-restore snapshot' });
  console.log(`The current data has been dumped to ${safety} first.`);

  withDecryptedCopy(file, decrypted => {
    const loaded = runClient('mysql', [
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.user}`,
      config.database,
    ], { config, stdinFd: fs.openSync(decrypted, 'r') });
    if (!loaded.ok) {
      console.error(`Restore failed: ${loaded.message || 'the dump did not load'}`);
      console.error(`The previous data is preserved in ${safety}`);
      process.exit(1);
    }
  });
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
