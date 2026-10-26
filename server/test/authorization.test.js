const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

// Authorization is the one part of an HMS that cannot be reviewed by reading it.
// Every check below is an attempt to reach a record that belongs to somebody
// else by changing an id in the URL or by presenting the wrong kind of token,
// which is exactly how an insecure direct object reference is exploited.

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-authz-test-'));
const dbPath = path.join(tempDirectory, 'hospital.authz.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
process.env.MOBILE_MONEY_ENABLED = 'true';
process.env.MOBILE_MONEY_MOCK = 'true';

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');
const rateLimit = require('../middleware/rateLimit');
const { clearPortalRateLimits } = require('../utils/portalRateLimits');

const tokens = new Map();

async function staffLogin(email = 'admin@hospital.com') {
  if (tokens.has(email)) return tokens.get(email);
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' })
    .expect(200);
  tokens.set(email, response.body.token);
  return response.body.token;
}

async function registerStaff(adminToken, role) {
  const email = `authz-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await request(app)
    .post('/api/auth/register')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Authz',
      last_name: role,
      email,
      password: 'Birch-Canyon-Ledger-42!',
      role,
    })
    .expect(201);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'Birch-Canyon-Ledger-42!' })
    .expect(200);
  tokens.set(email, login.body.token);
  return { id: created.body.user.id, email, token: login.body.token };
}

async function createPatient(adminToken, label) {
  const response = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: label,
      last_name: 'Patient',
      date_of_birth: '1979-03-14',
      gender: 'female',
      email: `authz-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .expect(201);
  return { id: response.body.patient.id, pin: response.body.plain_pin, mrn: response.body.patient.mrn };
}

async function portalLogin(patient) {
  const response = await request(app)
    .post('/api/portal/login')
    .send({ identifier: patient.mrn, portal_pin: patient.pin })
    .expect(200);
  return response.body.token;
}

async function createBill(adminToken, patientId, unitPrice = 250) {
  const response = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patientId,
      items: [{ description: 'Consultation', category: 'consultation', quantity: 1, unit_price: unitPrice }],
      tax: 0,
    })
    .expect(201);
  return response.body;
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

test('a patient portal token is refused by every staff-only endpoint', async () => {
  const adminToken = await staffLogin();
  const patient = await createPatient(adminToken, 'Portal');
  const portalToken = await portalLogin(patient);
  const admin = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  const staffOnly = [
    ['get', '/api/patients'],
    ['get', `/api/patients/${patient.id}`],
    ['get', `/api/users/${admin.body.user.id}`],
    ['get', `/api/emr/patient/${patient.id}`],
    ['get', '/api/billing'],
    ['get', '/api/reports/dashboard'],
    ['post', '/api/portal/checkins'],
  ];

  for (const [method, url] of staffOnly) {
    const response = await request(app)[method](url)
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ patient_id: patient.id });
    assert.equal(
      response.status,
      401,
      `${method.toUpperCase()} ${url} must reject a patient portal token, got ${response.status}`
    );
  }
  rateLimit.clearAll();
  clearPortalRateLimits();
});

test('one patient cannot read or pay another patient\'s bill by guessing its id', async () => {
  const adminToken = await staffLogin();
  const alice = await createPatient(adminToken, 'Alice');
  const bob = await createPatient(adminToken, 'Bob');
  const aliceToken = await portalLogin(alice);
  const bobToken = await portalLogin(bob);

  const aliceBill = await createBill(adminToken, alice.id, 400);

  // Alice can see her own bill; that is the control case that proves the id is
  // real and the request shape is correct.
  const aliceBills = await request(app)
    .get('/api/portal/bills')
    .set('Authorization', `Bearer ${aliceToken}`)
    .expect(200);
  assert.ok(
    aliceBills.body.bills.some(bill => Number(bill.id) === Number(aliceBill.bill.id)),
    'a patient must be able to see their own bill'
  );

  // Bob must not even learn that Alice's bill exists.
  const bobBills = await request(app)
    .get('/api/portal/bills')
    .set('Authorization', `Bearer ${bobToken}`)
    .expect(200);
  assert.ok(
    !bobBills.body.bills.some(bill => Number(bill.id) === Number(aliceBill.bill.id)),
    'another patient\'s bill must never appear in the list'
  );

  const payAttempt = await request(app)
    .post(`/api/portal/bills/${aliceBill.bill.id}/pay`)
    .set('Authorization', `Bearer ${bobToken}`)
    .send({ amount: 10, payment_method: 'card', request_id: `authz-${Date.now()}` })
    .expect(404);
  assert.match(payAttempt.body.message, /not found/i);

  // The refused attempt must not have moved any money on Alice's bill.
  const [billRows] = await pool.query('SELECT paid_amount, payment_status FROM bills WHERE id = ?', [aliceBill.bill.id]);
  assert.equal(Number(billRows[0].paid_amount), 0, 'a rejected cross-patient payment must not touch the bill');
  assert.equal(billRows[0].payment_status, 'pending');

  const [payments] = await pool.query('SELECT COUNT(*) AS count FROM payments WHERE bill_id = ?', [aliceBill.bill.id]);
  assert.equal(Number(payments[0].count), 0, 'no payment row may be created for a rejected request');

  rateLimit.clearAll();
  clearPortalRateLimits();
});

