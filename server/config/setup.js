'use strict';

/**
 * `npm run setup` — create/refresh the MySQL schema.
 *
 * The previous implementation held ~600 lines of SQLite `CREATE TABLE` DDL plus
 * PRAGMA/ALTER/trigger statements that had no MySQL equivalent. The canonical
 * schema now lives in `config/schema.mysql.sql`, and `config/mysqlSchema.js`
 * applies it together with the constructs that SQL implements differently on
 * MySQL (generated-column unique keys, BEFORE UPDATE triggers, SIGNAL guards).
 *
 * Running this repeatedly is safe: the schema file uses CREATE TABLE IF NOT
 * EXISTS and the bootstrap checks information_schema before adding anything.
 */

const { loadEnvironment } = require('./environment');
loadEnvironment();

const { applySchema } = require('./mysqlSchema');
const mysqlPool = require('./mysqlPool');

async function setup(options = {}) {
  const { log = console.log } = options;
  const result = await applySchema({ log });
  await mysqlPool.isReady();
  log(`MySQL schema ready: ${result.tables} tables, ${result.statements} DDL statements applied.`);
  return result;
}

if (require.main === module) {
  setup()
    .then(() => mysqlPool.close())
    .catch(error => {
      console.error('Error creating schema:', error.message);
      process.exitCode = 1;
    });
}

module.exports = setup;
