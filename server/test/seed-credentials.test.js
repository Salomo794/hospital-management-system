const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

// Seeding writes real portal PINs into the database. Printing those PINs makes
// them readable by anyone with access to the log, and the seed script is run by
// CI, where logs are public. These tests execute the real script end to end,
// because the risk lives in exactly what the process prints to stdout.

const { dropTestDatabase } = require('./helpers/mysqlTestDatabase');

const serverDirectory = path.join(__dirname, '..');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-seed-test-'));
const createdDatabases = [];

after(async () => {
  for (const name of createdDatabases) await dropTestDatabase(name);
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

// A working MRN/PIN pair looks like "MRN-4CFA4014: 633398". Matching the shape
// rather than a literal PIN keeps the assertion valid across random seeds.
const PORTAL_CREDENTIAL_PATTERN = /MRN-[0-9A-F]{8}\s*:\s*\d{6}/;

function runScript(scriptName, extraEnv = {}) {
  // Every run needs a genuinely empty database, because the seed script refuses
  // to add demo fixtures to existing data. MySQL replaces the throw-away SQLite
  // file this used to create; the schema is dropped again in after().
  const databaseName = `hms_test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
  createdDatabases.push(databaseName);
  const env = {
    ...process.env,
    DB_NAME: databaseName,
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    NODE_ENV: 'test',
  };
  delete env.DB_PATH;
  // An explicit empty value must win over anything inherited from the caller,
  // otherwise these assertions could pass or fail based on the outer shell.
  delete env.SHOW_DEMO_CREDENTIALS;
  delete env.ALLOW_DEMO_SEED;
  Object.assign(env, extraEnv);

  const setup = spawnSync(process.execPath, [path.join(serverDirectory, 'config', 'setup.js')], {
    cwd: serverDirectory,
    env,
    encoding: 'utf8',
  });
  assert.equal(setup.status, 0, `schema setup failed:\n${setup.stdout}\n${setup.stderr}`);

  const result = spawnSync(process.execPath, [path.join(serverDirectory, 'config', scriptName)], {
    cwd: serverDirectory,
    env,
    encoding: 'utf8',
  });
  return result;
}

test('seeding does not print portal PINs by default', () => {
  const result = runScript('seed.js');
  assert.equal(result.status, 0, `seeding failed:\n${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(
    result.stdout,
    PORTAL_CREDENTIAL_PATTERN,
    `seeded portal credentials were printed to stdout:\n${result.stdout}`
  );
  assert.match(result.stdout, /SHOW_DEMO_CREDENTIALS/, 'the operator should be told how to opt in');
});

test('portal PINs are printed only when explicitly requested', () => {
  const result = runScript('seed.js', { SHOW_DEMO_CREDENTIALS: 'true' });
  assert.equal(result.status, 0, `seeding failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stdout,
    PORTAL_CREDENTIAL_PATTERN,
    'opting in with SHOW_DEMO_CREDENTIALS=true should reveal the credentials'
  );
});

test('production seeding refuses to run, so real deployments cannot leak or be seeded', () => {
  // ALLOW_DEMO_SEED would permit seeding in production, but credentials must
  // still never be printed there.
  const result = runScript('seed.js', { NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true', SHOW_DEMO_CREDENTIALS: 'true' });
  assert.doesNotMatch(
    result.stdout,
    PORTAL_CREDENTIAL_PATTERN,
    `credentials must never be printed in production:\n${result.stdout}`
  );
});

test('production seeding is blocked unless explicitly overridden', () => {
  const result = runScript('seed.js', { NODE_ENV: 'production' });
  assert.notEqual(result.status, 0, 'seeding a production database without an override must fail');
  assert.match(result.stderr, /disabled in production/i);
});
