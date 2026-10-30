#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { finished } = require('stream/promises');
const mysql = require('mysql2');
const { loadEnvironment, serverDirectory } = require('./environment');
loadEnvironment();

const pool = require('./database');
const backupCrypto = require('../utils/backupCrypto');
const DEFAULT_KEEP = 14;
const DEFAULT_DIRECTORY = path.join(serverDirectory, 'backups', 'mysql');
const USAGE = `Usage: npm run db:backup [options]

Options:
  --dir <path>       Where to write backups (default: server/backups/mysql)
  --keep <n>         How many backups to retain (default: ${DEFAULT_KEEP})
  --label <text>     Record an operator note in the manifest
  --require          Fail when the configured database has no tables
  --verify <file>    Verify a backup and its manifest
  --decrypt <file>   Decrypt an encrypted backup (requires --output)
  --output <path>    New, mode-0600 path for decrypted SQL
  --list             Show retained backups, newest first

Backups use a consistent InnoDB snapshot. They are encrypted when
BACKUP_ENCRYPTION_KEY is set; production startup requires encryption.
Restore a verified SQL backup only into the intended database using the
separately supplied MySQL client, after taking a fresh pre-restore backup.
`;

function parseArgs(argv) {
  const options = { keep: DEFAULT_KEEP };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir' || arg === '--keep' || arg === '--label' ||
        arg === '--verify' || arg === '--decrypt' || arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      index += 1;
      if (arg === '--dir') options.directory = path.resolve(value);
      if (arg === '--keep') options.keep = Number(value);
      if (arg === '--label') options.label = value;
      if (arg === '--verify') options.verify = path.resolve(value);
      if (arg === '--decrypt') options.decrypt = path.resolve(value);
      if (arg === '--output') options.output = path.resolve(value);
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--require') {
      options.requireDatabase = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else {
      throw new Error(`Unknown option "${arg}".\n\n${USAGE}`);
    }
  }
  if (!Number.isSafeInteger(options.keep) || options.keep < 1) {
    throw new Error('--keep must be a positive whole number.');
  }
  if (options.label && options.label.length > 200) {
    throw new Error('--label must be 200 characters or fewer.');
  }
  if (options.decrypt && !options.output) throw new Error('--decrypt requires --output.');
  if (options.output && !options.decrypt) throw new Error('--output requires --decrypt.');
  if ([options.list, Boolean(options.verify), Boolean(options.decrypt)].filter(Boolean).length > 1) {
    throw new Error('--list, --verify and --decrypt are separate operations.');
  }
  return options;
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsupported MySQL identifier in backup schema: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function timestamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}-` +
    `${pad(date.getUTCMilliseconds(), 3)}Z`;
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function manifestPath(file) {
  return `${file}.json`;
}

function listBackups(directory) {
  if (!fs.existsSync(directory)) {
    console.log(`No backups yet. Expected them in ${directory}`);
    return [];
  }
  const files = fs.readdirSync(directory)
    .filter(name => /^hospital-.*\.sql(?:\.enc)?$/.test(name))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.log(`No MySQL backups found in ${directory}`);
    return [];
  }
  for (const name of files) {
    const file = path.join(directory, name);
    console.log(`  ${name}  ${(fs.statSync(file).size / (1024 * 1024)).toFixed(2)} MB`);
  }
  return files.map(name => path.join(directory, name));
}

function validateSqlDump(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(512);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    const text = header.subarray(0, bytesRead).toString('utf8');
    if (!text.startsWith('-- HMS MySQL logical backup\n') || fs.statSync(file).size <= bytesRead) {
      throw new Error('Backup does not contain a complete HMS MySQL SQL dump.');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

async function verifyBackup(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Backup not found: ${file}`);
  }
  const details = JSON.parse(fs.readFileSync(manifestPath(file), 'utf8'));
  if (details.file !== path.basename(file)) {
    throw new Error('Backup manifest does not match the selected file.');
  }
  if (Boolean(details.encrypted) !== backupCrypto.looksEncrypted(file)) {
    throw new Error('Backup encryption state does not match its manifest.');
  }
  if (details.size_bytes !== fs.statSync(file).size || details.sha256 !== await sha256File(file)) {
    throw new Error('Backup checksum or size does not match its manifest.');
  }

  let scratchDirectory;
  try {
    let sqlFile = file;
    if (backupCrypto.looksEncrypted(file)) {
      if (!backupCrypto.isEnabled()) {
        throw new Error('Backup is encrypted; configure BACKUP_ENCRYPTION_KEY to verify it.');
      }
      scratchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-mysql-verify-'));
      sqlFile = path.join(scratchDirectory, 'backup.sql');
      backupCrypto.decryptFile(file, sqlFile);
    }
    validateSqlDump(sqlFile);
  } finally {
    if (scratchDirectory) fs.rmSync(scratchDirectory, { recursive: true, force: true });
  }
  return details;
}

