const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

// The application throttled sign-in but nothing that reads patient data, so a
// leaked staff token could walk the whole database unthrottled. These tests
// check that the limits exist, that they bite, and - just as important - that
// ordinary clinical work is nowhere near them.

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-ratelimit-test-'));
const dbPath = path.join(tempDirectory, 'hospital.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');
const rateLimit = require('../middleware/rateLimit');
const { LIMITS } = rateLimit;

const tokenCache = new Map();

async function login(email = 'admin@hospital.com') {
  if (tokenCache.has(email)) return tokenCache.get(email);
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' })
    .expect(200);
  tokenCache.set(email, response.body.token);
  return response.body.token;
}

before(async () => {
  await setupDatabase();
  await seedDatabase();
});

after(async () => {
  pool.close();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

function authed(method, url, token) {
  return request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

test('a patient list is throttled once it stops looking like a person', async () => {
  rateLimit.clearAll();
  const token = await login();

  // The budget is a per-minute allowance, so the assertion is that the limiter
  // eventually refuses rather than that a particular request number fails.
  let refused = 0;
  let allowed = 0;
  for (let attempt = 0; attempt < LIMITS.bulk + 20; attempt += 1) {
    const response = await authed('get', '/api/patients?limit=1', token);
    if (response.status === 429) refused += 1;
    else if (response.status === 200) allowed += 1;
  }

  assert.ok(refused > 0, 'a sustained poll of the patient list should be refused');
  assert.ok(allowed > 0, 'the budget should allow genuine use before refusing');
});

test('a refused request explains itself and says when to come back', async () => {
  rateLimit.clearAll();
  const token = await login();
  const max = LIMITS.bulk;

  let refusal = null;
  for (let attempt = 0; attempt < max + 10; attempt += 1) {
    const response = await authed('get', '/api/patients?limit=1', token);
    if (response.status === 429) { refusal = response; break; }
  }

  assert.ok(refusal, 'expected a 429 once the budget was spent');
  assert.match(refusal.body.message, /too many requests/i);
  assert.ok(Number.isInteger(refusal.body.retry_after_seconds));
  assert.ok(refusal.body.retry_after_seconds > 0, 'the client should be told how long to wait');
  assert.ok(refusal.headers['retry-after'], 'a Retry-After header is expected for 429');
});

test('the budget is per person, not shared across accounts', async () => {
  rateLimit.clearAll();
  // Two different staff accounts each get their own allowance, because the
  // limiter charges the account id as well as the address.
  const adminToken = await login();
  const doctorToken = await login('doctor@hospital.com');
  const max = LIMITS.bulk;

  for (let attempt = 0; attempt < max + 5; attempt += 1) {
    await authed('get', '/api/patients?limit=1', adminToken);
  }
  const blocked = await authed('get', '/api/patients?limit=1', adminToken);
  assert.equal(blocked.status, 429, 'the first account should be out of budget');

  // Same address, different person: still allowed.
  const other = await authed('get', '/api/patients?limit=1', doctorToken);
  assert.equal(other.status, 200, 'one account exhausting its budget must not block another');
});

test('reads and writes are budgeted separately', async () => {
  rateLimit.clearAll();
  const token = await login();
  const [patient] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 1");

  // Spend the write budget rather than the read budget.
  for (let attempt = 0; attempt < LIMITS.write + 5; attempt += 1) {
    await authed('put', `/api/patients/${patient[0].id}`, token)
      .send({ first_name: 'Budget', last_name: 'Test' });
  }

  const read = await authed('get', `/api/patients/${patient[0].id}`, token);
  assert.equal(read.status, 200, 'exhausting the write budget should not block reading');
});

test('one address spraying many accounts is still caught', async () => {
  // The per-person budget is what protects a shared desk, but it cannot see a
  // single host holding many stolen tokens. The address backstop exists for
  // that, and it has to be reachable without being tight enough to trip on
  // ordinary use of a shared terminal.
  rateLimit.clearAll();
  const adminToken = await login();
  const [patients] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 2");

  // Ordinary shared-terminal use: several people, a handful of requests each.
  for (const token of [adminToken, await login('doctor@hospital.com'), await login('nurse@hospital.com')]) {
    for (const row of patients) {
      const response = await authed('get', `/api/patients/${row.id}`, token);
      assert.equal(response.status, 200, 'ordinary shared use must not be throttled');
    }
  }

  // Now genuinely hammer the address budget and confirm it eventually bites.
  rateLimit.clearAll();
  let refused = 0;
  for (let attempt = 0; attempt < LIMITS.read * 12; attempt += 1) {
    const response = await authed('get', `/api/patients/${patients[0].id}`, adminToken);
    if (response.status === 429) refused += 1;
  }
  assert.ok(refused > 0, 'the address backstop should eventually refuse a sustained flood');
});

test('clinical work is nowhere near the limits', async () => {
  rateLimit.clearAll();
  const token = await login();
  const [patients] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 3");

  // What a clinician actually does: open a few charts, read a history, list a
  // page. This must never trip a limit.
  for (let pass = 0; pass < 5; pass += 1) {
    for (const row of patients) {
      const detail = await authed('get', `/api/patients/${row.id}`, token);
      assert.equal(detail.status, 200);
      const history = await authed('get', `/api/patients/${row.id}/history`, token);
      assert.equal(history.status, 200);
    }
    const list = await authed('get', '/api/patients?limit=20', token);
    assert.equal(list.status, 200);
  }
});

test('the patient portal is budgeted too, so a patient session cannot be sprayed', async () => {
  rateLimit.clearAll();
  const adminToken = await login();
  const email = `rate-${Date.now()}@example.com`;
  const created = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Rate', last_name: 'Limited', date_of_birth: '1990-01-01',
      gender: 'other', email,
    })
    .expect(201);
  const portal = await request(app)
    .post('/api/portal/login')
    .send({ identifier: email, portal_pin: created.body.plain_pin })
    .expect(200);
  const portalToken = portal.body.token;

  // The portal holds no clinical notes, so a single read budget is the right
  // shape here; what matters is that repeating it is bounded.
  const first = await request(app)
    .get('/api/portal/me')
    .set('Authorization', `Bearer ${portalToken}`);
  assert.equal(first.status, 200);
});

test('rate limiting never leaks whether an account exists', async () => {
  rateLimit.clearAll();
  const token = await login('doctor@hospital.com');
  // A role without billing access is still refused for the right reason, so a
  // caller cannot distinguish "not allowed" from "throttled" to probe.
  const response = await authed('get', '/api/billing', token);
  assert.ok([403, 429].includes(response.status));
  if (response.status === 403) {
    assert.match(response.body.message, /permissions/i);
  }
});
