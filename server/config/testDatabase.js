const configuredUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!configuredUrl) {
  throw new Error('TEST_DATABASE_URL must point to a dedicated MySQL test database.');
}

let testDatabaseName;
try {
  const url = new URL(configuredUrl);
  testDatabaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (url.protocol !== 'mysql:' || !/^hms_test(?:_[a-z0-9_]+)?$/i.test(testDatabaseName)) {
    throw new Error('TEST_DATABASE_URL must target a MySQL database named hms_test or hms_test_<suffix>.');
  }
} catch (error) {
  if (error.message.startsWith('TEST_DATABASE_URL must target')) throw error;
  throw new Error('TEST_DATABASE_URL must be a valid MySQL URL for a dedicated test database.');
}

process.env.DATABASE_URL = configuredUrl;

async function resetAndSeed(pool, setup, seed) {
  const connection = await pool.getConnection();
  let failure;
  let connectionDestroyed = false;
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await connection.query(
      `SELECT TABLE_NAME AS table_name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
    );
    for (const { table_name: table } of tables) {
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  } catch (error) {
    failure = error;
  }
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (error) {
    connection.destroy();
    connectionDestroyed = true;
    failure = failure
      ? new AggregateError([failure, error], 'Test database reset and connection cleanup both failed.')
      : error;
  }
  if (!connectionDestroyed) connection.release();
  if (failure) throw failure;
  await setup();
  await seed();
}

module.exports = { resetAndSeed };
