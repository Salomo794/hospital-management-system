const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-test-'));
const dbPath = path.join(tempDirectory, 'hospital.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
// The mock rail exercises the real pending -> settled lifecycle without a
// Paystack account. It is refused in production by config/mobileMoney.js.
process.env.MOBILE_MONEY_ENABLED = 'true';
process.env.MOBILE_MONEY_MOCK = 'true';

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');
const rateLimit = require('../middleware/rateLimit');
const { clearPortalRateLimits } = require('../utils/portalRateLimits');
const {
  generateCheckinToken,
  expiryFor,
} = require('../utils/checkinTokens');
const { evaluateSafety } = require('../utils/safety');
const { settleMockCharge, getMockCharge, mockWebhookSignature } = require('../services/mobileMoney');

// Mirrors the per-IP budget in utils/portalRateLimits.js. Kept as a named
// constant so the throttling test fails loudly if the real limit moves.
const CHECKIN_ATTEMPT_LIMIT = 20;

// Signs and posts exactly these bytes. Supertest re-serialises an object, so the
// signature has to be computed over the literal string that goes on the wire.
function signedWebhook(payload) {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/api/billing/mobile-money/webhook')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', mockWebhookSignature(body))
    .send(body);
}

async function createBillWithBalance(adminToken, unitPrice, patientId) {
  const patient = patientId
    ? { body: { patient: { id: patientId } } }
    : await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Mobile',
        last_name: 'Money',
        date_of_birth: '1990-04-05',
        gender: 'female',
        email: `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      })
      .expect(201);
  const bill = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patient.body.patient.id,
      items: [{ description: 'Mobile money test', category: 'other', quantity: 1, unit_price: unitPrice }],
      tax: 0,
    })
    .expect(201);
  return bill.body;
}

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

test('health checks the initialized database', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.body.status, 'OK');
});

test('patient registration issues a unique 4-digit numeric access code', async () => {
  const token = await login();
  const codes = new Set();
  for (let index = 0; index < 5; index += 1) {
    const response = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        first_name: `Code${index}`,
        last_name: 'Patient',
        date_of_birth: '1988-08-08',
        gender: 'female',
        email: `code-${index}-${Date.now()}@example.com`,
      })
      .expect(201);
    const accessCode = response.body.patient.access_code;
    assert.match(accessCode, /^\d{4}$/, `access code "${accessCode}" should be exactly 4 digits`);
    codes.add(accessCode);
  }
  assert.equal(codes.size, 5, 'access codes must be unique across registrations');
  // This case spends several writes; hand the shared budgets back untouched so
  // the rest of the suite does not inherit its consumption.
  rateLimit.clearAll();
});

test('malformed JSON returns the API error contract', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email":')
    .expect(400);
  assert.match(response.body.message, /invalid JSON/i);
});

test('pagination cannot be bypassed with a negative limit', async () => {
  const token = await login();
  const response = await request(app)
    .get('/api/patients?page=1&limit=-1')
    .set('Authorization', `Bearer ${token}`)
    .expect(400);
  assert.match(response.body.message, /limit/i);
});

test('the user list filters by account status, and rejects an unknown one', async () => {
  const adminToken = await login();
  const email = `status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await request(app)
    .post('/api/auth/register')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Status',
      last_name: 'Filter',
      email,
      password: 'Birch-Canyon-Ledger-42!',
      role: 'nurse',
    })
    .expect(201);
  const id = created.body.user.id;

  // Deactivating through the API is what the admin page's delete button does.
  await request(app)
    .delete(`/api/users/${id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  const inactive = await request(app)
    .get('/api/users?status=inactive&limit=100')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(inactive.body.users.every(u => !u.is_active), 'the inactive filter must exclude active accounts');
  assert.ok(inactive.body.users.some(u => u.id === id), 'the deactivated account must be listed as inactive');

  await request(app)
    .put(`/api/users/${id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ is_active: true })
    .expect(200);

  const active = await request(app)
    .get('/api/users?status=active&limit=100')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(active.body.users.every(u => u.is_active), 'the active filter must exclude deactivated accounts');
  assert.ok(active.body.users.some(u => u.id === id), 'the restored account must be listed as active');

  await request(app)
    .get('/api/users?status=not-a-status')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(400);

  // Registering, deactivating and restoring all spend from the same write
  // budget the rest of the suite uses; hand it back so later cases start clean.
  rateLimit.clearAll();
});

test('a pharmacist cannot cancel appointments', async () => {
  const adminToken = await login();
  const appointments = await request(app)
    .get('/api/appointments?limit=1')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  const pharmacistToken = await login('pharmacist@hospital.com');
  await request(app)
    .put(`/api/appointments/${appointments.body.appointments[0].id}/cancel`)
    .set('Authorization', `Bearer ${pharmacistToken}`)
    .expect(403);
});

test('appointment status transitions cannot reopen or cancel terminal records', async () => {
  const token = await login();
  const [patients] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 1");
  const [doctors] = await pool.query("SELECT id FROM users WHERE role = 'doctor' AND is_active = 1 ORDER BY id LIMIT 1");
  const [appointment] = await pool.query(
    `INSERT INTO appointments
     (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, type, status)
     VALUES (?, ?, ?, ?, '2099-01-02', '12:34', 'consultation', 'scheduled')`,
    [randomUUID(), `APT-TRANSITION-${randomUUID()}`, patients[0].id, doctors[0].id]
  );

  const inProgress = await request(app)
    .put(`/api/appointments/${appointment.insertId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'in_progress' })
    .expect(200);
  assert.equal(inProgress.body.status, 'in_progress');
  const completed = await request(app)
    .put(`/api/appointments/${appointment.insertId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'completed' })
    .expect(200);
  assert.equal(completed.body.status, 'completed');

  const reopen = await request(app)
    .put(`/api/appointments/${appointment.insertId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'scheduled' })
    .expect(409);
  assert.match(reopen.body.message, /cannot transition/i);
  await request(app)
    .put(`/api/appointments/${appointment.insertId}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .expect(409);
});

test('lab results cannot update items from another order', async () => {
  const token = await login('labtech@hospital.com');
  const [items] = await pool.query(`
    SELECT loi.id, loi.lab_order_id, loi.result_value
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id
    WHERE lo.status != 'completed'
    ORDER BY loi.lab_order_id, loi.id
  `);
  assert.ok(items.length >= 2, 'fixture should contain at least two pending lab items');
  const firstOrderId = items[0].lab_order_id;
  const foreignItem = items.find(item => item.lab_order_id !== firstOrderId);
  const originalValue = foreignItem.result_value;

  const response = await request(app)
    .put(`/api/laboratory/orders/${firstOrderId}/results`)
    .set('Authorization', `Bearer ${token}`)
    .send({ items: [{ id: foreignItem.id, result_value: '999' }] })
    .expect(400);
  assert.match(response.body.message, /every item/i);

  const [unchanged] = await pool.query('SELECT result_value FROM lab_order_items WHERE id = ?', [foreignItem.id]);
  assert.equal(unchanged[0].result_value, originalValue);
});

test('lab orders cannot be completed with blank results', async () => {
  const token = await login('labtech@hospital.com');
  const [orders] = await pool.query("SELECT id FROM lab_orders WHERE status != 'completed' LIMIT 1");
  const [items] = await pool.query('SELECT id FROM lab_order_items WHERE lab_order_id = ?', [orders[0].id]);
  const response = await request(app)
    .put(`/api/laboratory/orders/${orders[0].id}/results`)
    .set('Authorization', `Bearer ${token}`)
    .send({ items: items.map(item => ({ id: item.id, result_value: '   ' })) })
    .expect(400);
  assert.match(response.body.message, /result_value/i);
});

test('multi-item lab orders finalize with every result exactly once', async () => {
  const doctorToken = await login('doctor@hospital.com');
  const labTechToken = await login('labtech@hospital.com');
  const [patients] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 1");
  const [tests] = await pool.query('SELECT id FROM lab_tests WHERE is_active = 1 ORDER BY id LIMIT 2');
  assert.ok(tests.length >= 2, 'fixture should contain at least two lab tests');

  const order = await request(app)
    .post('/api/laboratory/orders')
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ patient_id: patients[0].id, test_ids: tests.map(test => test.id) })
    .expect(201);
  const detail = await request(app)
    .get(`/api/laboratory/orders/${order.body.id}`)
    .set('Authorization', `Bearer ${labTechToken}`)
    .expect(200);
  const results = detail.body.items.map((item, index) => ({
    id: item.id,
    result_value: index === 0 ? 'Normal' : '5.0',
    notes: `Result ${index + 1}`,
  }));
  await request(app)
    .put(`/api/laboratory/orders/${order.body.id}/results`)
    .set('Authorization', `Bearer ${labTechToken}`)
    .send({ items: results })
    .expect(200);

  const [stored] = await pool.query(
    `SELECT lo.status, COUNT(loi.result_value) AS result_count
     FROM lab_orders lo JOIN lab_order_items loi ON loi.lab_order_id = lo.id
     WHERE lo.id = ? GROUP BY lo.id`,
    [order.body.id]
  );
  assert.equal(stored[0].status, 'completed');
  assert.equal(stored[0].result_count, 2);
});

