const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:root@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const setupDatabase = require('../config/setup');
const app = require('../index');
const pool = require('../config/database');
const { AdminSetupError, createAdmin, parseArguments } = require('../config/createAdmin');

// The first account on a fresh deployment is the only one that cannot be created
// through the application, because registering a user needs an administrator.
// These tests pin that bootstrap path: it must produce an account that can really
// sign in, refuse to quietly add a second administrator, and never accept a
// password the staff policy would reject.

const STRONG_PASSWORD = 'Kigali-River-Bank-4821';
const FIRST_ADMIN = {
  email: 'First.Admin@Clinic.example',
  password: STRONG_PASSWORD,
  firstName: 'Ada',
  lastName: 'Mugisha',
  phone: '+250788000000',
};

before(async () => {
  // The test setup drops every table first, so each file starts from nothing.
  await setupDatabase();
});

beforeEach(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM users');
});

after(async () => {
  await pool.close();
});

test('the account it creates can sign in as an administrator', async () => {
  const created = await createAdmin(pool, FIRST_ADMIN);
  assert.equal(created.email, 'first.admin@clinic.example', 'email is stored lower-case');

  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'FIRST.ADMIN@clinic.example', password: STRONG_PASSWORD });
  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, 'admin');
  assert.ok(response.body.token);

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${response.body.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'first.admin@clinic.example');
  assert.equal(me.body.role, 'admin');
});

test('the password is stored hashed, never as typed', async () => {
  await createAdmin(pool, FIRST_ADMIN);
  const [rows] = await pool.query('SELECT password FROM users WHERE email = ?', ['first.admin@clinic.example']);
  assert.notEqual(rows[0].password, STRONG_PASSWORD);
  assert.match(rows[0].password, /^\$2[aby]\$12\$/, 'bcrypt hash at cost 12');
});

test('creating it is recorded in the audit log without the password', async () => {
  const created = await createAdmin(pool, FIRST_ADMIN);
  const [rows] = await pool.query(
    "SELECT * FROM audit_log WHERE action = 'user.admin_bootstrapped'"
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].record_id), created.id);
  assert.equal(rows[0].actor_type, 'system');
  assert.doesNotMatch(JSON.stringify(rows[0]), new RegExp(STRONG_PASSWORD));
});

test('it refuses to add a second administrator unless asked to', async () => {
  await createAdmin(pool, FIRST_ADMIN);
  const other = { ...FIRST_ADMIN, email: 'second@clinic.example', firstName: 'Jean', lastName: 'Habimana' };

  await assert.rejects(() => createAdmin(pool, other), error => {
    assert.ok(error instanceof AdminSetupError);
    assert.match(error.message, /already exists/i);
    return true;
  });
  const [afterRefusal] = await pool.query('SELECT COUNT(*) AS total FROM users');
  assert.equal(Number(afterRefusal[0].total), 1);

  await createAdmin(pool, other, { allowAdditional: true });
  const [afterOverride] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
  assert.equal(Number(afterOverride[0].total), 2);
});

test('a deactivated administrator does not block creating a replacement', async () => {
  await createAdmin(pool, FIRST_ADMIN);
  await pool.query('UPDATE users SET is_active = 0');
  await createAdmin(pool, { ...FIRST_ADMIN, email: 'replacement@clinic.example', firstName: 'Jean', lastName: 'Habimana' });
});

test('an email that is already registered is refused', async () => {
  await createAdmin(pool, FIRST_ADMIN);
  await assert.rejects(
    () => createAdmin(pool, FIRST_ADMIN, { allowAdditional: true }),
    /already registered/i
  );
});

test('passwords the staff policy rejects are refused before anything is written', async () => {
  for (const password of ['short', 'password123', '123456789012', 'Ada-Mugisha-2026']) {
    await assert.rejects(
      () => createAdmin(pool, { ...FIRST_ADMIN, password }),
      AdminSetupError,
      `"${password}" should be rejected`
    );
  }
  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM users');
  assert.equal(Number(rows[0].total), 0);
});

test('missing or malformed details are refused', async () => {
  await assert.rejects(() => createAdmin(pool, { ...FIRST_ADMIN, email: 'not-an-email' }), /valid email/i);
  await assert.rejects(() => createAdmin(pool, { ...FIRST_ADMIN, firstName: '  ' }), /first name/i);
  await assert.rejects(() => createAdmin(pool, { ...FIRST_ADMIN, lastName: '' }), /last name/i);
  await assert.rejects(() => createAdmin(pool, { ...FIRST_ADMIN, password: '' }), /password is required/i);
});

test('command-line options parse in both --flag value and --flag=value forms', () => {
  assert.deepEqual(
    parseArguments(['--email', 'a@b.org', '--first-name=Ada', '--last-name', 'Mugisha', '--allow-additional']),
    { allowAdditional: true, help: false, email: 'a@b.org', firstName: 'Ada', lastName: 'Mugisha' }
  );
});

test('the password cannot be passed on the command line', () => {
  assert.throws(() => parseArguments(['--password', 'hunter2hunter2']), /command line/i);
  assert.throws(() => parseArguments(['--password=hunter2hunter2']), /command line/i);
});

test('unknown options and options without a value are rejected', () => {
  assert.throws(() => parseArguments(['--role', 'admin']), /unknown option/i);
  assert.throws(() => parseArguments(['--email']), /needs a value/i);
  assert.throws(() => parseArguments(['--email', '--first-name', 'Ada']), /needs a value/i);
});
