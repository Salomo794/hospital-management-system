const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:root@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.BACKUP_ENCRYPTION_KEY = '';

const pool = require('../config/database');
const setupDatabase = require('../config/setup');
const { createBackup, verifyBackup } = require('../config/mysqlBackup');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-mysql-backup-test-'));

after(async () => {
  await pool.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('MySQL backup is written, verified, and includes the schema', async () => {
  await setupDatabase();
  const { file, manifest } = await createBackup({ directory: tempDirectory });
  assert.equal(manifest.encrypted, false);
  assert.equal((await verifyBackup(file)).file, path.basename(file));
  assert.match(fs.readFileSync(file, 'utf8'), /CREATE TABLE `payments`/);
  assert.ok(manifest.row_counts.payments >= 0);
});
