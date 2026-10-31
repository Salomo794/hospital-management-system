const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-health-test-'));
process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:rootpass@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'health-test-secret-that-is-at-least-32-characters';
process.env.NODE_ENV = 'test';

const app = require('../index');
const originalIsReady = app.pool.isReady;

after(() => {
  app.pool.isReady = originalIsReady;
  try {
    app.pool.close?.();
  } catch (_) {
    // Cleanup should not mask the assertion result.
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('health endpoint does not disclose internal database errors', async () => {
  app.pool.isReady = async () => {
    throw new Error('ER_ACCESS_DENIED_ERROR: /private/server/connection credentials=secret-value');
  };

  const response = await request(app).get('/api/health').expect(503);

  assert.deepEqual(response.body, {
    status: 'UNAVAILABLE',
    message: 'Service temporarily unavailable',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /ER_ACCESS_DENIED_ERROR|private\/server\/connection|secret-value/i);
});
