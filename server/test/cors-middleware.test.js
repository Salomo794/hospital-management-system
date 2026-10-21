const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const request = require('supertest');

// The API is booted the way production boots it, because the behaviour under
// test only exists in production: the development allowlist is wider, so a
// broken production configuration would go unnoticed.
process.env.NODE_ENV = 'production';
process.env.PUBLIC_URL = 'https://hms.example.org';
process.env.CORS_ORIGINS = '';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SMTP_HOST = 'smtp.example.org';
process.env.SMTP_USER = 'hms@example.org';
process.env.SMTP_PASS = 'test-only-secret';
process.env.BACKUP_ENCRYPTION_KEY = 'a-long-non-placeholder-backup-secret';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-cors-'));
process.env.DB_PATH = path.join(temporaryDirectory, 'hospital.db');

const app = require('../index');
const pool = require('../config/database');

test.after(() => {
  pool.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('a request from the application\'s own origin is served', async () => {
  // The browser sends this origin on every non-GET request, even for a
  // single-service deployment, so a refusal here breaks the application.
  const response = await request(app)
    .get('/api/no-such-route')
    .set('Origin', 'https://hms.example.org');

  assert.notEqual(response.status, 403);
  assert.equal(response.headers['access-control-allow-origin'], 'https://hms.example.org');
});

test('a request from an origin that is not allowed is refused', async () => {
  const response = await request(app)
    .get('/api/no-such-route')
    .set('Origin', 'https://elsewhere.example.net');

  assert.equal(response.status, 403);
  assert.equal(response.body.message, 'Origin is not allowed by CORS');
});

test('a request without an origin header is served', async () => {
  // Server-to-server callers and command line tools send no origin at all.
  const response = await request(app).get('/api/no-such-route');

  assert.notEqual(response.status, 403);
});
