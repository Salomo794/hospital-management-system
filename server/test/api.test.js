const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
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

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');

async function login(email = 'admin@hospital.com') {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' })
    .expect(200);
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

test('billing rejects zero, negative, and over-limit payments', async () => {
  const token = await login();
  const bills = await request(app)
    .get('/api/billing?limit=1')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const billId = bills.body.bills[0].id;
  const outstanding = bills.body.bills[0].net_amount - bills.body.bills[0].paid_amount;

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

test('portal payment requires an explicit positive amount', async () => {
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

  const portalLogin = await request(app)
    .post('/api/portal/login')
    .send({ identifier: unique, portal_pin: createdPatient.body.plain_pin })
    .expect(200);
  await request(app)
    .post(`/api/portal/bills/${bill.body.id}/pay`)
    .set('Authorization', `Bearer ${portalLogin.body.token}`)
    .send({ amount: 0, payment_method: 'card', request_id: 'zero-payment-test' })
    .expect(400);
});

test('partial pharmacy dispensing preserves the remaining quantity', async () => {
  const token = await login('pharmacist@hospital.com');
  const before = await request(app)
    .get('/api/prescriptions/pending-items')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const item = before.body.items.find(candidate => candidate.quantity_remaining > 1);
  assert.ok(item, 'fixture should contain a multi-unit prescription item');

  const requestId = `test-dispense-${Date.now()}`;
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
