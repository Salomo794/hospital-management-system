const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:root@127.0.0.1:3306/hms_test';

const { validateTestDatabaseUrl } = require('../config/testDatabase');

test('accepts a dedicated local MySQL test database', () => {
  for (const url of [
    'mysql://root:secret@localhost:3306/hms_test',
    'mysql://root:secret@127.0.0.1:3306/hms_test_ci',
    'mysql://root:secret@[::1]:3307/hms_test',
  ]) {
    assert.equal(validateTestDatabaseUrl(url), url);
  }
});

test('rejects remote MySQL hosts even when the database name looks like a test database', () => {
  for (const url of [
    'mysql://root:secret@db.example.com:3306/hms_test',
    'mysql://root:secret@10.0.0.5:3306/hms_test_ci',
  ]) {
    assert.throws(() => validateTestDatabaseUrl(url), /localhost\/127\.0\.0\.1\/::1/);
  }
});

test('rejects production-like database names and non-MySQL URLs', () => {
  assert.throws(
    () => validateTestDatabaseUrl('mysql://root:secret@127.0.0.1:3306/hospital'),
    /hms_test/
  );
  assert.throws(
    () => validateTestDatabaseUrl('postgres://root:secret@localhost:5432/hms_test'),
    /hms_test/
  );
});

test('rejects an empty test database URL', () => {
  assert.throws(() => validateTestDatabaseUrl(''), /dedicated local MySQL test database/);
});