test('billing rejects zero, negative, and over-limit payments', async () => {
  const token = await login();
  const bills = await request(app)
    .get('/api/billing?status=pending&limit=1')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(bills.body.bills.length, 1);
  const billId = bills.body.bills[0].id;
  const outstanding = bills.body.bills[0].net_amount - bills.body.bills[0].paid_amount;
  assert.ok(outstanding > 0);

  await request(app)
    .post(`/api/billing/${billId}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 0, payment_method: 'cash' })
    .expect(400);
  await request(app)
    .post(`/api/billing/${billId}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: -1, payment_method: 'cash' })
    .expect(400);
  await request(app)
    .post(`/api/billing/${billId}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: outstanding + 1, payment_method: 'cash' })
    .expect(400);
});

test('payment methods are published to the client and accepted when recorded', async () => {
  const adminToken = await login();

  // '/payment-methods' must not be captured by the '/:id' bill lookup.
  const methods = await request(app)
    .get('/api/billing/payment-methods')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  const published = methods.body.payment_methods;
  assert.ok(Array.isArray(published) && published.length > 0);
  for (const method of published) {
    assert.equal(typeof method.value, 'string');
    assert.equal(typeof method.label, 'string');
  }
  const values = published.map(method => method.value);
  for (const expected of ['cash', 'card', 'credit_card', 'mobile_wallet', 'mobile_money', 'upi', 'bank_transfer', 'cheque']) {
    assert.ok(values.includes(expected), `expected "${expected}" to be an available payment method`);
  }
  assert.equal(new Set(values).size, values.length, 'payment method values must be unique');

  const patient = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Methods',
      last_name: 'Tester',
      date_of_birth: '1991-02-03',
      gender: 'other',
      email: `methods-${Date.now()}@example.com`,
    })
    .expect(201);
  const bill = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patient.body.patient.id,
      items: [{ description: 'Payment method test', category: 'other', quantity: 1, unit_price: 100 }],
      tax: 0,
      payment_method: 'upi',
    })
    .expect(201);
  assert.equal(bill.body.payment_method, 'upi');

  // A newly added method must be usable for both partial and full settlement.
  const partial = await request(app)
    .post(`/api/billing/${bill.body.id}/payments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 40, payment_method: 'mobile_wallet', transaction_reference: `wallet-${Date.now()}` })
    .expect(201);
  assert.equal(partial.body.bill.payment_status, 'partial');
  const settled = await request(app)
    .post(`/api/billing/${bill.body.id}/payments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amount: 60, payment_method: 'cheque' })
    .expect(201);
  assert.equal(settled.body.bill.payment_status, 'paid');
  assert.equal(settled.body.bill.paid_amount, 100);

  await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patient.body.patient.id,
      items: [{ description: 'Unknown method', category: 'other', quantity: 1, unit_price: 5 }],
      payment_method: 'cryptocurrency',
    })
    .expect(400);

  // The database constraint is the last line of defence for a non-API writer.
  assert.throws(
    () => pool.sqlite
      .prepare(
        `INSERT INTO payments
         (uuid, payment_number, bill_id, patient_id, amount, payment_method, received_by)
         VALUES (?, ?, ?, ?, 1, 'cryptocurrency', NULL)`
      )
      .run(randomUUID(), `PAY-BAD-${Date.now()}`, bill.body.id, patient.body.patient.id),
    /CHECK constraint failed/i
  );
});

test('mobile money publishes a signed-in config for the payment form', async () => {
  const token = await login();
  const config = await request(app)
    .get('/api/billing/mobile-money/config')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(config.body.enabled, true);
  assert.equal(config.body.provider, 'mock');
  assert.ok(Array.isArray(config.body.networks) && config.body.networks.length > 0);
  for (const network of config.body.networks) {
    assert.equal(typeof network.value, 'string');
    assert.equal(typeof network.label, 'string');
  }
  // No credential may ever be published to the browser.
  const serialized = JSON.stringify(config.body);
  assert.ok(!/secret/i.test(serialized), 'the mobile money config must not expose a secret');
});

test('an unapproved mobile money charge does not settle the bill, and the provider does', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 100);
  assert.equal(bill.net_amount, 100);

  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0551234567', network: 'mtn', email: 'patient@example.com' })
    .expect(202);
  assert.equal(initiated.body.payment.status, 'pending');

  // The provider must actually have been asked to charge the right number and
  // network, in the right currency and for the right amount. Asserting the
  // response alone would pass even if those fields never left the server.
  const charge = getMockCharge(initiated.body.payment.payment_number);
  assert.ok(charge, 'the provider was never asked to send a prompt');
  assert.equal(charge.phone, '0551234567');
  assert.equal(charge.network, 'mtn');
  assert.equal(charge.email, 'patient@example.com');
  assert.equal(charge.amount, 10000, 'the charge must be sent in the minor currency unit');
  assert.equal(charge.currency, 'NGN');

  // The patient has not entered their PIN yet, so the money has not moved.
  // This is the assertion the whole feature rests on: a pending charge must
  // not make the hospital believe it is paid.
  const midway = await request(app)
    .get(`/api/billing/${bill.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(midway.body.paid_amount, 0);
  assert.equal(midway.body.payment_status, 'pending');
  const pendingRow = midway.body.payments.find(p => p.payment_number === initiated.body.payment.payment_number);
  assert.equal(pendingRow.status, 'pending');

  // The customer approves on their handset; the provider says so.
  settleMockCharge(initiated.body.payment.payment_number, { success: true });
  const settled = await signedWebhook({
    event: 'charge.success',
    data: { reference: initiated.body.payment.payment_number, status: 'success', amount: 10000, currency: 'NGN' },
  }).expect(200);
  assert.equal(settled.body.handled, true);
  assert.equal(settled.body.status, 'completed');

  const afterWebhook = await request(app)
    .get(`/api/billing/${bill.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(afterWebhook.body.paid_amount, 100);
  assert.equal(afterWebhook.body.payment_status, 'paid');
  const settledRow = afterWebhook.body.payments.find(p => p.payment_number === initiated.body.payment.payment_number);
  assert.equal(settledRow.status, 'completed');
  assert.ok(settledRow.completed_at, 'a settled charge must record when it completed');
  assert.equal(settledRow.failure_reason, null);
});

test('a redelivered mobile money webhook does not double count the payment', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 50);
  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0271234567', network: 'atl', email: 'patient@example.com' })
    .expect(202);
  const reference = initiated.body.payment.payment_number;

  settleMockCharge(reference, { success: true });
  const payload = { event: 'charge.success', data: { reference, status: 'success', amount: 5000, currency: 'NGN' } };
  await signedWebhook(payload).expect(200);
  // Providers retry until they get a 2xx, so the same delivery will arrive again.
  const replay = await signedWebhook(payload).expect(200);
  assert.equal(replay.body.replay, true);

  const afterReplay = await request(app)
    .get(`/api/billing/${bill.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(afterReplay.body.paid_amount, 50, 'a replayed webhook must not add a second payment');
  assert.equal(afterReplay.body.payment_status, 'paid');
});

test('a declined mobile money charge leaves the bill unpaid and records why', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 75);
  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0771234567', network: 'vod', email: 'patient@example.com' })
    .expect(202);
  const reference = initiated.body.payment.payment_number;

  settleMockCharge(reference, { success: false, reason: 'Insufficient balance' });
  // Staff notice the prompt was declined and ask the provider directly.
  const synced = await request(app)
    .get(`/api/billing/mobile-money/payments/${initiated.body.payment.id}?sync=1`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(synced.body.payment.status, 'failed');
  assert.equal(synced.body.synced, true);

  const afterFailure = await request(app)
    .get(`/api/billing/${bill.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(afterFailure.body.paid_amount, 0, 'a failed charge must not settle the bill');
  assert.equal(afterFailure.body.payment_status, 'pending');
  const failedRow = afterFailure.body.payments.find(p => p.payment_number === reference);
  assert.equal(failedRow.failure_reason, 'Insufficient balance');

  // Having failed, the balance is still fully outstanding and still chargeable.
  const retry = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0771234567', network: 'vod', email: 'patient@example.com' })
    .expect(202);
  assert.equal(retry.body.payment.status, 'pending');
});

test('mobile money rejects partial amounts, unknown networks, and duplicate in-flight requests', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 120);

  await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 50, phone: '0551234567', network: 'mtn', email: 'patient@example.com' })
    .expect(400);
  await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0551234567', network: 'paypal', email: 'patient@example.com' })
    .expect(400);
  await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: 'abc', network: 'mtn', email: 'patient@example.com' })
    .expect(400);
  await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0551234567', network: 'mtn', email: 'not-an-email' })
    .expect(400);

  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0551234567', network: 'mtn', email: 'patient@example.com' })
    .expect(202);
  // A second tap would send a second prompt for a balance already in flight,
  // which a patient approving twice would turn into an overpayment.
  await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0551234567', network: 'mtn', email: 'patient@example.com' })
    .expect(409);

  // Cancelling frees the balance up again.
  const cancelled = await request(app)
    .post(`/api/billing/mobile-money/payments/${initiated.body.payment.id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(cancelled.body.payment.status, 'cancelled');
  await request(app)
    .post(`/api/billing/mobile-money/payments/${initiated.body.payment.id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .expect(409);
  await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0551234567', network: 'mtn', email: 'patient@example.com' })
    .expect(202);
});

test('a signed callback reporting a different amount does not settle the bill', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 50);
  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0271234567', network: 'atl', email: 'patient@example.com' })
    .expect(202);
  const reference = initiated.body.payment.payment_number;

  // 1.00 instead of 50.00, correctly signed. The signature proves the sender is
  // the provider; it says nothing about whether this is the amount that was asked
  // for, so the charge must not close on it.
  settleMockCharge(reference, { success: true });
  const underpaid = await signedWebhook({
    event: 'charge.success',
    data: { reference, status: 'success', amount: 100, currency: 'NGN' },
  }).expect(200);
  assert.equal(underpaid.body.status, 'failed', 'a mismatched amount must not be treated as paid');

  const after = await request(app)
    .get(`/api/billing/${bill.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(after.body.paid_amount, 0, 'the bill must stay unpaid');
  assert.equal(after.body.payment_status, 'pending');

  const [paymentRows] = await pool.query(
    'SELECT status, failure_reason FROM payments WHERE transaction_reference = ?',
    [reference]
  );
  assert.equal(paymentRows[0].status, 'failed');
  assert.match(paymentRows[0].failure_reason, /settlement rejected.*amount|reported .* but .* was requested/i);
});

test('a signed callback in the wrong currency does not settle the bill', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 40);
  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0271234567', network: 'atl', email: 'patient@example.com' })
    .expect(202);
  const reference = initiated.body.payment.payment_number;

  settleMockCharge(reference, { success: true });
  const wrongCurrency = await signedWebhook({
    event: 'charge.success',
    data: { reference, status: 'success', amount: 4000, currency: 'GHS' },
  }).expect(200);
  assert.equal(wrongCurrency.body.status, 'failed');

  const after = await request(app)
    .get(`/api/billing/${bill.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(after.body.paid_amount, 0);
  assert.equal(after.body.payment_status, 'pending');
});

test('mobile money webhooks without a valid signature are refused', async () => {
  const payload = JSON.stringify({
    event: 'charge.success',
    data: { reference: 'PAY-NOT-REAL', status: 'success', amount: 100, currency: 'NGN' },
  });
  await request(app)
    .post('/api/billing/mobile-money/webhook')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', 'deadbeef')
    .send(payload)
    .expect(401);
  await request(app)
    .post('/api/billing/mobile-money/webhook')
    .set('Content-Type', 'application/json')
    .send(payload)
    .expect(401);
  // A correctly signed callback for a reference this hospital never issued is
  // acknowledged so the provider stops retrying, but settles nothing.
  const unknown = await signedWebhook(JSON.parse(payload)).expect(200);
  assert.equal(unknown.body.handled, false);
  assert.equal(unknown.body.reason, 'unknown reference');
});

test('a pending mobile money charge cannot be refunded', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 30);
  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0271234567', network: 'atl', email: 'patient@example.com' })
    .expect(202);
  const response = await request(app)
    .post(`/api/billing/payments/${initiated.body.payment.id}/refund`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'Attempting to refund an unapproved charge' })
    .expect(409);
  assert.match(response.body.message, /nothing to refund/i);
});

test('a settled mobile money charge is refundable like any other payment', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 40);
  const initiated = await request(app)
    .post(`/api/billing/${bill.id}/mobile-money`)
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '0551234567', network: 'vod', email: 'patient@example.com' })
    .expect(202);
  const reference = initiated.body.payment.payment_number;
  settleMockCharge(reference, { success: true });
  await signedWebhook({ event: 'charge.success', data: { reference, status: 'success', amount: 4000, currency: 'NGN' } }).expect(200);

  // The default refund method follows the money back out the way it came in.
  const refund = await request(app)
    .post(`/api/billing/payments/${initiated.body.payment.id}/refund`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'Service not rendered' })
    .expect(201);
  assert.equal(refund.body.refund.payment_method, 'mobile_money');
  assert.equal(refund.body.bill.paid_amount, 0);
  assert.equal(refund.body.bill.payment_status, 'pending');
});

test('a patient can start and track a mobile money payment from the portal', async () => {
  const adminToken = await login();
  const unique = `portal-mm-${Date.now()}@example.com`;
  const created = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Portal',
      last_name: 'MobileMoney',
      date_of_birth: '1988-07-07',
      gender: 'male',
      email: unique,
      phone: '0551234567',
    })
    .expect(201);
  const patientId = created.body.patient.id;
  const bill = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patientId,
      items: [{ description: 'Portal mobile money', category: 'other', quantity: 1, unit_price: 60 }],
      tax: 0,
    })
    .expect(201);

  const portalLogin = await request(app)
    .post('/api/portal/login')
    .send({ identifier: unique, portal_pin: created.body.plain_pin })
    .expect(200);
  const auth = { Authorization: `Bearer ${portalLogin.body.token}` };

  // A request without a phone number cannot be sent, and is not a 500.
  await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set(auth)
    .send({ payment_method: 'mobile_money', network: 'mtn', request_id: 'portal-mm-missing-phone' })
    .expect(400);

  const requestId = `portal-mm-${Date.now()}`;
  const initiated = await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set(auth)
    .send({ payment_method: 'mobile_money', phone: '0551234567', network: 'mtn', request_id: requestId })
    .expect(202);
  assert.equal(initiated.body.replay, false);
  assert.equal(initiated.body.status, 'pending');
  assert.equal(initiated.body.amount, 60);
  assert.equal(initiated.body.balance_remaining, 60, 'the bill is not settled until the customer approves');

  // Resubmitting the same request id returns the charge in flight rather than
  // opening a second one.
  const resubmit = await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set(auth)
    .send({ payment_method: 'mobile_money', phone: '0551234567', network: 'mtn', request_id: requestId })
    .expect(200);
  assert.equal(resubmit.body.replay, true);

  const [pendingRows] = await pool.query(
    'SELECT transaction_reference, status FROM payments WHERE transaction_reference = ?',
    [`portal-mm:${requestId}`]
  );
  assert.equal(pendingRows.length, 1, 'the resubmitted request must not have opened a second charge');
  assert.equal(pendingRows[0].status, 'pending');

  settleMockCharge(`portal-mm:${requestId}`, { success: true });
  const status = await request(app)
    .get(`/api/portal/bills/${bill.body.id}/mobile-money/${initiated.body.payment_id}?sync=1`)
    .set(auth)
    .expect(200);
  assert.equal(status.body.status, 'completed');
  assert.equal(status.body.synced, true);

  const bills = await request(app).get('/api/portal/bills').set(auth).expect(200);
  const settledBill = bills.body.bills.find(row => row.id === bill.body.id);
  assert.equal(settledBill.paid_amount, 60);
  assert.equal(settledBill.payment_status, 'paid');

  // A charge belonging to another bill must not be readable through this one.
  const otherBill = await createBillWithBalance(adminToken, 10, patientId);
  await request(app)
    .get(`/api/portal/bills/${otherBill.id}/mobile-money/${initiated.body.payment_id}`)
    .set(auth)
    .expect(404);
});

test('mobile money is unavailable unless a provider is configured, and never mocked in production', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 20);
  const charge = { phone: '0551234567', network: 'mtn', email: 'patient@example.com' };

  const enabled = process.env.MOBILE_MONEY_ENABLED;
  const mock = process.env.MOBILE_MONEY_MOCK;
  const nodeEnv = process.env.NODE_ENV;
  try {
    // Switched off: the form is not advertised and the endpoint refuses.
    delete process.env.MOBILE_MONEY_ENABLED;
    const config = await request(app)
      .get('/api/billing/mobile-money/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(config.body.enabled, false);
    assert.deepEqual(config.body.networks, []);

    await request(app)
      .post(`/api/billing/${bill.id}/mobile-money`)
      .set('Authorization', `Bearer ${token}`)
      .send(charge)
      .expect(503);
    // A disabled rail must not have left a pending charge behind.
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM payments WHERE bill_id = ?', [bill.id]);
    assert.equal(rows[0].count, 0);

    // Mocking is a development affordance. In production it is refused even
    // when it is explicitly selected, because a simulated charge that settles
    // a real bill is a revenue hole rather than a feature.
    process.env.MOBILE_MONEY_ENABLED = 'true';
    process.env.MOBILE_MONEY_MOCK = 'true';
    process.env.NODE_ENV = 'production';
    const productionConfig = await request(app)
      .get('/api/billing/mobile-money/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(productionConfig.body.enabled, false);
    await request(app)
      .post(`/api/billing/${bill.id}/mobile-money`)
      .set('Authorization', `Bearer ${token}`)
      .send(charge)
      .expect(503);
  } finally {
    process.env.NODE_ENV = nodeEnv;
    if (enabled === undefined) delete process.env.MOBILE_MONEY_ENABLED;
    else process.env.MOBILE_MONEY_ENABLED = enabled;
    if (mock === undefined) delete process.env.MOBILE_MONEY_MOCK;
    else process.env.MOBILE_MONEY_MOCK = mock;
  }
});

test('only networks the configured market can actually charge are offered', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 45);
  const key = process.env.PAYSTACK_SECRET_KEY;
  const currency = process.env.PAYSTACK_CURRENCY;
  const enabled = process.env.MOBILE_MONEY_ENABLED;
  const mock = process.env.MOBILE_MONEY_MOCK;
  const nodeEnv = process.env.NODE_ENV;
  try {
    // Real provider, no mock, so the market drives the network list.
    process.env.NODE_ENV = 'production';
    process.env.MOBILE_MONEY_ENABLED = 'true';
    process.env.MOBILE_MONEY_MOCK = 'false';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake_key_for_coverage_checks';

    // Ghana: MTN, AirtelTigo and Telecel are the documented chargeable codes.
    process.env.PAYSTACK_CURRENCY = 'GHS';
    const ghana = await request(app)
      .get('/api/billing/mobile-money/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(ghana.body.enabled, true);
    assert.equal(ghana.body.market, 'ghana');
    assert.deepEqual(ghana.body.networks.map(n => n.value), ['mtn', 'atl', 'vod']);
    assert.equal(ghana.body.reason, null);

    // The market follows the currency, so a deployment only has to set the
    // currency it already bills in.
    process.env.PAYSTACK_CURRENCY = 'KES';
    const kenya = await request(app)
      .get('/api/billing/mobile-money/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(kenya.body.market, 'kenya');
    assert.deepEqual(kenya.body.networks.map(n => n.value), ['mpesa', 'atl']);

    // Rwanda: Paystack is licensed there but does not sell the mobile money
    // channel, so the rail must stay off and say so rather than advertising
    // MTN or Airtel and failing on the first real charge.
    process.env.PAYSTACK_CURRENCY = 'RWF';
    const rwanda = await request(app)
      .get('/api/billing/mobile-money/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(rwanda.body.enabled, false);
    assert.deepEqual(rwanda.body.networks, []);
    assert.match(rwanda.body.reason, /does not offer the mobile money channel in rwanda/i);

    const refused = await request(app)
      .post(`/api/billing/${bill.id}/mobile-money`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '0781234567', network: 'mtn', email: 'patient@example.com' })
      .expect(503);
    assert.match(refused.body.message, /mobile money channel in rwanda/i);
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM payments WHERE bill_id = ?', [bill.id]);
    assert.equal(rows[0].count, 0, 'a refused charge must not leave a pending row behind');

    // A currency Paystack has no mobile money market for is a configuration
    // error, and is reported as one instead of silently offering nothing.
    process.env.PAYSTACK_CURRENCY = 'ZAR';
    const unknown = await request(app)
      .get('/api/billing/mobile-money/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(unknown.body.enabled, false);
    assert.match(unknown.body.reason, /not recognised/i);
  } finally {
    process.env.NODE_ENV = nodeEnv;
    if (key === undefined) delete process.env.PAYSTACK_SECRET_KEY; else process.env.PAYSTACK_SECRET_KEY = key;
    if (currency === undefined) delete process.env.PAYSTACK_CURRENCY; else process.env.PAYSTACK_CURRENCY = currency;
    if (enabled === undefined) delete process.env.MOBILE_MONEY_ENABLED; else process.env.MOBILE_MONEY_ENABLED = enabled;
    if (mock === undefined) delete process.env.MOBILE_MONEY_MOCK; else process.env.MOBILE_MONEY_MOCK = mock;
  }
});

test('Rwandan networks can be exercised locally, and the override cannot ship', async () => {
  const token = await login();
  const currency = process.env.PAYSTACK_CURRENCY;
  const key = process.env.PAYSTACK_SECRET_KEY;
  const enabled = process.env.MOBILE_MONEY_ENABLED;
  const mock = process.env.MOBILE_MONEY_MOCK;
  const nodeEnv = process.env.NODE_ENV;
  const config = () => request(app)
    .get('/api/billing/mobile-money/config')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  try {
    process.env.MOBILE_MONEY_ENABLED = 'true';
    process.env.MOBILE_MONEY_MOCK = 'false';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake_key_for_coverage_checks';
    process.env.PAYSTACK_CURRENCY = 'RWF';

    // Outside production the operator can opt in, and MTN MoMo and Airtel Money
    // are the networks a Rwandan build needs to see.
    process.env.NODE_ENV = 'development';
    process.env.PAYSTACK_ALLOW_UNSUPPORTED_MARKET = 'true';
    const local = await config();
    assert.equal(local.body.enabled, true);
    assert.equal(local.body.market, 'rwanda');
    assert.equal(local.body.currency, 'RWF');
    assert.deepEqual(local.body.networks.map(n => n.value), ['mtn', 'atl']);
    assert.match(local.body.networks[0].label, /MTN MoMo/);
    assert.match(local.body.networks[1].label, /Airtel Money/);

    // The same flag in production is refused, exactly like the mock. This is the
    // whole point: a Rwandan build must not be able to advertise a channel that
    // cannot take the money.
    process.env.NODE_ENV = 'production';
    const production = await config();
    assert.equal(production.body.enabled, false);
    assert.deepEqual(production.body.networks, []);
    assert.match(production.body.reason, /does not offer the mobile money channel in rwanda/i);

    // And with the flag off entirely, the default is still off.
    delete process.env.PAYSTACK_ALLOW_UNSUPPORTED_MARKET;
    const off = await config();
    assert.equal(off.body.enabled, false);
    assert.deepEqual(off.body.networks, []);
  } finally {
    process.env.NODE_ENV = nodeEnv;
    delete process.env.PAYSTACK_ALLOW_UNSUPPORTED_MARKET;
    if (key === undefined) delete process.env.PAYSTACK_SECRET_KEY; else process.env.PAYSTACK_SECRET_KEY = key;
    if (currency === undefined) delete process.env.PAYSTACK_CURRENCY; else process.env.PAYSTACK_CURRENCY = currency;
    if (enabled === undefined) delete process.env.MOBILE_MONEY_ENABLED; else process.env.MOBILE_MONEY_ENABLED = enabled;
    if (mock === undefined) delete process.env.MOBILE_MONEY_MOCK; else process.env.MOBILE_MONEY_MOCK = mock;
  }
});

test('selecting a provider this build has no adapter for is reported, not silently ignored', async () => {
  const token = await login();
  const provider = process.env.MOBILE_MONEY_PROVIDER;
  try {
    // Mukuru is the provider a Rwandan deployment needs, but no adapter is
    // built for it yet. The configuration must say so plainly rather than
    // looking like a missing key, so nobody ships believing the rail works.
    process.env.MOBILE_MONEY_PROVIDER = 'mukuru';
    const config = await request(app)
      .get('/api/billing/mobile-money/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(config.body.enabled, false);
    assert.match(config.body.reason, /"mukuru" is not a provider this build can use/i);
  } finally {
    if (provider === undefined) delete process.env.MOBILE_MONEY_PROVIDER;
    else process.env.MOBILE_MONEY_PROVIDER = provider;
  }
});

test('assisted mobile money is recorded from a confirmation code, with no provider needed', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 90);

  // The confirmation code is the only evidence the money moved, so it is not
  // optional. Without it a reception slip would look identical to a patient
  // who simply never paid.
  const missingCode = await request(app)
    .post(`/api/billing/${bill.id}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 90, payment_method: 'mobile_money' })
    .expect(400);
  assert.match(missingCode.body.message, /confirmation code is required/i);
  await request(app)
    .post(`/api/billing/${bill.id}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 90, payment_method: 'mobile_money', transaction_reference: 'MP' })
    .expect(400);

  // A partial transfer is allowed, exactly like any other payment method.
  const partial = await request(app)
    .post(`/api/billing/${bill.id}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 40, payment_method: 'mobile_money', transaction_reference: 'MP260716.1234.A45678' })
    .expect(201);
  assert.equal(partial.body.bill.payment_status, 'partial');
  assert.equal(partial.body.bill.paid_amount, 40);

  // Settled on the spot, because reception has already seen the money.
  const detail = await request(app)
    .get(`/api/billing/${bill.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const recorded = detail.body.payments.find(p => p.transaction_reference === 'MP260716.1234.A45678');
  assert.equal(recorded.status, 'completed');
  assert.match(recorded.notes, /assisted mobile money/i);
  assert.ok(recorded.completed_at, 'an assisted payment records when it was taken');
  assert.equal(recorded.provider, null, 'an assisted payment has no provider behind it');

  const settled = await request(app)
    .post(`/api/billing/${bill.id}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 50, payment_method: 'mobile_money', transaction_reference: 'MP260716.9999.B11111' })
    .expect(201);
  assert.equal(settled.body.bill.payment_status, 'paid');

  // It is auditable as a distinct action, so a disputed payment is traceable
  // to the member of staff who entered it.
  const [auditRows] = await pool.query(
    "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'billing.mobile_money.assisted'"
  );
  assert.ok(auditRows[0].count >= 2, 'assisted payments must be recorded under their own audit action');
});

