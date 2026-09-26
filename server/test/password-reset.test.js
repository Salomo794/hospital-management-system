const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-pwreset-'));
const dbPath = path.join(tempDirectory, 'hospital.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
// No SMTP: the mailer logs instead of sending, which keeps the same code path
// production uses without needing a network.
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.PUBLIC_URL;

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');
const mailer = require('../services/mailer');
const { hashToken } = require('../services/passwordReset');

// Compliant with the password policy, so a failure means the reset flow
// rejected it and not that the policy did.
const STRONG_PASSWORD = 'Kigali-River-Bank-4821';
const SECOND_STRONG_PASSWORD = 'Butare-Ridge-Trail-5517';
const SEED_PASSWORD = 'password123';

let sent = [];
let userCounter = 0;

before(async () => {
  await setupDatabase();
  await seedDatabase();
});

beforeEach(() => {
  sent = [];
  // Captures what would have gone out, so the link can be followed without an
  // inbox.
  mailer.setTransport({
    async sendMail(message) {
      sent.push(message);
      return { messageId: crypto.randomUUID() };
    },
  });
});

after(() => {
  mailer.resetTransport();
  pool.close();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

/**
 * Every test gets its own account. Resetting a password mutates it, so sharing
 * the seeded demo accounts makes each test's starting state depend on the ones
 * that ran before it - which is how a test ends up asserting against a password
 * another test already changed.
 */
async function createTestUser({ firstName = 'Testcase', lastName = 'User', isActive = true } = {}) {
  userCounter += 1;
  const email = `reset-${userCounter}-${crypto.randomBytes(3).toString('hex')}@hospital.test`;
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const [result] = await pool.query(
    `INSERT INTO users (uuid, email, password, role, first_name, last_name, is_active)
     VALUES (?, ?, ?, 'nurse', ?, ?, ?)`,
    [crypto.randomUUID(), email, passwordHash, firstName, lastName, isActive ? 1 : 0]
  );
  return { email, password: SEED_PASSWORD, id: result.insertId, firstName, lastName };
}

async function login(email, password = SEED_PASSWORD) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.token;
}

// Pulls the token out of the captured email body.
function tokenFromLastEmail() {
  const body = sent[sent.length - 1];
  assert.ok(body, 'expected a password reset email to have been sent');
  const match = body.text.match(/token=([a-f0-9]{64})/);
  assert.ok(match, 'the reset email did not contain a token link');
  return match[1];
}

async function requestReset(email) {
  const response = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email })
    .expect(200);
  return response;
}

test('a reset link is sent to a known address and can set a new password', async () => {
  const user = await createTestUser();
  const response = await requestReset(user.email);
  assert.match(response.body.message, /if an account exists/i);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, user.email);
  assert.match(sent[0].subject, /reset your hospital management system password/i);

  const token = tokenFromLastEmail();
  // The form checks the link before showing itself, so the endpoint has to work.
  const check = await request(app).get(`/api/auth/reset-password/${token}`).expect(200);
  assert.equal(check.body.valid, true);

  const reset = await request(app)
    .post('/api/auth/reset-password')
    .send({ token, newPassword: STRONG_PASSWORD })
    .expect(200);
  assert.match(reset.body.message, /password has been reset/i);

  await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: STRONG_PASSWORD })
    .expect(200);
  // The old password must stop working, or the reset achieved nothing.
  await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(401);
});

test('the response is identical for an unknown address, so accounts cannot be enumerated', async () => {
  const user = await createTestUser();
  const known = await requestReset(user.email);
  const unknown = await requestReset('nobody@nowhere.example');

  assert.equal(known.body.message, unknown.body.message);
  assert.deepEqual(Object.keys(known.body).sort(), Object.keys(unknown.body).sort());
  // One email sent, not two: the unknown address must not cause any outbound
  // traffic that a difference in volume or timing could reveal.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, user.email);
});

