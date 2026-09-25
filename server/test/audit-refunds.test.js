const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-audit-test-'));
const dbPath = path.join(tempDirectory, 'hospital.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.ALLOW_SIMULATED_PAYMENTS = 'true';

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');

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

async function createBill({ unitPrice = 80, adminToken }) {
  const patient = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Refund',
      last_name: 'Tester',
      date_of_birth: '1992-03-04',
      gender: 'other',
      email: `refund-${Date.now()}-${Math.round(performance.now() * 1000)}@example.com`,
    })
    .expect(201);
  const bill = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patient.body.patient.id,
      items: [{ description: 'Refund test', category: 'other', quantity: 1, unit_price: unitPrice }],
      tax: 0,
      payment_method: 'cash',
    })
    .expect(201);
  return bill.body.id;
}

test('payments can be refunded and the bill reopens from the ledger', async () => {
  const adminToken = await login();
  const billId = await createBill({ adminToken });

  // Settle the bill, then partially refund it.
  const payment = await request(app)
    .post(`/api/billing/${billId}/payments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 80, payment_method: 'card', transaction_reference: 'refund-ref-1' })
    .expect(201);
  assert.equal(payment.body.bill.payment_status, 'paid');
  const paymentId = payment.body.payment.id;

  // A reason is mandatory.
  const noReason = await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 10 })
    .expect(400);
  assert.match(noReason.body.message, /reason/i);
  await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 10, reason: '   ' })
    .expect(400);

  // Only 80 is refundable, so anything above that is rejected.
  await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 100, reason: 'Too much' })
    .expect(400);

  const partial = await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 30, reason: 'Wrong amount keyed at the desk' })
    .expect(201);
  assert.equal(partial.body.refund.amount, 30);
  // A refund defaults to the method the money originally came in by.
  assert.equal(partial.body.refund.payment_method, 'card');
  assert.equal(partial.body.bill.paid_amount, 50);
  assert.equal(partial.body.bill.payment_status, 'partial');

  // The remaining 50 cannot be over-refunded.
  await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 60, reason: 'Over refund attempt' })
    .expect(400);

  // Omitting the amount refunds everything still refundable and reopens the bill.
  const rest = await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'Full reversal after investigation' })
    .expect(201);
  assert.equal(rest.body.refund.amount, 50);
  assert.equal(rest.body.bill.paid_amount, 0);
  assert.equal(rest.body.bill.payment_status, 'pending');

  // A fully refunded payment cannot be refunded again.
  await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'Double refund attempt' })
    .expect(409);

  await request(app)
    .post('/api/billing/payments/99999999/refund')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'Missing payment' })
    .expect(404);

  // A doctor must not be able to move money.
  const doctorToken = await login('doctor@hospital.com');
  await request(app)
    .post(`/api/billing/payments/${paymentId}/refund`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ reason: 'Not allowed' })
    .expect(403);

  // The original payment row survives, with its refund total attached.
  const detail = await request(app)
    .get(`/api/billing/${billId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.equal(detail.body.payments.length, 1, 'the original payment must not be deleted');
  assert.equal(detail.body.payments[0].amount, 80);
  assert.equal(detail.body.payments[0].refunded_amount, 80);
  assert.equal(detail.body.refunds.length, 2);
  assert.equal(
    detail.body.refunds.reduce((sum, refund) => sum + refund.amount, 0),
    80
  );

  // Collections are net of refunds, so a full reversal nets back to zero.
  const [net] = await pool.query(
    `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE bill_id = ?), 0)
            - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE bill_id = ?), 0) AS net`,
    [billId, billId]
  );
  assert.equal(net[0].net, 0);
});

test('a refunded bill can be paid again without drift', async () => {
  const adminToken = await login();
  const billId = await createBill({ unitPrice: 40, adminToken });

  await request(app)
    .post(`/api/billing/${billId}/payments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 40, payment_method: 'cash' })
    .expect(201);
  const [payment] = await pool.query('SELECT id FROM payments WHERE bill_id = ?', [billId]);

  await request(app)
    .post(`/api/billing/payments/${payment[0].id}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'Duplicate charge' })
    .expect(201);

  // Re-pay, then verify the bill total is derived correctly rather than added to.
  const repaid = await request(app)
    .post(`/api/billing/${billId}/payments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 40, payment_method: 'upi' })
    .expect(201);
  assert.equal(repaid.body.bill.paid_amount, 40);
  assert.equal(repaid.body.bill.payment_status, 'paid');

  const [ledger] = await pool.query('SELECT paid_amount, payment_status FROM bills WHERE id = ?', [billId]);
  assert.equal(ledger[0].paid_amount, 40);
  assert.equal(ledger[0].payment_status, 'paid');
});

test('the audit log records financial and security events and stays admin-only', async () => {
  const adminToken = await login();
  const doctorToken = await login('doctor@hospital.com');

  // A non-admin must not be able to read the trail.
  await request(app)
    .get('/api/audit')
    .set('Authorization', `Bearer ${doctorToken}`)
    .expect(403);
  await request(app)
    .get('/api/audit')
    .expect(401);

  // Generate a spread of audited events.
  const billId = await createBill({ unitPrice: 25, adminToken });
  const [patient] = await pool.query('SELECT id FROM patients WHERE email LIKE ? ORDER BY id DESC LIMIT 1', [
    `refund-%`,
  ]);
  await request(app)
    .post(`/api/billing/${billId}/payments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 25, payment_method: 'cash' })
    .expect(201);
  const [payment] = await pool.query('SELECT id FROM payments WHERE bill_id = ?', [billId]);
  await request(app)
    .post(`/api/billing/payments/${payment[0].id}/refund`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'Audited reversal' })
    .expect(201);
  await request(app)
    .post(`/api/patients/${patient[0].id}/portal-pin`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  await request(app)
    .post('/api/auth/register')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      email: `audited-${Date.now()}@hospital.com`,
      password: 'password123',
      first_name: 'Audited',
      last_name: 'Staff',
      role: 'nurse',
    })
    .expect(201);

  const log = await request(app)
    .get('/api/audit?limit=100')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  const actions = log.body.entries.map(entry => entry.action);
  for (const expected of [
    'user.registered',
    'auth.login.succeeded',
    'patient.created',
    'billing.bill.created',
    'billing.payment.recorded',
    'billing.payment.refunded',
    'patient.portal_pin.reset',
  ]) {
    assert.ok(actions.includes(expected), `expected the audit log to contain "${expected}"`);
  }

  // Entries carry the staff actor, so accountability is traceable.
  const refundEntry = log.body.entries.find(entry => entry.action === 'billing.payment.refunded');
  assert.equal(refundEntry.actor_type, 'staff');
  assert.equal(typeof refundEntry.user_id, 'number');
  assert.match(refundEntry.actor_email, /@/);
  assert.ok(refundEntry.ip_address, 'the audit entry should record the client address');
  assert.match(refundEntry.summary, /Audited reversal/);
  // The reason must be kept out of `action` so actions stay filterable.
  assert.equal(refundEntry.action.includes('Audited reversal'), false);
  assert.equal(
    log.body.entries.every(entry => !entry.action.includes(':')),
    true,
    'audit actions must be plain identifiers'
  );

  // Credentials must never reach the audit log. The action name
  // "patient.portal_pin.reset" legitimately contains the word, so the check
  // looks for actual secret material in the recorded values instead.
  const valueBlobs = log.body.entries
    .map(entry => `${entry.old_values || ''}${entry.new_values || ''}`)
    .join(' ');
  assert.equal(valueBlobs.includes('portal_pin'), false, 'audit log leaked a portal PIN field');
  assert.equal(valueBlobs.includes('plain_pin'), false, 'audit log leaked a portal PIN value');
  assert.equal(valueBlobs.includes('access_code'), false, 'audit log leaked a patient access code');
  assert.equal(valueBlobs.includes('$2b$'), false, 'audit log leaked a bcrypt hash');
  assert.equal(valueBlobs.includes('definitely-wrong'), false, 'audit log leaked an attempted password');
  assert.equal(
    JSON.stringify(log.body.entries).includes('password123'),
    false,
    'audit log leaked a plaintext password'
  );

  // The portal PIN reset is recorded without exposing the new credential.
  const pinEntry = log.body.entries.find(entry => entry.action === 'patient.portal_pin.reset');
  assert.equal(pinEntry.new_values, null);
  assert.equal(pinEntry.old_values, null);

  // A refused login is recorded so repeated attempts are visible.
  const failedLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@hospital.com', password: 'definitely-wrong' })
    .expect(401);
  assert.equal(typeof failedLogin.body.message, 'string');
  const afterFailure = await request(app)
    .get('/api/audit?action=auth.login.failed')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(afterFailure.body.entries.length > 0);
  const failureValues = afterFailure.body.entries
    .map(entry => `${entry.old_values || ''}${entry.new_values || ''}`)
    .join(' ');
  assert.equal(failureValues.includes('definitely-wrong'), false, 'audit log leaked an attempted password');

  // A login against a known account must name the actor, even though the
  // authenticate middleware has not run on the login route.
  const success = await request(app)
    .get('/api/audit?action=auth.login.succeeded')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  const adminSignIn = success.body.entries.find(entry => entry.actor_label === 'admin@hospital.com');
  assert.ok(adminSignIn, 'expected a signed-in entry attributed to the admin');
  assert.equal(adminSignIn.actor_type, 'staff');
  assert.equal(typeof adminSignIn.user_id, 'number');

  // An unknown email must not be attributed to a real user.
  await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody@hospital.com', password: 'wrong-password' })
    .expect(401);
  const unknown = await request(app)
    .get('/api/audit?action=auth.login.failed')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  const anonymousAttempt = unknown.body.entries.find(
    entry => String(entry.summary || '').includes('nobody@hospital.com')
  );
  assert.ok(anonymousAttempt, 'expected the unknown-account attempt to be recorded');
  assert.equal(anonymousAttempt.actor_type, 'anonymous');
  assert.equal(anonymousAttempt.user_id, null);

  // Filters work and invalid filters are rejected.
  const filtered = await request(app)
    .get('/api/audit?action=billing.payment.refunded')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(filtered.body.entries.length > 0);
  assert.equal(
    filtered.body.entries.every(entry => entry.action === 'billing.payment.refunded'),
    true
  );
  await request(app)
    .get('/api/audit?actor_type=alien')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(400);
  await request(app)
    .get('/api/audit?from_date=not-a-date')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(400);
  await request(app)
    .get('/api/audit?from_date=2026-02-02&to_date=2026-01-01')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(400);
  await request(app)
    .get('/api/audit?from_date=2026-02-30')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(400);

  const byTable = await request(app)
    .get('/api/audit?table_name=payment_refunds')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(byTable.body.entries.length > 0);
  assert.equal(byTable.body.entries.every(entry => entry.table_name === 'payment_refunds'), true);

  const actionList = await request(app)
    .get('/api/audit/actions')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(actionList.body.actions.includes('billing.payment.refunded'));
});