test('assisted mobile money still works when the automated rail is switched off', async () => {
  const token = await login();
  const bill = await createBillWithBalance(token, 15);
  const enabled = process.env.MOBILE_MONEY_ENABLED;
  try {
    // Recording a transfer the patient already made needs no provider, so the
    // feature switch must not break the way hospitals take MoMo today. Only the
    // automated request flow depends on a provider being configured.
    delete process.env.MOBILE_MONEY_ENABLED;
    const recorded = await request(app)
      .post(`/api/billing/${bill.id}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 15, payment_method: 'mobile_money', transaction_reference: 'MP260716.5555.C22222' })
      .expect(201);
    assert.equal(recorded.body.bill.payment_status, 'paid');
  } finally {
    if (enabled === undefined) delete process.env.MOBILE_MONEY_ENABLED;
    else process.env.MOBILE_MONEY_ENABLED = enabled;
  }
});

test('portal payments are idempotent and PIN resets revoke existing sessions', async () => {
  const adminToken = await login();
  const unique = `${Date.now()}@example.com`;
  const createdPatient = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Portal',
      last_name: 'Tester',
      date_of_birth: '1990-01-01',
      gender: 'other',
      email: unique,
    })
    .expect(201);
  const bill = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: createdPatient.body.patient.id,
      items: [{ description: 'Portal test', category: 'other', quantity: 1, unit_price: 25 }],
      tax: 0,
      payment_method: 'cash',
    })
    .expect(201);

  assert.equal(createdPatient.body.patient.portal_pin_provisioned, true);
  const originalPortalPin = createdPatient.body.plain_pin;
  const portalLogin = await request(app)
    .post('/api/portal/login')
    .send({ identifier: unique, portal_pin: originalPortalPin })
    .expect(200);

  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'staging';
    const unavailable = await request(app)
      .post(`/api/portal/bills/${bill.body.id}/pay`)
      .set('Authorization', `Bearer ${portalLogin.body.token}`)
      .send({ amount: 1, payment_method: 'card', request_id: 'staging-payment-test' })
      .expect(503);
    assert.match(unavailable.body.message, /not enabled/i);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }

  await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 0, payment_method: 'card', request_id: 'zero-payment-test' })
    .expect(400);
  await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 1, payment_method: 'card', request_id: '   ' })
    .expect(400);
  const missingRequestId = await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 1, payment_method: 'card' })
    .expect(400);
  assert.match(missingRequestId.body.message, /request_id is required/i);

  const paymentRequestId = `portal-payment-${Date.now()}`;
  const payment = await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 5, payment_method: 'card', request_id: paymentRequestId })
    .expect(200);
  assert.equal(payment.body.replay, false);
  const replay = await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 5, payment_method: 'card', request_id: paymentRequestId })
    .expect(200);
  assert.equal(replay.body.replay, true);
  await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 6, payment_method: 'card', request_id: paymentRequestId })
    .expect(409);
  await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 5, payment_method: 'cash', request_id: paymentRequestId })
    .expect(409);
  const [storedPayments] = await pool.query(
    'SELECT COUNT(*) AS count FROM payments WHERE transaction_reference = ?',
    [`portal:${paymentRequestId}`]
  );
  assert.equal(storedPayments[0].count, 1);

  const secondBill = await request(app)
    .post('/api/billing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: createdPatient.body.patient.id,
      items: [{ description: 'Second portal test', category: 'other', quantity: 1, unit_price: 25 }],
      tax: 0,
      payment_method: 'cash',
    })
    .expect(201);
  await request(app)
    .post(`/api/portal/bills/${secondBill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 1, payment_method: 'card', request_id: paymentRequestId })
    .expect(409);

  const resetPin = await request(app)
    .post(`/api/patients/${createdPatient.body.patient.id}/portal-pin`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.match(resetPin.body.plain_pin, /^\d{6}$/);
  const revokedSession = await request(app)
    .get('/api/portal/me')
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .expect(401);
  assert.match(revokedSession.body.message, /revoked/i);
  await request(app)
    .post('/api/portal/login')
    .send({ identifier: unique, portal_pin: originalPortalPin })
    .expect(401);
  const renewedPortalLogin = await request(app)
    .post('/api/portal/login')
    .send({ identifier: unique, portal_pin: resetPin.body.plain_pin })
    .expect(200);
  await request(app)
    .get('/api/portal/me')
    .set('Authorization', `Bearer ${renewedPortalLogin.body.token}`)
    .expect(200);
});

test('appointment completion attributes the record to the treating doctor', async () => {
  const adminToken = await login();
  const doctorToken = await login('doctor@hospital.com');
  const [patients] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 1");
  const [doctorRows] = await pool.query("SELECT id FROM users WHERE email = 'doctor@hospital.com'");
  const patient = patients[0];
  const doctor = doctorRows[0];
  const [appointment] = await pool.query(
    `INSERT INTO appointments
     (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, type, status, reason)
     VALUES (?, ?, ?, ?, '2099-01-01', '12:34:00', 'consultation', 'scheduled', 'Attribution test')`,
    [randomUUID(), `APT-ATTRIBUTION-${Date.now()}`, patient.id, doctor.id]
  );
  const created = await request(app)
    .post('/api/emr')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      patient_id: patient.id,
      appointment_id: appointment.insertId,
      chief_complaint: 'Administrative encounter documentation',
      diagnosis: 'Attribution test',
    })
    .expect(201);
  assert.equal(created.body.doctor_id, doctor.id);
  assert.equal(created.body.appointment_id, appointment.insertId);

  await request(app)
    .get(`/api/emr/${created.body.id}`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .expect(200);
  const [completed] = await pool.query('SELECT status FROM appointments WHERE id = ?', [appointment.insertId]);
  assert.equal(completed[0].status, 'completed');
});

test('fully dispensed prescriptions are excluded from current-medication safety checks', async () => {
  const [patients] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 1");
  const [doctorRows] = await pool.query("SELECT id FROM users WHERE role = 'doctor' ORDER BY id LIMIT 1");
  const [medicines] = await pool.query("SELECT id, name FROM medicines WHERE name IN ('Warfarin 5mg', 'Aspirin 81mg')");
  const patient = patients[0];
  const doctor = doctorRows[0];
  const warfarin = medicines.find(medicine => medicine.name === 'Warfarin 5mg');
  const aspirin = medicines.find(medicine => medicine.name === 'Aspirin 81mg');
  assert.ok(warfarin && aspirin, 'fixture should contain interaction medicines');

  const [prescription] = await pool.query(
    `INSERT INTO prescriptions (uuid, prescription_number, patient_id, doctor_id, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [randomUUID(), `RX-SAFETY-${Date.now()}`, patient.id, doctor.id]
  );
  await pool.query(
    `INSERT INTO prescription_items
     (prescription_id, medicine_id, dosage, frequency, quantity, dispensed_quantity, dispensed, dispensed_date)
     VALUES (?, ?, '5mg', 'Once daily', 1, 1, 1, datetime('now'))`,
    [prescription.insertId, warfarin.id]
  );

  try {
    const safety = await evaluateSafety(patient.id, [aspirin.id]);
    assert.equal(
      safety.warnings.some(warning => [warning.medicine_a, warning.medicine_b].includes(warfarin.name)),
      false
    );
  } finally {
    await pool.query('DELETE FROM prescriptions WHERE id = ?', [prescription.insertId]);
  }
});

test('pharmacy dispensing validates and scopes idempotency keys', async () => {
  const token = await login('pharmacist@hospital.com');
  const before = await request(app)
    .get('/api/prescriptions/pending-items')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const item = before.body.items.find(candidate => candidate.quantity_remaining > 1);
  assert.ok(item, 'fixture should contain a multi-unit prescription item');

  const [sourceItems] = await pool.query(
    `SELECT pi.*, pr.patient_id, pr.doctor_id
     FROM prescription_items pi
     JOIN prescriptions pr ON pr.id = pi.prescription_id
     WHERE pi.id = ?`,
    [item.id]
  );
  const source = sourceItems[0];
  const [createdPrescription] = await pool.query(
    `INSERT INTO prescriptions (uuid, prescription_number, patient_id, doctor_id, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [randomUUID(), `RX-IDEMPOTENCY-${Date.now()}`, source.patient_id, source.doctor_id]
  );
  const [conflictingItem] = await pool.query(
    `INSERT INTO prescription_items
     (prescription_id, medicine_id, dosage, frequency, quantity, instructions)
     VALUES (?, ?, ?, ?, 2, 'Take as directed')`,
    [
      createdPrescription.insertId,
      source.medicine_id,
      source.dosage,
      source.frequency,
    ]
  );

  const requestId = `test-dispense-${Date.now()}`;
  const missingRequestId = await request(app)
    .post('/api/pharmacy/dispense')
    .set('Authorization', `Bearer ${token}`)
    .send({ prescription_item_id: item.id, quantity: 1 })
    .expect(400);
  assert.match(missingRequestId.body.message, /request_id is required/i);
  await request(app)
    .post('/api/pharmacy/dispense')
    .set('Authorization', `Bearer ${token}`)
    .send({ prescription_item_id: item.id, quantity: 1, request_id: '   ' })
    .expect(400);
  const invalidType = await request(app)
    .post('/api/pharmacy/dispense')
    .set('Authorization', `Bearer ${token}`)
    .send({ prescription_item_id: item.id, quantity: 1, request_id: 123 })
    .expect(400);
  assert.match(invalidType.body.message, /request_id must be a string/i);
  await request(app)
    .post('/api/pharmacy/dispense')
    .set('Authorization', `Bearer ${token}`)
    .send({ prescription_item_id: item.id, quantity: 1, request_id: requestId })
    .expect(200);

  const [updated] = await pool.query(
    'SELECT quantity, dispensed_quantity FROM prescription_items WHERE id = ?',
    [item.id]
  );
  assert.equal(updated[0].dispensed_quantity, 1);
  assert.equal(updated[0].quantity - updated[0].dispensed_quantity, item.quantity_remaining - 1);

  const conflict = await request(app)
    .post('/api/pharmacy/dispense')
    .set('Authorization', `Bearer ${token}`)
    .send({ prescription_item_id: conflictingItem.insertId, quantity: 1, request_id: requestId })
    .expect(409);
  assert.match(conflict.body.message, /already been used/i);
  const [unchangedConflict] = await pool.query(
    'SELECT dispensed_quantity FROM prescription_items WHERE id = ?',
    [conflictingItem.insertId]
  );
  assert.equal(unchangedConflict[0].dispensed_quantity, 0);

  const replay = await request(app)
    .post('/api/pharmacy/dispense')
    .set('Authorization', `Bearer ${token}`)
    .send({ prescription_item_id: item.id, quantity: 1, request_id: requestId })
    .expect(200);
  assert.equal(replay.body.replay, true);
  const [afterReplay] = await pool.query(
    'SELECT dispensed_quantity FROM prescription_items WHERE id = ?',
    [item.id]
  );
  assert.equal(afterReplay[0].dispensed_quantity, 1);
});

// ---------------------------------------------------------------------------
// Public patient check-in
//
// An MRN, access code, phone number or printed QR code is a public identifier,
// so none of them may act as a credential. These cases lock in the replacement
// flows: a staff-issued single-use token, a signed-in portal session, and the
// authenticated reception route.
// ---------------------------------------------------------------------------

async function createCheckinPatient(adminToken, label) {
  const response = await request(app)
    .post('/api/patients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: label,
      last_name: 'Checkin',
      date_of_birth: '1990-04-05',
      gender: 'female',
      email: `checkin-${label.toLowerCase()}-${randomUUID()}@example.com`,
    })
    .expect(201);
  // Each case registers several patients; hand the shared write budget back so
  // the records created here do not throttle the case's real assertions.
  rateLimit.clearAll();
  return { patient: response.body.patient, plainPin: response.body.plain_pin };
}

function issueCheckinToken(adminToken, patientId, body = {}) {
  return request(app)
    .post('/api/portal/checkin-tokens')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ patient_id: patientId, ...body });
}

