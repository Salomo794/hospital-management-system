const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const request = require('supertest');
const otplib = require('otplib');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:rootpass@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.PUBLIC_URL;

const setupDatabase = require('../config/setup');
const app = require('../index');
const pool = require('../config/database');

const SEED_PASSWORD = 'password123';

before(async () => {
  await setupDatabase();
});

after(async () => {
  await pool.close();
});

async function createUser() {
  const email = `mfa-${crypto.randomUUID()}@hospital.test`;
  const password = await bcrypt.hash(SEED_PASSWORD, 12);
  const [result] = await pool.query(
    'INSERT INTO users (uuid, email, password, role, first_name, last_name, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [crypto.randomUUID(), email, password, 'nurse', 'Mfa', 'User']
  );
  return { id: result.insertId, email };
}

async function login(email, password = SEED_PASSWORD) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.token;
}

test('staff can enable TOTP MFA and complete login with the verification code', async () => {
  const user = await createUser();
  const token = await login(user.email);

  const setup = await request(app)
    .post('/api/auth/mfa/setup')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.ok(setup.body.secret);
  assert.match(setup.body.otpauth_url, /otpauth:\/\//);

  const code = otplib.generateSync({ strategy: 'totp', secret: setup.body.secret });
  const verified = await request(app)
    .post('/api/auth/mfa/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({ code })
    .expect(200);

  assert.equal(verified.body.enabled, true);

  const firstAttempt = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: SEED_PASSWORD })
    .expect(401);

  assert.equal(firstAttempt.body.mfa_required, true);

  const completed = await request(app)
    .post('/api/auth/login/mfa')
    .send({
      email: user.email,
      code: otplib.generateSync({ strategy: 'totp', secret: setup.body.secret }),
      challenge: firstAttempt.body.challenge,
    })
    .expect(200);

  assert.ok(completed.body.token);
  assert.equal(completed.body.user.email, user.email);
});
