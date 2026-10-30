#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvironment } = require('../config/environment');
loadEnvironment();

const Database = require('better-sqlite3');
const database = require('../config/database');
const { normalizeParams } = database;

const BATCH_SIZE = 250;
const METADATA_TABLES = new Set(['schema_migrations', 'sqlite_imports']);
const USAGE = `Usage: npm run db:import-sqlite -- --source <backup.db> --confirm-empty-target

Imports a read-only SQLite snapshot into a MySQL database initialized with db:setup.
The MySQL application tables must be empty. The SQLite source is never modified.
`;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') {
      const source = argv[index + 1];
      if (!source || source.startsWith('--')) throw new Error('--source needs a file path.');
      options.source = path.resolve(source);
      index += 1;
    } else if (arg === '--confirm-empty-target') {
      options.confirmEmptyTarget = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      throw new Error(`Unknown option "${arg}".\n\n${USAGE}`);
    }
  }
  if (!options.source) throw new Error(`--source is required.\n\n${USAGE}`);
  if (!options.confirmEmptyTarget) {
    throw new Error('Refusing to import without --confirm-empty-target.');
  }
  return options;
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsupported database identifier in migration schema: ${identifier}`);
  }
  return `\`${identifier}\``;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function sqliteTables(sqlite) {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(row => row.name)
    .filter(name => !METADATA_TABLES.has(name));
}

async function mysqlTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
  );
  return rows.map(row => row.table_name);
}

async function tableColumns(connection, table) {
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME AS column_name, IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default, EXTRA AS extra,
            GENERATION_EXPRESSION AS generation_expression
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return columns.map(column => ({
    ...column,
    generated: Boolean(column.generation_expression) || /generated/i.test(column.extra),
  }));
}

async function countRows(connection, table) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
  return Number(rows[0].count);
}

async function validateForeignKeys(connection) {
  const [foreignKeys] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            REFERENCED_TABLE_NAME AS referenced_table_name,
            REFERENCED_COLUMN_NAME AS referenced_column_name
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`
  );
  for (const key of foreignKeys) {
    const child = quoteIdentifier(key.table_name);
    const childColumn = quoteIdentifier(key.column_name);
    const parent = quoteIdentifier(key.referenced_table_name);
    const parentColumn = quoteIdentifier(key.referenced_column_name);
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${child} child
       LEFT JOIN ${parent} parent ON child.${childColumn} = parent.${parentColumn}
       WHERE child.${childColumn} IS NOT NULL AND parent.${parentColumn} IS NULL`
    );
    if (Number(rows[0].count) > 0) {
      throw new Error(`Foreign-key validation failed for ${key.table_name}.${key.column_name}.`);
    }
  }
}

