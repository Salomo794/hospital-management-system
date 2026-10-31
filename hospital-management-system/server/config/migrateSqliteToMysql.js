'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const readline = require('readline');

const helperPath = path.join(__dirname, 'sqliteMigrationSource.py');

function runSourceHelper(operation, sourcePath, ...args) {
  const output = execFileSync(
    process.env.PYTHON || 'python3',
    [helperPath, operation, sourcePath, ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return output;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--help') return { help: true };
    if (option !== '--source' && option !== '--report') {
      throw new Error(`Unknown option: ${option}`);
    }
    if (!args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`${option} requires a path.`);
    }
    if (options[option]) throw new Error(`${option} may only be specified once.`);
    options[option] = args[++index];
  }
  if (!options['--source']) {
    throw new Error('Specify the existing SQLite database with --source <path>.');
  }
  return { source: path.resolve(options['--source']), report: options['--report'] };
}

function makeBackupPath(sourcePath) {
  const date = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '');
  return `${sourcePath}.pre-mysql-${date}.bak`;
}

function parseHelperJson(operation, sourcePath, ...args) {
  const output = runSourceHelper(operation, sourcePath, ...args);
  return JSON.parse(output);
}

function compareTables(sourceTables, targetTables) {
  const targetByName = new Map(targetTables.map(table => [table.name, table]));
  const sourceByName = new Map(sourceTables.map(table => [table.name, table]));
  const unknown = sourceTables.filter(table => !targetByName.has(table.name));
  if (unknown.length) {
    throw new Error(`SQLite contains tables not present in the MySQL schema: ${unknown.map(t => t.name).join(', ')}`);
  }

  for (const source of sourceTables) {
    const target = targetByName.get(source.name);
    const sourceColumns = new Set(source.columns.map(column => column.name));
    const missing = target.columns
      .filter(column => !column.generated && !sourceColumns.has(column.name))
      .filter(column => column.isNullable === 'NO' && column.defaultValue === null);
    if (missing.length) {
      throw new Error(`SQLite table ${source.name} is missing required MySQL columns: ${missing.map(column => column.name).join(', ')}`);
    }
    for (const column of target.columns) {
      if (column.isNullable === 'NO' && column.defaultValue === null && sourceColumns.has(column.name)) {
        const nullCount = source.null_counts[column.name] || 0;
        if (nullCount > 0) {
          throw new Error(`SQLite table ${source.name}.${column.name} contains ${nullCount} NULL values, but MySQL requires a value.`);
        }
      }
    }
  }
  return { sourceByName, targetByName };
}

function orderTables(sourceTables, targetForeignKeys) {
  const names = new Set(sourceTables.map(table => table.name));
  const dependencies = new Map(sourceTables.map(table => [table.name, new Set()]));
  for (const key of targetForeignKeys) {
    if (names.has(key.table) && names.has(key.referencedTable)) {
      dependencies.get(key.table).add(key.referencedTable);
    }
  }
  const ordered = [];
  const remaining = new Set(names);
  while (remaining.size) {
    const ready = [...remaining].filter(name =>
      [...dependencies.get(name)].every(dependency => !remaining.has(dependency))
    );
    if (!ready.length) {
      throw new Error(`The source schema contains a foreign-key cycle that cannot be imported safely: ${[...remaining].join(', ')}`);
    }
    for (const name of ready) {
      remaining.delete(name);
      ordered.push(name);
    }
  }
  return ordered;
}

function decodeValue(value) {
  if (!value || typeof value !== 'object' || !value.$type) return value;
  if (value.$type === 'blob') return Buffer.from(value.value, 'base64');
  if (value.$type === 'integer' || value.$type === 'number') return value.value;
  throw new Error(`Unsupported SQLite value type: ${value.$type}`);
}