test('public check-in refuses a bare patient identifier', async () => {
  clearPortalRateLimits();
  const adminToken = await login();
  const { patient } = await createCheckinPatient(adminToken, 'Identifier');

  // Every public identifier the old implementation trusted, in every shape it
  // accepted: mrn, 4-digit access code, phone, email, and the raw patient uuid.
  const attempts = [
    { identifier: patient.mrn, purpose: 'routine visit' },
    { identifier: patient.access_code, purpose: 'routine visit' },
    { identifier: patient.email, purpose: 'routine visit' },
    { identifier: patient.uuid, purpose: 'routine visit' },
    { mrn: patient.mrn },
    { access_code: patient.access_code },
    { patient_id: patient.id },
  ];

  for (const body of attempts) {
    const response = await request(app)
      .post('/api/portal/checkin')
      .send(body)
      .expect(401);
    assert.match(response.body.message, /check-in code|portal session/i);
    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, new RegExp(patient.mrn));
    assert.doesNotMatch(serialized, /Checkin|identifier|access code/i);
  }

  const [rows] = await pool.query('SELECT id FROM checkins WHERE patient_id = ?', [patient.id]);
  assert.equal(rows.length, 0, 'no check-in may be created without a credential');
  clearPortalRateLimits();
});

test('a staff-issued single-use token authorises check-in without leaking patient data', async () => {
  clearPortalRateLimits();
  const adminToken = await login();
  const { patient } = await createCheckinPatient(adminToken, 'Kiosk');

  const issued = await issueCheckinToken(adminToken, patient.id, { ttl_minutes: 15 }).expect(201);
  assert.equal(issued.body.success, true);
  assert.ok(issued.body.token.length >= 40, 'the token must carry at least 256 bits of entropy');
  assert.equal(issued.body.expires_in_seconds, 900);

  const [stored] = await pool.query('SELECT token_hash, used_at FROM checkin_tokens WHERE id = ?', [issued.body.id]);
  assert.match(stored[0].token_hash, /^[0-9a-f]{64}$/, 'only the sha256 hash may be stored');
  assert.notEqual(stored[0].token_hash, issued.body.token);
  assert.equal(stored[0].used_at, null);

  const response = await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: issued.body.token, purpose: 'routine visit' })
    .expect(200);

  assert.equal(response.body.checked_in, true);
  assert.equal(response.body.success, true);
  assert.equal(response.body.status, 'waiting');
  assert.deepEqual(Object.keys(response.body).sort(), [
    'checked_in', 'message', 'queue_position', 'status', 'success',
  ]);
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /Kiosk|Checkin|date_of_birth|mrn|appointment|routine visit/i
  );

  const [used] = await pool.query('SELECT used_at FROM checkin_tokens WHERE id = ?', [issued.body.id]);
  assert.ok(used[0].used_at, 'the token must be consumed');

  const [checkins] = await pool.query(
    "SELECT id, qr_token FROM checkins WHERE patient_id = ? AND checkin_date = date('now')",
    [patient.id]
  );
  assert.equal(checkins.length, 1);
  assert.notEqual(checkins[0].qr_token, issued.body.token, 'the plaintext token must never be stored on the check-in');

  const [audits] = await pool.query(
    "SELECT actor_type, summary FROM audit_log WHERE action = 'patient_checkin' AND record_id = ?",
    [checkins[0].id]
  );
  assert.equal(audits.length, 1, 'the check-in must be audited');
  assert.equal(audits[0].actor_type, 'anonymous', 'a kiosk is not a signed-in patient');

  // Replay of the same token is refused and creates nothing new.
  const replay = await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: issued.body.token })
    .expect(409);
  assert.match(replay.body.message, /already been used/i);
  const [afterReplay] = await pool.query('SELECT COUNT(*) AS count FROM checkins WHERE patient_id = ?', [patient.id]);
  assert.equal(Number(afterReplay[0].count), 1);
  clearPortalRateLimits();
});

