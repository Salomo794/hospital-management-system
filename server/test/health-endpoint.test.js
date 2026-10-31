const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// This file never reaches the database: the health probe's isReady() is
// replaced, so no connection or schema is created.
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
});

test('health endpoint does not disclose internal database errors', async () => {
  app.pool.isReady = async () => {
    throw new Error('SQLITE_CANTOPEN: /private/server/path/hospital.db credentials=secret-value');
  };

  const response = await request(app).get('/api/health').expect(503);

  assert.deepEqual(response.body, {
    status: 'UNAVAILABLE',
    message: 'Service temporarily unavailable',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /SQLITE_CANTOPEN|private\/server\/path|secret-value/i);
});