test('a deactivated account is not sent a link', async () => {
  const user = await createTestUser({ isActive: false });
  const response = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: user.email })
    .expect(200);
  assert.match(response.body.message, /if an account exists/i);
  assert.equal(sent.length, 0, 'a deactivated account must not receive a reset link');
});

test('a reset token is single use', async () => {
  const user = await createTestUser();
  await requestReset(user.email);
  const token = tokenFromLastEmail();
  await request(app).post('/api/auth/reset-password').send({ token, newPassword: STRONG_PASSWORD }).expect(200);

  // Replaying the link is the obvious way to take an account over after a
  // legitimate reset, so the second attempt has to fail.
  const replay = await request(app)
    .post('/api/auth/reset-password')
    .send({ token, newPassword: SECOND_STRONG_PASSWORD })
    .expect(400);
  assert.match(replay.body.message, /already been used/i);
});

test('an expired token is refused', async () => {
  const user = await createTestUser();
  await requestReset(user.email);
  const token = tokenFromLastEmail();
  await pool.query(
    "UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?",
    [hashToken(token)]
  );
  const expired = await request(app)
    .post('/api/auth/reset-password')
    .send({ token, newPassword: STRONG_PASSWORD })
    .expect(400);
  assert.match(expired.body.message, /expired/i);
  await request(app).get(`/api/auth/reset-password/${token}`).expect(400);
});

test('requesting a new link retires the previous one', async () => {
  const user = await createTestUser();
  await requestReset(user.email);
  const first = tokenFromLastEmail();
  await requestReset(user.email);
  const second = tokenFromLastEmail();
  assert.notEqual(first, second);

  // The older link must not stay usable in parallel with the newer one.
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token: first, newPassword: STRONG_PASSWORD })
    .expect(400);
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token: second, newPassword: STRONG_PASSWORD })
    .expect(200);
});

test('only the hash of a token is stored', async () => {
  const user = await createTestUser();
  await requestReset(user.email);
  const token = tokenFromLastEmail();
  const [rows] = await pool.query(
    'SELECT token_hash FROM password_reset_tokens WHERE user_id = ?',
    [user.id]
  );
  assert.ok(rows.length > 0);
  // Across every token this account has had, not just the newest: an earlier one
  // must not have been stored in the clear either.
  for (const row of rows) {
    assert.notEqual(row.token_hash, token, 'the raw token must never be written to the database');
    assert.match(row.token_hash, /^[a-f0-9]{64}$/, 'the stored value must be a SHA-256 digest');
  }
  const [fresh] = await pool.query('SELECT id FROM password_reset_tokens WHERE token_hash = ?', [hashToken(token)]);
  assert.equal(fresh.length, 1, 'the emailed token must be findable by its digest');
});

test('the password policy is enforced on reset and a rejection does not burn the link', async () => {
  const user = await createTestUser({ firstName: 'Aline' });
  await requestReset(user.email);
  const token = tokenFromLastEmail();

  const weak = await request(app)
    .post('/api/auth/reset-password')
    .send({ token, newPassword: 'short' })
    .expect(400);
  assert.match(weak.body.message, /at least 12 characters/i);

  const common = await request(app)
    .post('/api/auth/reset-password')
    .send({ token, newPassword: 'password12345' })
    .expect(400);
  assert.match(common.body.message, /too common/i);

  // Built from the account holder's own first name, which the policy rejects.
  // Deriving it from the real user matters: an invented word that happens to
  // be acceptable would let the reset succeed and silently change the password.
  const selfReference = await request(app)
    .post('/api/auth/reset-password')
    .send({ token, newPassword: `${user.firstName}-Bridge-Trail-7702` })
    .expect(400);
  assert.match(selfReference.body.message, /must not contain your name or email/i);

  // A rejected attempt must not burn the link, or a user who misjudges the
  // policy would be locked out and have to start over.
  const stillValid = await request(app).get(`/api/auth/reset-password/${token}`).expect(200);
  assert.equal(stillValid.body.valid, true);
  // Nothing above touched the stored password.
  await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
});