async function inspectSource(snapshotPath) {
  const sqlite = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const [integrity] = sqlite.pragma('integrity_check');
    if (integrity.integrity_check !== 'ok') {
      throw new Error('SQLite snapshot failed its integrity check.');
    }
    const tables = sqliteTables(sqlite);
    const rowCounts = {};
    for (const table of tables) {
      rowCounts[table] = Number(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count
      );
    }
    return { sqlite, tables, rowCounts };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

async function transferTable(sqlite, connection, table, rowCounts) {
  const sourceColumns = sqlite
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all()
    .map(column => column.name);
  const targetColumns = await tableColumns(connection, table);
  if (targetColumns.length === 0) {
    throw new Error(`SQLite table "${table}" does not exist in the MySQL schema.`);
  }

  const targetByName = new Map(targetColumns.map(column => [column.column_name, column]));
  const sourceOnly = sourceColumns.filter(column => !targetByName.has(column));
  if (sourceOnly.length > 0) {
    throw new Error(
      `SQLite table "${table}" has columns absent from MySQL (${sourceOnly.join(', ')}); no rows were imported.`
    );
  }

  const insertColumns = sourceColumns.filter(column => !targetByName.get(column).generated);
  const sourceColumnSet = new Set(sourceColumns);
  const missingRequired = targetColumns.filter(column =>
    !column.generated &&
    !sourceColumnSet.has(column.column_name) &&
    column.is_nullable === 'NO' &&
    column.column_default === null &&
    !/auto_increment/i.test(column.extra)
  );
  if (missingRequired.length > 0) {
    throw new Error(
      `SQLite table "${table}" is missing required MySQL columns (${missingRequired.map(column => column.column_name).join(', ')}).`
    );
  }

  if (insertColumns.length === 0 || rowCounts[table] === 0) return 0;
  const select = sqlite.prepare(
    `SELECT ${sourceColumns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)}`
  );
  const insert = `INSERT INTO ${quoteIdentifier(table)} (${insertColumns.map(quoteIdentifier).join(', ')}) VALUES ?`;
  let batch = [];
  let inserted = 0;

  for (const sourceRow of select.iterate()) {
    batch.push(insertColumns.map(column => sourceRow[column]));
    if (batch.length === BATCH_SIZE) {
      const normalizedBatch = batch.map(row => normalizeParams(row));
      try {
        const [result] = await connection.query(insert, [normalizedBatch]);
        inserted += result.affectedRows;
      } catch (error) {
        throw new Error(`MySQL rejected rows for table "${table}" (${error.code || 'database error'}).`);
      }
      batch = [];
    }
  }
  if (batch.length > 0) {
    try {
      const [result] = await connection.query(insert, [batch.map(row => normalizeParams(row))]);
      inserted += result.affectedRows;
    } catch (error) {
      throw new Error(`MySQL rejected rows for table "${table}" (${error.code || 'database error'}).`);
    }
  }
  if (inserted !== rowCounts[table]) {
    throw new Error(`Row-count mismatch while importing table "${table}".`);
  }
  return inserted;
}

async function importSqlite({ source, confirmEmptyTarget }) {
  if (!confirmEmptyTarget) throw new Error('Refusing to import without confirmation that the target is empty.');
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`SQLite source file was not found: ${source}`);
  }

  const snapshotDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-sqlite-import-'));
  const snapshotPath = path.join(snapshotDirectory, 'snapshot.db');
  let sqlite;
  const connection = await database.getConnection();
  let transactionStarted = false;
  let connectionDestroyed = false;
  let failure;
  let result;

  try {
    const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await sourceDb.backup(snapshotPath);
    } finally {
      sourceDb.close();
    }
    fs.chmodSync(snapshotPath, 0o600);
    const sourceSha256 = await sha256File(snapshotPath);
    const sourceInfo = await inspectSource(snapshotPath);
    sqlite = sourceInfo.sqlite;

    await database.isReady();
    const allTargetTables = await mysqlTables(connection);
    const targetTables = allTargetTables.filter(table => !METADATA_TABLES.has(table));
    const unknownSourceTables = sourceInfo.tables.filter(table => !targetTables.includes(table));
    if (unknownSourceTables.length > 0) {
      throw new Error(
        `SQLite contains tables absent from the MySQL schema (${unknownSourceTables.join(', ')}); import stopped to avoid dropping data.`
      );
    }

    const [previousImports] = await connection.query(
      'SELECT source_sha256, row_counts FROM sqlite_imports WHERE id = 1'
    );
    const currentCounts = {};
    for (const table of targetTables) currentCounts[table] = await countRows(connection, table);

    if (previousImports.length > 0) {
      const previous = previousImports[0];
      if (previous.source_sha256 !== sourceSha256) {
        throw new Error('A different SQLite source was already imported; refusing to merge or replace MySQL data.');
      }
      const recordedCounts = typeof previous.row_counts === 'string'
        ? JSON.parse(previous.row_counts)
        : previous.row_counts;
      for (const table of targetTables) {
        const expected = Number(recordedCounts[table] || 0);
        const sourceCount = Number(sourceInfo.rowCounts[table] || 0);
        if (currentCounts[table] !== expected || expected !== sourceCount) {
          throw new Error(
            `The prior import marker exists, but row counts differ for "${table}"; refusing to re-import.`
          );
        }
      }
      result = { alreadyImported: true, rowCounts: recordedCounts };
    } else {
      const populatedTables = Object.entries(currentCounts).filter(([, count]) => count > 0);
      if (populatedTables.length > 0) {
        throw new Error(
          `MySQL target is not empty (${populatedTables.map(([table, count]) => `${table}: ${count}`).join(', ')}).`
        );
      }
      const rowCounts = Object.fromEntries(
        targetTables.map(table => [table, Number(sourceInfo.rowCounts[table] || 0)])
      );

      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.beginTransaction();
      transactionStarted = true;
      for (const table of sourceInfo.tables) {
        await transferTable(sqlite, connection, table, sourceInfo.rowCounts);
      }
      for (const table of targetTables) {
        const actual = await countRows(connection, table);
        if (actual !== rowCounts[table]) {
          throw new Error(`Row-count validation failed for table "${table}".`);
        }
      }
      await validateForeignKeys(connection);
      await connection.query(
        `INSERT INTO sqlite_imports (id, source_sha256, row_counts)
         VALUES (1, ?, ?)`,
        [sourceSha256, JSON.stringify(rowCounts)]
      );
      await connection.commit();
      transactionStarted = false;
      result = { alreadyImported: false, rowCounts };
    }
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
        failure = new AggregateError([error, rollbackError], 'Import and rollback both failed.');
      }
    }
  } finally {
    if (!connectionDestroyed) {
      try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch (cleanupError) {
        try {
          connection.destroy();
          connectionDestroyed = true;
        } catch (destroyError) {
          cleanupError = new AggregateError([cleanupError, destroyError], 'Could not restore checks or destroy the MySQL connection.');
        }
        failure = failure
          ? new AggregateError([failure, cleanupError], 'Import failed and MySQL connection cleanup also failed.')
          : new Error('Import completed, but MySQL foreign-key checks could not be restored.', { cause: cleanupError });
      }
    }
    try {
      if (sqlite) sqlite.close();
    } catch (cleanupError) {
      failure = failure
        ? new AggregateError([failure, cleanupError], 'Import and SQLite snapshot cleanup both failed.')
        : cleanupError;
    }
    if (!connectionDestroyed) {
      try {
        connection.release();
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError([failure, cleanupError], 'Import and MySQL connection release both failed.')
          : cleanupError;
      }
    }
    try {
      fs.rmSync(snapshotDirectory, { recursive: true, force: true });
    } catch (cleanupError) {
      failure = failure
        ? new AggregateError([failure, cleanupError], 'Import and temporary snapshot cleanup both failed.')
        : cleanupError;
    }
  }

  if (failure) throw failure;
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await importSqlite(options);
  console.log(result.alreadyImported
    ? 'This SQLite snapshot was already imported; the verified import was left unchanged.'
    : 'SQLite import committed successfully.');
  for (const [table, count] of Object.entries(result.rowCounts)) {
    console.log(`  ${table}: ${count} rows`);
  }
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error(`[sqlite-to-mysql] ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => database.close().catch(error => {
      console.error('[sqlite-to-mysql] Could not close the MySQL pool:', error.message);
      process.exitCode = 1;
    }));
}

module.exports = { importSqlite, parseArgs };