test('expired, revoked and unknown check-in tokens are rejected with generic errors', async () => {
  clearPortalRateLimits();
  const adminToken = await login();
  const { patient } = await createCheckinPatient(adminToken, 'Expired');

  const expiredPlain = generateCheckinToken();
  await pool.query(
    'INSERT INTO checkin_tokens (patient_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [patient.id, expiredPlain.hash, new Date(Date.now() - 60_000).toISOString()]
  );
  const expired = await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: expiredPlain.token })
    .expect(410);
  assert.match(expired.body.message, /expired/i);

  const revokedPlain = generateCheckinToken();
  await pool.query(
    'INSERT INTO checkin_tokens (patient_id, token_hash, expires_at, revoked_at) VALUES (?, ?, ?, ?)',
    [patient.id, revokedPlain.hash, expiryFor(30), new Date().toISOString()]
  );
  const revoked = await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: revokedPlain.token })
    .expect(401);
  assert.doesNotMatch(JSON.stringify(revoked.body), new RegExp(patient.mrn));

  const unknown = await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: generateCheckinToken().token })
    .expect(401);
  assert.match(unknown.body.message, /not valid/i);
  assert.doesNotMatch(JSON.stringify(unknown.body), /not found|does not exist/i);

  // The HMS: prefix envelope used by the printed QR code is accepted, but a
  // malformed or oversized value is still just "not valid".
  await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: `HMS:CHECKIN:${generateCheckinToken().token}` })
    .expect(401);
  await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: 'x'.repeat(4096) })
    .expect(401);

  const [rows] = await pool.query('SELECT id FROM checkins WHERE patient_id = ?', [patient.id]);
  assert.equal(rows.length, 0, 'no rejected attempt may create a check-in');
  clearPortalRateLimits();
});

