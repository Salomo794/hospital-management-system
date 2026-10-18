const test = require('node:test');
const assert = require('node:assert/strict');
const { productionReadinessErrors, assertProductionReadiness } = require('../config/productionReadiness');

const validEnvironment = {
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://hms.example.org',
  CORS_ORIGINS: 'https://hms.example.org,https://portal.example.org',
  SMTP_HOST: 'smtp.example.org',
  SMTP_USER: 'hms@example.org',
  SMTP_PASS: 'test-only-secret',
  BACKUP_ENCRYPTION_KEY: 'a-long-non-placeholder-backup-secret',
  DB_PATH: '/var/lib/hms/hospital.db',
};

test('accepts a production environment with HTTPS, mail, encrypted backups and persistent storage', () => {
  assert.deepEqual(productionReadinessErrors(validEnvironment), []);
  assert.doesNotThrow(() => assertProductionReadiness(validEnvironment));
});

test('rejects insecure or malformed public URLs', () => {
  for (const PUBLIC_URL of [
    'http://hms.example.org',
    'https://hms.example.org/',
    'https://user:pass@hms.example.org',
    'https://hms.example.org?next=/login',
    'https://hms.example.org#section',
    'not-a-url',
  ]) {
    const errors = productionReadinessErrors({ ...validEnvironment, PUBLIC_URL });
    assert.ok(errors.some(error => error.includes('PUBLIC_URL')), `Expected URL to be rejected: ${PUBLIC_URL}`);
  }
});

test('rejects missing HTTPS configuration', () => {
  const errors = productionReadinessErrors({
    ...validEnvironment,
    PUBLIC_URL: 'http://hms.example.org',
    CORS_ORIGINS: 'http://hms.example.org',
  });
  assert.ok(errors.some(error => error.includes('PUBLIC_URL')));
  assert.ok(errors.some(error => error.includes('CORS_ORIGINS')));
});

test('rejects CORS entries that are URLs rather than exact browser origins', () => {
  for (const invalidOrigin of [
    'https://hms.example.org/',
    'https://hms.example.org/app',
    'https://user:pass@hms.example.org',
    'https://portal.example.org/path/',
  ]) {
    const errors = productionReadinessErrors({
      ...validEnvironment,
      CORS_ORIGINS: invalidOrigin,
    });
    assert.ok(
      errors.some(error => error.includes('CORS_ORIGINS')),
      `Expected CORS origin to be rejected: ${invalidOrigin}`
    );
  }
});

test('rejects empty CORS entries rather than silently ignoring configuration mistakes', () => {
  const errors = productionReadinessErrors({
    ...validEnvironment,
    CORS_ORIGINS: 'https://hms.example.org,,https://portal.example.org',
  });
  assert.ok(errors.some(error => error.includes('CORS_ORIGINS')));
});

test('accepts an HTTPS origin with an explicit port', () => {
  assert.deepEqual(productionReadinessErrors({
    ...validEnvironment,
    CORS_ORIGINS: 'https://hms.example.org:8443',
  }), []);
});

test('rejects missing email and weak or placeholder backup encryption configuration', () => {
  for (const BACKUP_ENCRYPTION_KEY of ['REPLACE_ME', 'short']) {
    const errors = productionReadinessErrors({
      ...validEnvironment,
      SMTP_PASS: '',
      BACKUP_ENCRYPTION_KEY,
    });
    assert.ok(errors.some(error => error.includes('SMTP_PASS')));
    assert.ok(errors.some(error => error.includes('BACKUP_ENCRYPTION_KEY')));
  }
});

test('rejects in-memory database storage for production', () => {
  assert.ok(productionReadinessErrors({ ...validEnvironment, DB_PATH: ':memory:' })
    .some(error => error.includes('persistent database file')));
});

test('reports all blockers together', () => {
  assert.throws(
    () => assertProductionReadiness({ NODE_ENV: 'production' }),
    error => error.message.includes('Refusing to start') &&
      error.message.includes('PUBLIC_URL') &&
      error.message.includes('SMTP_HOST')
  );
});