function normalizeValue(value, column) {
  const decoded = decodeValue(value);
  if (typeof decoded !== 'string') return decoded;
  if (column.dataType === 'date') {
    const match = decoded.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);
    if (!match) throw new Error(`Invalid SQLite date value for ${column.name}.`);
    return match[1];
  }
  if (column.dataType === 'datetime' || column.dataType === 'timestamp') {
    const match = decoded.match(
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/
    );
    if (!match || (match[3] && match[3].length > 6)) {
      throw new Error(`Invalid or over-precise SQLite datetime value for ${column.name}.`);
    }
    let datePart = match[1];
    let timePart = match[2];
    if (match[4]) {
      const timestamp = Date.parse(`${datePart}T${timePart}${match[4]}`);
      if (!Number.isFinite(timestamp)) throw new Error(`Invalid SQLite datetime value for ${column.name}.`);
      const utc = new Date(timestamp).toISOString();
      datePart = utc.slice(0, 10);
      timePart = utc.slice(11, 19);
    }
    return `${datePart} ${timePart}${match[3] ? `.${match[3].padEnd(6, '0')}` : ''}`;
  }
  if (column.dataType === 'time') {
    const match = decoded.match(/^(\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/);
    if (!match || (match[2] && match[2].length > 6)) {
      throw new Error(`Invalid or over-precise SQLite time value for ${column.name}.`);
    }
    return `${match[1]}${match[2] ? `.${match[2].padEnd(6, '0')}` : ''}`;
  }
  return decoded;
}

function quoteMysqlIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsupported MySQL identifier: ${value}`);
  return `\`${value}\``;
}

async function importTableRows(connection, sourcePath, tableName, columns, sourceColumns) {
  const child = spawn(
    process.env.PYTHON || 'python3',
    [helperPath, 'dump', sourcePath, tableName],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `SQLite export exited with ${signal || code}.`));
    });
  });
  closed.catch(() => {});
  const namesSql = columns.map(column => quoteMysqlIdentifier(column.name)).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const insertSql = `INSERT INTO ${quoteMysqlIdentifier(tableName)} (${namesSql}) VALUES (${placeholders})`;
  const sourceColumnIndex = new Map(sourceColumns.map((column, index) => [column.name, index]));

  try {
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const values = JSON.parse(line);
      await connection.query(
        insertSql,
        columns.map(column => normalizeValue(values[sourceColumnIndex.get(column.name)], column))
      );
    }
    await closed;
  } catch (error) {
    child.kill();
    try {
      await closed;
    } catch {}
    throw error;
  }
}

async function writeReport(reportPath, report) {
  const resolved = path.resolve(reportPath);
  const descriptor = fs.openSync(resolved, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    fs.closeSync(descriptor);
  }
  return resolved;
}