test('repeated failed check-in attempts are rate limited', async () => {
  clearPortalRateLimits();
  const adminToken = await login();
  const { patient } = await createCheckinPatient(adminToken, 'Guess');

  const statuses = [];
  for (let attempt = 0; attempt < CHECKIN_ATTEMPT_LIMIT + 1; attempt += 1) {
    const response = await request(app)
      .post('/api/portal/checkin')
      .send({ checkin_token: generateCheckinToken().token, identifier: patient.mrn });
    statuses.push(response.status);
    if (response.status === 429) {
      assert.ok(response.headers['retry-after'], 'a 429 must advertise Retry-After');
    }
  }
  assert.ok(statuses.includes(429), `expected a 429 within ${CHECKIN_ATTEMPT_LIMIT + 1} attempts, got ${statuses.join(',')}`);
  assert.equal(statuses.filter(status => status === 429).length, 1);

  // A caller who is being throttled cannot rely on a valid token to slip past
  // the limiter either.
  const issued = await issueCheckinToken(adminToken, patient.id).expect(201);
  await request(app)
    .post('/api/portal/checkin')
    .send({ checkin_token: issued.body.token })
    .expect(429);

  const [rows] = await pool.query('SELECT id FROM checkins WHERE patient_id = ?', [patient.id]);
  assert.equal(rows.length, 0);
  clearPortalRateLimits();
});