async function decryptBackup(file, output) {
  await verifyBackup(file);
  if (!backupCrypto.looksEncrypted(file)) throw new Error('Selected backup is not encrypted.');
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`);
  const descriptor = fs.openSync(output, 'wx', 0o600);
  fs.closeSync(descriptor);
  try {
    backupCrypto.decryptFile(file, output);
    fs.chmodSync(output, 0o600);
    validateSqlDump(output);
    return output;
  } catch (error) {
    fs.rmSync(output, { force: true });
    throw error;
  }
}

function sqlValue(value, column) {
  if (value === null || value === undefined) return 'NULL';
  if (column.data_type === 'json' && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return mysql.escape(JSON.stringify(value));
  }
  return mysql.escape(value);
}

async function createBackup(options = {}) {
  const directory = options.directory || DEFAULT_DIRECTORY;
  const keep = options.keep ?? DEFAULT_KEEP;
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error('keep must be a positive whole number.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (options.label && options.label.length > 200) throw new Error('label must be 200 characters or fewer.');

  const connection = await pool.mysqlPool.getConnection();
  let temporaryDirectory;
  let output;
  let outputFinished;
  let transactionStarted = false;
  let connectionDestroyed = false;
  let failure;
  let archivePath;
  let manifest;
  let archiveCreated = false;
  let manifestCreated = false;

  try {
    await connection.query("SET time_zone = '+00:00'");
    temporaryDirectory = fs.mkdtempSync(path.join(directory, '.hms-backup-'));
    const sqlPath = path.join(temporaryDirectory, 'backup.sql');
    output = fs.createWriteStream(sqlPath, { flags: 'wx', mode: 0o600 });
    outputFinished = finished(output);
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    transactionStarted = true;
    const [databaseRows] = await connection.query('SELECT DATABASE() AS database_name');
    const databaseName = databaseRows[0].database_name;
    await writeChunk(output, `-- HMS MySQL logical backup\n-- Database: ${databaseName}\n`);
    await writeChunk(output, 'SET FOREIGN_KEY_CHECKS=0;\n\n');

    const [tables] = await connection.query(
      `SELECT TABLE_NAME AS table_name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    if (tables.length === 0) {
      if (options.requireDatabase) {
        throw new Error('Configured MySQL database has no tables to back up.');
      }
      await connection.commit();
      transactionStarted = false;
      output.end();
      await outputFinished;
      console.log('Configured MySQL database has no tables yet; nothing to back up.');
      return { noDatabase: true };
    }
    const rowCounts = {};

    for (const { table_name: table } of tables) {
      const quotedTable = quoteIdentifier(table);
      const [definition] = await connection.query(`SHOW CREATE TABLE ${quotedTable}`);
      const createSql = definition[0]['Create Table'];
      if (typeof createSql !== 'string') throw new Error(`Could not read the schema for table "${table}".`);
      await writeChunk(output, `DROP TABLE IF EXISTS ${quotedTable};\n${createSql};\n\n`);

      const [columnRows] = await connection.query(
        `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, EXTRA AS extra
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION`,
        [table]
      );
      const columns = columnRows.filter(column => !/generated/i.test(column.extra));
      if (columns.length === 0) throw new Error(`Table "${table}" has no exportable columns.`);
      const selectedColumns = columns.map(column => quoteIdentifier(column.column_name));
      const insertHeader = `INSERT INTO ${quotedTable} (${selectedColumns.join(', ')}) VALUES `;
      const stream = connection.connection.query(
        `SELECT ${selectedColumns.join(', ')} FROM ${quotedTable}`
      ).stream({ objectMode: true, highWaterMark: 100 });
      let batch = [];
      let count = 0;

      for await (const row of stream) {
        batch.push(`(${columns.map(column => sqlValue(row[column.column_name], column)).join(', ')})`);
        count += 1;
        if (batch.length === 100) {
          await writeChunk(output, `${insertHeader}${batch.join(',\n')};\n`);
          batch = [];
        }
      }
      if (batch.length > 0) await writeChunk(output, `${insertHeader}${batch.join(',\n')};\n`);
      rowCounts[table] = count;
      await writeChunk(output, '\n');
    }

    await writeChunk(output, 'SET FOREIGN_KEY_CHECKS=1;\n');
    output.end();
    await outputFinished;
    await connection.commit();
    transactionStarted = false;

    const encrypted = backupCrypto.isEnabled();
    const baseName = `hospital-${timestamp()}-${crypto.randomBytes(3).toString('hex')}.sql`;
    archivePath = path.join(directory, encrypted ? `${baseName}.enc` : baseName);
    if (encrypted) {
      const encryptedPath = path.join(temporaryDirectory, 'backup.sql.enc');
      backupCrypto.encryptFile(sqlPath, encryptedPath);
      fs.copyFileSync(encryptedPath, archivePath, fs.constants.COPYFILE_EXCL);
    } else {
      fs.copyFileSync(sqlPath, archivePath, fs.constants.COPYFILE_EXCL);
    }
    archiveCreated = true;
    fs.chmodSync(archivePath, 0o600);
    manifest = {
      file: path.basename(archivePath),
      database: databaseName,
      created_at: new Date().toISOString(),
      size_bytes: fs.statSync(archivePath).size,
      sha256: await sha256File(archivePath),
      encrypted,
      label: options.label || null,
      row_counts: rowCounts,
    };
    const sidecar = manifestPath(archivePath);
    fs.writeFileSync(sidecar, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    manifestCreated = true;
    fs.chmodSync(sidecar, 0o600);
  } catch (error) {
    failure = error;
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        try {
          connection.destroy();
          connectionDestroyed = true;
        } catch (destroyError) {
          rollbackError = new AggregateError([rollbackError, destroyError], 'Rollback and connection destruction both failed.');
        }
        failure = new AggregateError([error, rollbackError], 'Backup and snapshot rollback both failed.');
      }
    }
  } finally {
    if (output && !output.closed) {
      output.destroy();
    }
    if (outputFinished) {
      try {
        await outputFinished;
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError([failure, cleanupError], 'Backup operation and SQL archive cleanup both failed.')
          : cleanupError;
      }
    }
    if (!connectionDestroyed) connection.release();
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    if (failure && archivePath && archiveCreated) {
      fs.rmSync(archivePath, { force: true });
    }
    if (failure && archivePath && manifestCreated) {
      fs.rmSync(manifestPath(archivePath), { force: true });
    }
  }

  if (failure) throw failure;
  if (!archivePath || !manifest) throw new Error('MySQL backup did not produce an archive.');
  await verifyBackup(archivePath);
  rotateBackups(directory, keep, archivePath);
  console.log(`MySQL backup written and verified: ${archivePath}`);
  if (!manifest.encrypted) console.warn('BACKUP_ENCRYPTION_KEY is not set; this archive contains plaintext patient data.');
  for (const [table, count] of Object.entries(manifest.row_counts)) {
    console.log(`  ${table}: ${count} rows`);
  }
  return { file: archivePath, manifest };
}