test('reading a patient record is logged, not just changing it', async () => {
  const adminToken = await login();
  const doctorToken = await login('doctor@hospital.com');

  const [patient] = await pool.query("SELECT id, mrn FROM patients WHERE status = 'active' ORDER BY id LIMIT 1");
  assert.ok(patient, 'fixture should contain an active patient');

  const before = await request(app)
    .get(`/api/audit?action=patient.record.viewed&patient_marker=${patient[0].id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  const countBefore = before.body.total;

  // A doctor opening a chart must leave a trace.
  await request(app)
    .get(`/api/patients/${patient[0].id}`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .expect(200);

  const afterView = await request(app)
    .get('/api/audit?action=patient.record.viewed')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.equal(afterView.body.total, countBefore + 1, 'reading a record should be audited');

  const entry = afterView.body.entries[0];
  assert.equal(entry.actor_type, 'staff');
  assert.equal(entry.actor_label, 'doctor@hospital.com');
  assert.equal(entry.record_id, patient[0].id);
  assert.match(entry.summary, new RegExp(patient[0].mrn));

  // The access log must not become a second copy of the patient's data.
  const values = `${entry.old_values || ''}${entry.new_values || ''}`;
  assert.equal(values, '', 'a read entry should not store any record contents');
  assert.equal(JSON.stringify(entry).includes('portal_pin'), false);

  // A record that does not exist is not logged as a view.
  await request(app)
    .get('/api/patients/99999999')
    .set('Authorization', `Bearer ${doctorToken}`)
    .expect(404);
  const afterMiss = await request(app)
    .get('/api/audit?action=patient.record.viewed')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.equal(afterMiss.body.total, countBefore + 1, 'a failed read should not count as an access');

  // The clinical history is the most revealing read, and is logged separately.
  await request(app)
    .get(`/api/patients/${patient[0].id}/history`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .expect(200);
  const history = await request(app)
    .get('/api/audit?action=patient.history.viewed')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(history.body.total > 0);
  assert.equal(history.body.entries[0].actor_label, 'doctor@hospital.com');
});

test('a patient portal payment is attributed to the patient, not a staff id', async () => {
  const adminToken = await login();
  const unique = `portal-audit-${Date.now()}@example.com`;
  const created = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Portal',
      last_name: 'Audit',
      date_of_birth: '1990-01-01',
      gender: 'other',
      email: unique,
    })
    .expect(201);
  const patientId = created.body.patient.id;
  const portal = await request(app)
    .post('/api/portal/login')
    .send({ identifier: unique, portal_pin: created.body.plain_pin })
    .expect(200);

  const bill = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patientId,
      items: [{ description: 'Portal audit test', category: 'other', quantity: 1, unit_price: 30 }],
      tax: 0,
      payment_method: 'cash',
    })
    .expect(201);

  await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portal.body.token}`)
    .send({ amount: 30, payment_method: 'card', request_id: `portal-audit-${Date.now()}` })
    .expect(200);

  const log = await request(app)
    .get('/api/audit?action=billing.portal_payment.recorded')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  const entry = log.body.entries[0];
  assert.equal(entry.actor_type, 'patient');
  // A patient id shares a namespace with user ids, so it must not land in user_id.
  assert.equal(entry.user_id, null);
  assert.equal(entry.actor_label, unique);
});