test('only clinical and reception staff can mint check-in tokens', async () => {
  clearPortalRateLimits();
  const adminToken = await login();
  const { patient, plainPin } = await createCheckinPatient(adminToken, 'Minter');

  await request(app)
    .post('/api/portal/checkin-tokens')
    .send({ patient_id: patient.id })
    .expect(401);

  const portalLogin = await request(app)
    .post('/api/portal/login')
    .send({ identifier: patient.email, portal_pin: plainPin })
    .expect(200);
  // A portal token is not a staff token: the staff authenticator refuses it
  // outright rather than letting it reach the role check.
  await request(app)
    .post('/api/portal/checkin-tokens')
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ patient_id: patient.id })
    .expect(401);

  // A patient cannot mint a token for a different patient even if they know
  // that patient's id.
  const other = await createCheckinPatient(adminToken, 'Other');
  await request(app)
    .post('/api/portal/checkin-tokens')
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ patient_id: other.patient.id })
    .expect(401);

  await issueCheckinToken(adminToken, patient.id, { ttl_minutes: 0 }).expect(400);
  await issueCheckinToken(adminToken, patient.id, { ttl_minutes: 60 * 48 }).expect(400);
  await issueCheckinToken(adminToken, patient.id, { ttl_minutes: 'ten' }).expect(400);
  await issueCheckinToken(adminToken, 999_999).expect(404);

  await pool.query("UPDATE patients SET status = 'inactive' WHERE id = ?", [other.patient.id]);
  await issueCheckinToken(adminToken, other.patient.id).expect(409);
  await pool.query("UPDATE patients SET status = 'active' WHERE id = ?", [other.patient.id]);

  clearPortalRateLimits();
});