function rotateBackups(directory, keep, newestFile) {
  const files = fs.readdirSync(directory)
    .filter(name => /^hospital-.*\.sql(?:\.enc)?$/.test(name))
    .map(name => path.join(directory, name))
    .sort()
    .reverse();
  let retained = 0;
  for (const file of files) {
    if (file === newestFile || retained < keep) {
      retained += 1;
      continue;
    }
    fs.rmSync(file);
    fs.rmSync(manifestPath(file), { force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
  } else if (options.list) {
    listBackups(options.directory || DEFAULT_DIRECTORY);
  } else if (options.verify) {
    const manifest = await verifyBackup(options.verify);
    console.log(`MySQL backup is valid: ${options.verify}`);
    console.log(`  SHA-256  ${manifest.sha256}`);
    console.log(`  encrypted ${manifest.encrypted ? 'yes' : 'no'}`);
  } else if (options.decrypt) {
    const output = await decryptBackup(options.decrypt, options.output);
    console.log(`Verified SQL was decrypted to ${output}; protect or remove this plaintext file after restore.`);
  } else {
    await createBackup(options);
  }
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error(`[mysql-backup] ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.close().catch(error => {
      console.error('[mysql-backup] Could not close the MySQL pool:', error.message);
      process.exitCode = 1;
    }));
}

module.exports = { createBackup, decryptBackup, listBackups, parseArgs, verifyBackup };
