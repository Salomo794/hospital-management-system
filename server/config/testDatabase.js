function validateTestDatabaseUrl(value) {
  const configuredUrl = String(value || '').trim();
  if (!configuredUrl) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated local MySQL test database.');
  }

  try {
    const url = new URL(configuredUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const isLoopbackHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);

    if (url.protocol !== 'mysql:' || !isLoopbackHost ||
        !/^hms_test(?:_[a-z0-9_]+)?$/i.test(databaseName) ||
        !url.username) {
      throw new Error(
        'TEST_DATABASE_URL must use mysql://, connect to localhost/127.0.0.1/::1, and target hms_test or hms_test_<suffix>.'
      );
    }
  } catch (error) {
    if (error.message.startsWith('TEST_DATABASE_URL must use')) throw error;
    throw new Error('TEST_DATABASE_URL must be a valid MySQL URL for a dedicated local test database.');
  }

  return configuredUrl;
}

const configuredUrl = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
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

module.exports = { resetAndSeed, validateTestDatabaseUrl };