test('a signed-in patient can check themselves in and reception keeps a direct workflow', async () => {
  clearPortalRateLimits();
  const adminToken = await login();
  const { patient, plainPin } = await createCheckinPatient(adminToken, 'Session');

  const portalLogin = await request(app)
    .post('/api/portal/login')
    .send({ identifier: patient.email, portal_pin: plainPin })
    .expect(200);
  const session = await request(app)
    .post('/api/portal/checkin')
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ purpose: 'follow-up' })
    .expect(200);
  assert.equal(session.body.checked_in, true);
  assert.doesNotMatch(JSON.stringify(session.body), /Session|Checkin|mrn|follow-up/i);

  // A portal session belongs to one patient only: a second signed-in patient
  // cannot check the first one in by passing her id.
  const second = await createCheckinPatient(adminToken, 'Second');
  const secondLogin = await request(app)
    .post('/api/portal/login')
    .send({ identifier: second.patient.email, portal_pin: second.plainPin })
    .expect(200);
  await request(app)
    .post('/api/portal/checkin')
    .set('Authorization', `Bearer ${secondLogin.body.token}`)
    .send({ patient_id: patient.id })
    .expect(200);
  const [secondCheckins] = await pool.query(
    "SELECT patient_id FROM checkins WHERE checkin_date = date('now') ORDER BY id DESC LIMIT 1"
  );
  assert.equal(secondCheckins[0].patient_id, second.patient.id, 'the session, not the body, decides who is checked in');

  // Reception's authenticated one-step workflow still works and still returns
  // the record the front desk needs.
  const third = await createCheckinPatient(adminToken, 'Reception');
  const reception = await request(app)
    .post('/api/portal/checkins')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ patient_id: third.patient.id, purpose: 'walk-in' })
    .expect(201);
  assert.equal(reception.body.checkin.patient_id, third.patient.id);
  assert.equal(reception.body.checkin.status, 'waiting');
  assert.equal(typeof reception.body.queue_position, 'number');

  await request(app)
    .post('/api/portal/checkins')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ patient_id: third.patient.id })
    .expect(409);

  await request(app)
    .post('/api/portal/checkins')
    .send({ patient_id: third.patient.id })
    .expect(401);
  clearPortalRateLimits();
});

test('AI appointment schedule uses the configured hospital timezone date', async () => {
  const [patients] = await pool.query("SELECT id FROM patients WHERE status = 'active' ORDER BY id LIMIT 1");
  const [doctors] = await pool.query("SELECT id FROM users WHERE role = 'doctor' AND is_active = 1 ORDER BY id LIMIT 1");
  assert.ok(patients.length > 0, 'fixture should contain an active patient');
  assert.ok(doctors.length > 0, 'fixture should contain an active doctor');

  await pool.query(
    `INSERT INTO appointments
     (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, type, status)
     VALUES (?, ?, ?, ?, '2099-01-01', '12:34', 'consultation', 'scheduled')`,
    [randomUUID(), `APT-TIMEZONE-${randomUUID()}`, patients[0].id, doctors[0].id]
  );

  const RealDate = global.Date;
  const previousTimezone = process.env.APP_TIMEZONE;
  const fixedInstant = '2098-12-31T23:30:00.000Z';
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedInstant]));
    }
    static now() {
      return new RealDate(fixedInstant).getTime();
    }
  }

  process.env.APP_TIMEZONE = 'Pacific/Kiritimati';
  global.Date = FixedDate;
  tokenCache.delete('admin@hospital.com');
  try {
    const adminToken = await login();
    const response = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ message: "show today's appointments" })
      .expect(200);

    assert.match(response.body.response, /appointment\(s\) today/i);
    assert.ok(Array.isArray(response.body.data));
    assert.ok(response.body.data.some(item => item.time === '12:34'));
  } finally {
    global.Date = RealDate;
    if (previousTimezone === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = previousTimezone;
    tokenCache.delete('admin@hospital.com');
  }
});

test('AI search validation and role boundaries are enforced', async () => {
  const adminToken = await login();
  await request(app)
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ message: 'find patient' })
    .expect(400);
  await request(app)
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ message: 'x'.repeat(501) })
    .expect(400);

  const doctorToken = await login('doctor@hospital.com');
  const [doctorRows] = await pool.query("SELECT id FROM users WHERE email = 'doctor@hospital.com'");
  const [assignedPatients] = await pool.query(
    `SELECT patient_id FROM appointments WHERE doctor_id = ? ORDER BY id LIMIT 1`,
    [doctorRows[0].id]
  );
  const [unassignedPatients] = await pool.query(
    `SELECT p.id FROM patients p
     WHERE NOT EXISTS (
       SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = ?
     ) AND NOT EXISTS (
       SELECT 1 FROM medical_records mr WHERE mr.patient_id = p.id AND mr.doctor_id = ?
     )
     ORDER BY p.id LIMIT 1`,
    [doctorRows[0].id, doctorRows[0].id]
  );
  assert.ok(assignedPatients.length > 0, 'fixture should contain a doctor assignment');
  assert.ok(unassignedPatients.length > 0, 'fixture should contain an unassigned patient');
  await request(app)
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ message: `patient record ${assignedPatients[0].patient_id}` })
    .expect(200);
  const unassigned = await request(app)
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ message: `patient record ${unassignedPatients[0].id}` })
    .expect(403);
  assert.match(unassigned.body.response, /not assigned/i);

  const pharmacistToken = await login('pharmacist@hospital.com');
  const stock = await request(app)
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${pharmacistToken}`)
    .send({ message: 'show current stock of Amoxicillin' })
    .expect(200);
  assert.match(stock.body.response, /stock status/i);

  const receptionistToken = await login('receptionist@hospital.com');
  await request(app)
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${receptionistToken}`)
    .send({ message: 'abnormal lab results' })
    .expect(403);

  const labTechToken = await login('labtech@hospital.com');
  await request(app)
    .post('/api/ai/chat')
    .set('Authorization', `Bearer ${labTechToken}`)
    .send({ message: 'find patient Garcia' })
    .expect(403);
});

test('smart operational data is scoped to authorized roles', async () => {
  const adminToken = await login();
  const adminForecast = await request(app)
    .get('/api/smart/forecast')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.ok(Array.isArray(adminForecast.body.stockForecast));
  assert.equal(typeof adminForecast.body.lowStockCount, 'number');

  const doctorToken = await login('doctor@hospital.com');
  const doctorForecast = await request(app)
    .get('/api/smart/forecast')
    .set('Authorization', `Bearer ${doctorToken}`)
    .expect(200);
  assert.equal(Object.hasOwn(doctorForecast.body, 'stockForecast'), false);
  assert.equal(Object.hasOwn(doctorForecast.body, 'lowStockCount'), false);

  const receptionistToken = await login('receptionist@hospital.com');
  const commandCenter = await request(app)
    .get('/api/smart/command-center')
    .set('Authorization', `Bearer ${receptionistToken}`)
    .expect(200);
  assert.equal(Object.hasOwn(commandCenter.body, 'lowStockCount'), false);
  assert.equal(Object.hasOwn(commandCenter.body, 'abnormalLabCount'), false);
  assert.equal(typeof commandCenter.body.overdueBillCount, 'number');
  assert.equal(
    commandCenter.body.alerts.some(alert => ['stock', 'lab'].includes(alert.icon)),
    false
  );
});

test('dashboard returns role-filtered data and seven weekly buckets', async () => {
  const adminToken = await login();
  const adminDashboard = await request(app)
    .get('/api/reports/dashboard')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.equal(adminDashboard.body.weeklyStats.length, 7);
  assert.equal(new Set(adminDashboard.body.weeklyStats.map(day => day.date)).size, 7);

  const pharmacistToken = await login('pharmacist@hospital.com');
  const pharmacistDashboard = await request(app)
    .get('/api/reports/dashboard')
    .set('Authorization', `Bearer ${pharmacistToken}`)
    .expect(200);
  assert.equal(typeof pharmacistDashboard.body.stats.lowStockMedications, 'number');
  assert.equal(pharmacistDashboard.body.stats.pendingLabOrders, null);
  assert.deepEqual(pharmacistDashboard.body.weeklyStats, []);
});
