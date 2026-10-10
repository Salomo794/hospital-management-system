const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-phone-'));
const dbPath = path.join(tempDirectory, 'hospital.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');
const { PHONE_MIN_DIGITS, PHONE_MAX_DIGITS, phoneDigitsOnly } = require('../utils/phone');

// A phone number is dialled, not formatted. Accepting "+250 788 123 456" next to
// "0788123456" means the same person is two rows that never match, and these
// tests pin that the formatted spellings are refused everywhere a phone number
// is written, not just on the form that first asked for it.

const SEED_PASSWORD = 'password123';
const STRONG_PASSWORD = 'Kigali-River-Bank-4821';

let counter = 0;
const uniqueEmail = prefix => `${prefix}-${Date.now()}-${counter++}@hospital.com`;

async function login(email = 'admin@hospital.com', password = SEED_PASSWORD) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.token;
}

// Returns the supertest request rather than a promise, so a caller can chain
// .expect() and read .body on the same object.
function createUser(token, overrides = {}) {
  return request(app)
    .post('/api/auth/register')
    .set('Authorization', `Bearer ${token}`)
    .send({
      first_name: 'Aline',
      last_name: 'Mukamana',
      email: uniqueEmail('phone'),
      password: STRONG_PASSWORD,
      role: 'nurse',
      ...overrides,
    });
}

before(async () => {
  await setupDatabase();
  await seedDatabase();
});

after(() => {
  pool.close();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('the rule itself is digits only', () => {
  assert.equal(phoneDigitsOnly('0788123456'), true);
  assert.equal(phoneDigitsOnly(''), true, 'a blank field is allowed everywhere');
  assert.equal(phoneDigitsOnly('  '), true);

  for (const formatted of [
    '+250788123456',
    '0788 123 456',
    '(078) 812-3456',
    '078-812-3456',
    '0788123456 ext 4',
    'call-me',
    '07881234a6',
    '07881234.6',
  ]) {
    assert.equal(phoneDigitsOnly(formatted), false, `"${formatted}" should be refused`);
  }
});

test('a staff account cannot be created with a formatted phone number', async () => {
  const token = await login();
  const refused = await createUser(token, { phone: '+250 788 123 456' }).expect(400);
  const message = JSON.stringify(refused.body);
  assert.match(message, /digits only/i);

  // And nothing was written.
  const email = uniqueEmail('phone-check');
  await request(app)
    .post('/api/auth/register')
    .set('Authorization', `Bearer ${token}`)
    .send({
      first_name: 'Aline',
      last_name: 'Mukamana',
      email,
      password: STRONG_PASSWORD,
      role: 'nurse',
      phone: '+250 788 123 456',
    })
    .expect(400);
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  assert.equal(rows.length, 0, 'a refused registration must not create the account');
});

test('a staff account can be created with digits, and blank stays optional', async () => {
  const token = await login();

  const created = await createUser(token, { phone: '0788123456' }).expect(201);
  const [rows] = await pool.query('SELECT phone FROM users WHERE id = ?', [created.body.user.id]);
  assert.equal(rows[0].phone, '0788123456');

  const blank = await createUser(token, { phone: '' }).expect(201);
  const [blankRows] = await pool.query('SELECT phone FROM users WHERE id = ?', [blank.body.user.id]);
  assert.equal(blankRows[0].phone, null, 'a blank phone is stored as NULL, not an empty string');

  await createUser(token, { phone: null }).expect(201);
  await createUser(token).expect(201);
});

test('a phone number of the wrong length is refused rather than stored', async () => {
  const token = await login();
  await createUser(token, { phone: '1'.repeat(PHONE_MIN_DIGITS - 1) }).expect(400);
  await createUser(token, { phone: '1'.repeat(PHONE_MAX_DIGITS + 1) }).expect(400);
  // Both ends of the range are accepted.
  await createUser(token, { phone: '1'.repeat(PHONE_MIN_DIGITS) }).expect(201);
  await createUser(token, { phone: '1'.repeat(PHONE_MAX_DIGITS) }).expect(201);
});

test('the admin edit path applies the same rule, which it previously did not', async () => {
  const token = await login();
  const created = await createUser(token, { phone: '0788123456' }).expect(201);
  const id = created.body.user.id;

  await request(app)
    .put(`/api/users/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0788 123 456' })
    .expect(400);
  const [unchanged] = await pool.query('SELECT phone FROM users WHERE id = ?', [id]);
  assert.equal(unchanged[0].phone, '0788123456', 'a refused edit must leave the row alone');

  await request(app)
    .put(`/api/users/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0788111222' })
    .expect(200);
  const [updated] = await pool.query('SELECT phone FROM users WHERE id = ?', [id]);
  assert.equal(updated[0].phone, '0788111222');

  // Clearing it stores NULL rather than an empty string that will not match.
  await request(app)
    .put(`/api/users/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '' })
    .expect(200);
  const [cleared] = await pool.query('SELECT phone FROM users WHERE id = ?', [id]);
  assert.equal(cleared[0].phone, null);
});

test('the self-service profile applies the same rule', async () => {
  const token = await login();
  const email = uniqueEmail('self');
  await createUser(token, { email, phone: '0788123456' }).expect(201);
  const userToken = await login(email, STRONG_PASSWORD);

  await request(app)
    .put('/api/auth/me')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ first_name: 'Aline', phone: '0788-123-456' })
    .expect(400);

  const updated = await request(app)
    .put('/api/auth/me')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ first_name: 'Aline', phone: '0788999888' })
    .expect(200);
  assert.equal(updated.body.phone, '0788999888');
});

test('a patient phone number and emergency contact are held to the same rule', async () => {
  const token = await login();
  const patient = body => request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({
      first_name: 'Grace',
      last_name: 'Mwangi',
      date_of_birth: '1990-04-12',
      gender: 'female',
      ...body,
    });

  await patient({ phone: '+250 788 123 456' }).expect(400);
  await patient({ emergency_contact_phone: '(078) 812-3456' }).expect(400);
  const created = await patient({ phone: '0788123456', emergency_contact_phone: '0788999888' }).expect(201);
  assert.equal(created.body.patient.phone, '0788123456');

  const [rows] = await pool.query(
    'SELECT phone, emergency_contact_phone FROM patients WHERE id = ?',
    [created.body.patient.id]
  );
  assert.equal(rows[0].phone, '0788123456');
  assert.equal(rows[0].emergency_contact_phone, '0788999888');
});
