const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const otplib = require('otplib');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:root@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.MFA_REQUIRED_ROLES = 'admin';

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

async function createUser(role, emailSuffix, withMfa) {
  const bcrypt = require('bcryptjs');
  const crypto = require('node:crypto');
  const email = `mfa-${emailSuffix}-${crypto.randomUUID()}@hospital.test`;
  const password = await bcrypt.hash(SEED_PASSWORD, 12);
  let mfaSecret = null;
  if (withMfa) {
    mfaSecret = otplib.generateSecret({ length: 20 });
  }
  const mfaEnabled = withMfa ? 1 : 0;
  const [result] = await pool.query(
    'INSERT INTO users (uuid, email, password, role, first_name, last_name, mfa_enabled, mfa_secret, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [crypto.randomUUID(), email, password, role, 'Mfa', 'User', mfaEnabled, mfaSecret]
  );
  return { id: result.insertId, email, role, mfaEnabled, mfaSecret };
}

async function login(email, password = SEED_PASSWORD) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.token;
}

async function mfaLogin(user) {
  const challengeResponse = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: SEED_PASSWORD })
    .expect(401);
  const challenge = challengeResponse.body.challenge;
  const code = otplib.generateSync({ secret: user.mfaSecret });
  const response = await request(app)
    .post('/api/auth/login/mfa')
    .send({ email: user.email, challenge, code })
    .expect(200);
  return response.body.token;
}

test('admin without MFA is blocked from admin-only routes', async () => {
  const user = await createUser('admin', 'no-mfa');
  const token = await login(user.email);

  const response = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .expect(403);

  assert.equal(response.body.mfa_required, true);
});

test('admin with MFA enabled can access admin-only routes', async () => {
  const user = await createUser('admin', 'with-mfa', true);
  const token = await mfaLogin(user);

  const response = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.ok(Array.isArray(response.body.users));
});

test('non-admin roles are not required to have MFA', async () => {
  const user = await createUser('doctor', 'doctor-no-mfa');
  const token = await login(user.email);

  const response = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.equal(response.body.email, user.email);
});

test('MFA setup endpoint is accessible without MFA', async () => {
  const user = await createUser('admin', 'setup-no-mfa');
  const token = await login(user.email);

  const response = await request(app)
    .post('/api/auth/mfa/setup')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.ok(response.body.secret);
  assert.ok(response.body.otpauth_url);
});