test('resetting a password ends every session that predates it', async () => {
  // The session that was stolen is the reason someone resets a password. If it
  // survives, the reset changes nothing for the attacker.
  const user = await createTestUser();
  const stolenToken = await login(user.email);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${stolenToken}`).expect(200);

  await requestReset(user.email);
  const token = tokenFromLastEmail();
  await request(app).post('/api/auth/reset-password').send({ token, newPassword: STRONG_PASSWORD }).expect(200);

  const rejected = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${stolenToken}`)
    .expect(401);
  assert.match(rejected.body.message, /password changed/i);

  // The account is still usable, by signing in again.
  const renewed = await login(user.email, STRONG_PASSWORD);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${renewed}`).expect(200);
});

test('changing a password also ends other sessions', async () => {
  const user = await createTestUser();
  const first = await login(user.email);
  const second = await login(user.email);
  assert.notEqual(first, second);

  const change = await request(app)
    .put('/api/auth/change-password')
    .set('Authorization', `Bearer ${first}`)
    .send({ currentPassword: user.password, newPassword: SECOND_STRONG_PASSWORD })
    .expect(200);
  assert.match(change.body.message, /updated/i);

  // The session that made the change is stale too, so the user signs in again.
  for (const stale of [first, second]) {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${stale}`)
      .expect(401);
    assert.match(response.body.message, /password changed/i);
  }
});

test('a nonsense token is rejected without revealing anything', async () => {
  const response = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: 'not-a-real-token', newPassword: STRONG_PASSWORD })
    .expect(400);
  assert.match(response.body.message, /not valid/i);
  await request(app).post('/api/auth/reset-password').send({ newPassword: STRONG_PASSWORD }).expect(400);
  await request(app).get('/api/auth/reset-password/some-other-nonsense').expect(400);
});

test('repeat requests for one address are rate limited so they cannot mail-bomb an inbox', async () => {
  // The same address repeatedly, which is the actual attack: a flood of reset
  // mail at one person's account. The per-address limit is what stops it.
  const user = await createTestUser();
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    statuses.push(response.status);
  }
  assert.ok(statuses.includes(429), `expected a 429 within 6 requests, got ${statuses.join(',')}`);
  // The first few are still allowed, or staff could never ask for a link.
  assert.equal(statuses[0], 200);
  assert.ok(sent.length <= 3, `expected at most 3 emails before the limit, sent ${sent.length}`);
});

test('the reset request is audited with the account it belongs to', async () => {
  const user = await createTestUser();
  await requestReset(user.email);
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'auth.password_reset.requested' AND summary LIKE ?",
    [`%${user.email}%`]
  );
  assert.ok(rows[0].count >= 1, 'the reset request must be written to the audit log');

  // An unknown address is recorded too, without an account, so repeated probing
  // is visible.
  await request(app).post('/api/auth/forgot-password').send({ email: 'audit-probe@nowhere.example' }).expect(200);
  const [probeRows] = await pool.query(
    "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'auth.password_reset.requested' AND summary LIKE '%audit-probe@nowhere.example%'"
  );
  assert.ok(probeRows[0].count >= 1, 'a probe against an unknown address must also be audited');
});

test('a missing SMTP server in production is reported rather than silently swallowed', async () => {
  mailer.resetTransport();
  const user = await createTestUser();
  const nodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    // A user told to check their inbox while nothing is ever sent is worse than
    // an error, so this has to surface.
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: user.email });
    assert.equal(response.status, 503);
    assert.match(response.body.message, /not available|not configured/i);

    // The token was already committed, so it must not be left usable behind the
    // failure.
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS count FROM password_reset_tokens WHERE used_at IS NULL AND user_id = ?',
      [user.id]
    );
    assert.equal(rows[0].count, 0, 'a link that could not be emailed must not stay usable');
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
});