async function migrate(options) {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('The SQLite importer cannot run with NODE_ENV=test.');
  }
  if (!fs.statSync(options.source).isFile()) {
    throw new Error('The --source path must be a regular SQLite database file.');
  }

  const backupPath = makeBackupPath(options.source);
  runSourceHelper('backup', options.source, backupPath);
  const source = parseHelperJson('inspect', backupPath);
  if (source.integrity_check.length !== 1 || source.integrity_check[0] !== 'ok') {
    throw new Error(`SQLite backup failed integrity_check: ${source.integrity_check.join('; ')}`);
  }
  if (source.foreign_key_errors.length) {
    throw new Error(`SQLite source contains ${source.foreign_key_errors.length} invalid foreign-key references.`);
  }
  if (!source.tables.length) throw new Error('SQLite source has no application tables.');

  const database = require('./database');
  const reportPath = options.report
    ? path.resolve(options.report)
    : `${options.source}.mysql-migration-${new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '')}.json`;
  const report = {
    version: 1,
    status: 'preflight',
    created_at: new Date().toISOString(),
    source_file: path.basename(options.source),
    backup_file: path.basename(backupPath),
    destination_database: database.databaseOptions(
      process.env.DATABASE_URL
    ).database,
    tables: [],
    errors: [],
  };
  let connection;
  try {
    connection = await database.getConnection();
    const [targetTableRows] = await connection.query(
      `SELECT TABLE_NAME AS name, ENGINE AS engine
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS dataType,
              IS_NULLABLE AS isNullable,
              COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression
       FROM information_schema.columns WHERE table_schema = DATABASE()`
    );
    const [foreignKeyRows] = await connection.query(
      `SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS columnName,
              REFERENCED_TABLE_NAME AS referencedTable,
              REFERENCED_COLUMN_NAME AS referencedColumn
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE table_schema = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    const targetTables = targetTableRows.map(table => ({
      ...table,
      columns: columnRows
        .filter(column => column.tableName === table.name)
        .map(column => ({
          ...column,
          generated: Boolean(column.extra && column.extra.includes('GENERATED')),
        })),
    }));
    if (!targetTables.length) throw new Error('MySQL schema is empty; run npm run db:setup first.');
    const nonInnoDb = targetTables.filter(table => table.engine !== 'InnoDB');
    if (nonInnoDb.length) {
      throw new Error(`MySQL tables must use InnoDB: ${nonInnoDb.map(table => table.name).join(', ')}`);
    }
    const { sourceByName, targetByName } = compareTables(source.tables, targetTables);
    const [occupiedRows] = await connection.query(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS rowCount
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
    );
    const occupied = [];
    for (const table of occupiedRows) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteMysqlIdentifier(table.name)}`);
      if (Number(rows[0].count) > 0) occupied.push(table.name);
    }
    if (occupied.length) {
      throw new Error(`Refusing to import into non-empty MySQL tables: ${occupied.join(', ')}`);
    }

    const sourceConstraints = foreignKeyRows
      .filter(key => sourceByName.has(key.table))
      .map(key => ({
        table: key.table,
        column: key.columnName,
        referencedTable: key.referencedTable,
        referencedColumn: key.referencedColumn,
      }));
    const invalidForeignKeys = parseHelperJson(
      'validate-fks',
      backupPath,
      JSON.stringify(sourceConstraints)
    );
    if (invalidForeignKeys.length) {
      throw new Error(`SQLite source has invalid references required by MySQL: ${JSON.stringify(invalidForeignKeys)}`);
    }

    const orderedNames = orderTables(source.tables, foreignKeyRows.map(key => ({
      table: key.table,
      referencedTable: key.referencedTable,
    })));
    report.status = 'importing';
    report.tables = targetTables.map(target => ({
      name: target.name,
      source_count: sourceByName.get(target.name)?.row_count || 0,
      destination_count: 0,
    }));

    await connection.beginTransaction();
    for (const tableName of orderedNames) {
      const sourceTable = sourceByName.get(tableName);
      const target = targetByName.get(tableName);
      const targetColumns = target.columns.filter(column => !column.generated);
      const sourceColumnNames = new Set(sourceTable.columns.map(column => column.name));
      const columns = targetColumns.filter(column => sourceColumnNames.has(column.name));
      await importTableRows(connection, backupPath, tableName, columns, sourceTable.columns);
    }

    for (const table of targetTables) {
      const [rows] = await connection.query(
        `SELECT COUNT(*) AS count FROM ${quoteMysqlIdentifier(table.name)}`
      );
      const count = Number(rows[0].count);
      const reportTable = report.tables.find(item => item.name === table.name);
      reportTable.destination_count = count;
      if (count !== reportTable.source_count) {
        throw new Error(`Record count mismatch for ${table.name}: SQLite=${reportTable.source_count}, MySQL=${count}.`);
      }
    }
    await connection.commit();
    report.status = 'completed';
    report.total_source_records = report.tables.reduce((total, table) => total + table.source_count, 0);
    report.total_destination_records = report.tables.reduce((total, table) => total + table.destination_count, 0);
    report.backup_integrity_check = 'ok';
    await writeReport(reportPath, report);
    console.log(`SQLite migration verified: ${report.tables.length} tables, ${report.total_destination_records} records.`);
    console.log(`Protected SQLite backup: ${backupPath}`);
    console.log(`Migration report: ${reportPath}`);
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        error.rollbackError = rollbackError.message;
      }
    }
    report.status = 'failed';
    report.errors.push(error.message);
    try {
      await writeReport(reportPath, report);
      console.error(`Migration report: ${reportPath}`);
    } catch (reportError) {
      console.error(`Could not write migration report: ${reportError.message}`);
    }
    throw error;
  } finally {
    if (connection) connection.release();
    await database.close();
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Usage: node server/config/migrateSqliteToMysql.js --source <sqlite-file> [--report <json-file>]');
    return;
  }
  await migrate(options);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`SQLite migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, compareTables, orderTables };