test('a revoked portal session stops working immediately', async () => {
  const adminToken = await staffLogin();
  const patient = await createPatient(adminToken, 'Revoked');
  const portalToken = await portalLogin(patient);

  await request(app)
    .get('/api/portal/me')
    .set('Authorization', `Bearer ${portalToken}`)
    .expect(200);

  // Resetting the PIN is what reception does when a patient reports a lost
  // phone. It has to end the old session, otherwise the token is still a key.
  await request(app)
    .post(`/api/patients/${patient.id}/portal-pin`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  const afterReset = await request(app)
    .get('/api/portal/me')
    .set('Authorization', `Bearer ${portalToken}`)
    .expect(401);
  assert.match(afterReset.body.message, /revoked|sign in again/i);

  rateLimit.clearAll();
  clearPortalRateLimits();
});

test('a doctor cannot open a medical record written by another doctor', async () => {
  const adminToken = await staffLogin();
  const doctorA = await registerStaff(adminToken, 'doctor');
  const doctorB = await registerStaff(adminToken, 'doctor');
  const patient = await createPatient(adminToken, 'Emr');

  const record = await request(app)
    .post('/api/emr')
    .set('Authorization', `Bearer ${doctorA.token}`)
    .send({
      patient_id: patient.id,
      chief_complaint: 'Headache',
      diagnosis: 'Tension headache',
      treatment_plan: 'Rest and analgesia',
    })
    .expect(201);

  await request(app)
    .get(`/api/emr/${record.body.id}`)
    .set('Authorization', `Bearer ${doctorA.token}`)
    .expect(200);

  const crossDoctor = await request(app)
    .get(`/api/emr/${record.body.id}`)
    .set('Authorization', `Bearer ${doctorB.token}`)
    .expect(403);
  assert.match(crossDoctor.body.message, /own medical records/i);

  const crossList = await request(app)
    .get(`/api/emr/patient/${patient.id}`)
    .set('Authorization', `Bearer ${doctorB.token}`)
    .expect(200);
  assert.ok(
    !crossList.body.some(entry => Number(entry.id) === Number(record.body.id)),
    'the per-patient record list must hide another doctor\'s notes'
  );

  await request(app)
    .get(`/api/emr/prescriptions/${record.body.id}`)
    .set('Authorization', `Bearer ${doctorB.token}`)
    .expect(403);

  rateLimit.clearAll();
});

test('notifications can only be marked read by their owner', async () => {
  const adminToken = await staffLogin();
  const owner = await registerStaff(adminToken, 'nurse');
  const other = await registerStaff(adminToken, 'nurse');

  const [inserted] = await pool.query(
    'INSERT INTO notifications (uuid, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)',
    [`authz-${Date.now()}`, owner.id, 'Shift handover', 'Please review the ward list', 'info']
  );

  const stolen = await request(app)
    .put(`/api/notifications/${inserted.insertId}/read`)
    .set('Authorization', `Bearer ${other.token}`)
    .expect(404);
  assert.match(stolen.body.message, /not found/i);

  const [stillUnread] = await pool.query('SELECT is_read FROM notifications WHERE id = ?', [inserted.insertId]);
  assert.equal(Number(stillUnread[0].is_read), 0, 'another user must not be able to mark this notification read');

  await request(app)
    .put(`/api/notifications/${inserted.insertId}/read`)
    .set('Authorization', `Bearer ${owner.token}`)
    .expect(200);

  rateLimit.clearAll();
});

test('a user may only read their own profile unless they are an admin', async () => {
  const adminToken = await staffLogin();
  const nurse = await registerStaff(adminToken, 'nurse');
  const otherNurse = await registerStaff(adminToken, 'nurse');

  await request(app)
    .get(`/api/users/${nurse.id}`)
    .set('Authorization', `Bearer ${nurse.token}`)
    .expect(200);

  const forbidden = await request(app)
    .get(`/api/users/${otherNurse.id}`)
    .set('Authorization', `Bearer ${nurse.token}`)
    .expect(403);
  assert.match(forbidden.body.message, /own user profile/i);

  await request(app)
    .get(`/api/users/${otherNurse.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  rateLimit.clearAll();
});

test('a patient session cannot check in another patient', async () => {
  const adminToken = await staffLogin();
  const mine = await createPatient(adminToken, 'Checkin');
  const theirs = await createPatient(adminToken, 'Victim');
  const myToken = await portalLogin(mine);

  // The portal check-in resolves the patient from the session, never from the
  // body, so naming another patient is simply ignored.
  const response = await request(app)
    .post('/api/portal/checkin')
    .set('Authorization', `Bearer ${myToken}`)
    .send({ patient_id: theirs.id, mrn: theirs.mrn })
    .expect(200);
  assert.equal(response.body.mrn, undefined, 'the public response must not echo an MRN');
  assert.equal(response.body.first_name, undefined, 'the public response must not echo a name');

  const today = new Date().toISOString().slice(0, 10);
  const [victimCheckins] = await pool.query(
    'SELECT COUNT(*) AS count FROM checkins WHERE patient_id = ? AND checkin_date = ?',
    [theirs.id, today]
  );
  assert.equal(Number(victimCheckins[0].count), 0, 'the other patient must not have been checked in');

  const [mineCheckins] = await pool.query(
    'SELECT COUNT(*) AS count FROM checkins WHERE patient_id = ? AND checkin_date = ?',
    [mine.id, today]
  );
  assert.equal(Number(mineCheckins[0].count), 1, 'the signed-in patient should be checked in');

  rateLimit.clearAll();
  clearPortalRateLimits();
});
