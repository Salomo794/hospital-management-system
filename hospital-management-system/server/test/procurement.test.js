const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-procurement-test-'));
const dbPath = path.join(tempDirectory, 'hospital.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

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

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
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

// Picks two seeded medicines and reports the stock each started with, so
// receipts can be asserted against a real before/after rather than a constant.
async function pickMedicines() {
  const response = await request(app)
    .get('/api/pharmacy/medicines?limit=2')
    .set(bearer(await login()))
    .expect(200);
  const medicines = response.body.medicines;
  assert.ok(medicines.length >= 2, 'seed must provide at least two medicines');
  return medicines.slice(0, 2);
}

async function createSupplier({ name, leadTimeDays } = {}) {
  const response = await request(app)
    .post('/api/procurement/suppliers')
    .set(bearer(await login()))
    .send({ name: name || `Test Supplier ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, lead_time_days: leadTimeDays })
    .expect(201);
  return response.body;
}

async function draftOrder({ token, supplierId, medicines, quantity = 50 }) {
  const response = await request(app)
    .post('/api/procurement/orders')
    .set(bearer(token))
    .send({
      supplier_id: supplierId,
      items: medicines.map(medicine => ({ medicine_id: medicine.id, quantity, unit_cost: 0.25 })),
    })
    .expect(201);
  return response.body;
}

test('procurement routes are closed to roles that do not replenish', async () => {
  for (const email of ['receptionist@hospital.com', 'doctor@hospital.com', 'nurse@hospital.com', 'labtech@hospital.com']) {
    const token = await login(email);
    await request(app).get('/api/procurement/orders').set(bearer(token)).expect(403);
    await request(app).get('/api/procurement/suppliers').set(bearer(token)).expect(403);
    await request(app).get('/api/procurement/suggestions').set(bearer(token)).expect(403);
  }
  await request(app).get('/api/procurement/orders').expect(401);
});

test('a pharmacist and an admin can both read procurement data', async () => {
  for (const email of ['admin@hospital.com', 'pharmacist@hospital.com']) {
    const token = await login(email);
    const orders = await request(app).get('/api/procurement/orders').set(bearer(token)).expect(200);
    assert.equal(typeof orders.body.total, 'number');
    const summary = await request(app).get('/api/procurement/summary').set(bearer(token)).expect(200);
    assert.equal(typeof summary.body.awaiting_approval, 'number');
    assert.equal(typeof summary.body.low_stock_items, 'number');
  }
});

test('only an admin may create a supplier and names stay unique', async () => {
  const pharmacist = await login('pharmacist@hospital.com');
  await request(app)
    .post('/api/procurement/suppliers')
    .set(bearer(pharmacist))
    .send({ name: 'Pharmacist Attempt' })
    .expect(403);

  const admin = await login();
  const supplier = await createSupplier({ name: 'Unique Medical Trade' });
  assert.equal(supplier.name, 'Unique Medical Trade');
  assert.equal(supplier.lead_time_days, 7, 'lead time defaults when omitted');

  await request(app)
    .post('/api/procurement/suppliers')
    .set(bearer(admin))
    .send({ name: 'Unique Medical Trade' })
    .expect(409);

  await request(app).post('/api/procurement/suppliers').set(bearer(admin)).send({ name: '   ' }).expect(400);
  await request(app)
    .post('/api/procurement/suppliers')
    .set(bearer(admin))
    .send({ name: 'Bad Email', email: 'not-an-email' })
    .expect(400);
  await request(app)
    .post('/api/procurement/suppliers')
    .set(bearer(admin))
    .send({ name: 'Negative Lead', lead_time_days: -3 })
    .expect(400);
});

test('a deactivated supplier cannot take new orders and is hidden from the active list', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier({ name: 'Retired Supplier Co' });
  const medicines = await pickMedicines();

  await request(app).put(`/api/procurement/suppliers/${supplier.id}`).set(bearer(admin)).send({ is_active: false }).expect(200);
  await request(app)
    .post('/api/procurement/orders')
    .set(bearer(pharmacist))
    .send({ supplier_id: supplier.id, items: [{ medicine_id: medicines[0].id, quantity: 10 }] })
    .expect(400);

  const active = await request(app)
    .get('/api/procurement/suppliers?is_active=true&limit=100')
    .set(bearer(pharmacist))
    .expect(200);
  assert.equal(
    active.body.suppliers.some(row => row.id === supplier.id),
    false,
    'a deactivated supplier must not appear in the active list'
  );
});

test('purchase order validation rejects empty, duplicate, and unknown line items', async () => {
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();

  await request(app)
    .post('/api/procurement/orders')
    .set(bearer(pharmacist))
    .send({ supplier_id: supplier.id, items: [] })
    .expect(400);

  await request(app)
    .post('/api/procurement/orders')
    .set(bearer(pharmacist))
    .send({ supplier_id: supplier.id, items: [{ medicine_id: medicines[0].id, quantity: 5 }, { medicine_id: medicines[0].id, quantity: 7 }] })
    .expect(400);

  await request(app)
    .post('/api/procurement/orders')
    .set(bearer(pharmacist))
    .send({ supplier_id: supplier.id, items: [{ medicine_id: 999999, quantity: 5 }] })
    .expect(400);

  await request(app)
    .post('/api/procurement/orders')
    .set(bearer(pharmacist))
    .send({ supplier_id: supplier.id, items: [{ medicine_id: medicines[0].id, quantity: 0 }] })
    .expect(400);

  await request(app)
    .post('/api/procurement/orders')
    .set(bearer(pharmacist))
    .send({ supplier_id: 999999, items: [{ medicine_id: medicines[0].id, quantity: 5 }] })
    .expect(404);

  const order = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines });
  // The stored total is derived from the lines, never taken from the request.
  assert.equal(order.status, 'draft');
  assert.equal(order.total_amount, medicines.length * 50 * 0.25);
  assert.equal(order.items.length, 2);
});

test('the approval workflow enforces separation of duties and legal transitions', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();

  const order = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 40 });

  // A draft is not approvable and a submitted order is not receivable.
  await request(app).post(`/api/procurement/orders/${order.id}/approve`).set(bearer(admin)).expect(409);
  await request(app)
    .post(`/api/procurement/orders/${order.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: [{ item_id: order.items[0].id, quantity: 1 }] })
    .expect(409);

  const submitted = await request(app)
    .post(`/api/procurement/orders/${order.id}/submit`)
    .set(bearer(pharmacist))
    .expect(200);
  assert.equal(submitted.body.status, 'submitted');

  // Submitting twice is a conflict, not a silent no-op.
  await request(app).post(`/api/procurement/orders/${order.id}/submit`).set(bearer(pharmacist)).expect(409);

  // A pharmacist cannot approve, and the raiser cannot approve their own order.
  await request(app).post(`/api/procurement/orders/${order.id}/approve`).set(bearer(pharmacist)).expect(403);

  const adminSubmitted = await request(app)
    .post(`/api/procurement/orders/${order.id}/submit`)
    .set(bearer(admin))
    .expect(409)
    .catch(() => null);
  assert.ok(adminSubmitted, 'admin submit on a submitted order should conflict');

  // A pharmacist-raised order is approved by the admin, who is a different actor.
  const approved = await request(app)
    .post(`/api/procurement/orders/${order.id}/approve`)
    .set(bearer(admin))
    .expect(200);
  assert.equal(approved.body.status, 'approved');
  assert.ok(approved.body.approved_by_name, 'the approver must be recorded');

  // Self-approval is refused: an admin-raised order cannot be approved by itself.
  const adminOrder = await draftOrder({ token: admin, supplierId: supplier.id, medicines, quantity: 15 });
  await request(app).post(`/api/procurement/orders/${adminOrder.id}/submit`).set(bearer(admin)).expect(200);
  await request(app).post(`/api/procurement/orders/${adminOrder.id}/approve`).set(bearer(admin)).expect(403);
});

test('submitting an order notifies an approver who did not raise it', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();

  const order = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 12 });
  await request(app).post(`/api/procurement/orders/${order.id}/submit`).set(bearer(pharmacist)).expect(200);

  const notifications = await request(app)
    .get('/api/notifications')
    .set(bearer(admin))
    .expect(200);
  const pending = notifications.body.notifications.find(n => n.message.includes(order.order_number));
  assert.ok(pending, 'the admin must be notified about an order they did not raise');
  assert.equal(pending.type, 'procurement');
});

test('receiving stock raises inventory, writes the ledger, and closes the order', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();
  const before = medicines.map(medicine => medicine.stock_quantity);

  const order = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 60 });
  await request(app).post(`/api/procurement/orders/${order.id}/submit`).set(bearer(pharmacist)).expect(200);
  await request(app).post(`/api/procurement/orders/${order.id}/approve`).set(bearer(admin)).expect(200);

  const received = await request(app)
    .post(`/api/procurement/orders/${order.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: order.items.map(item => ({ item_id: item.id, quantity: 60 })) })
    .expect(200);

  assert.equal(received.body.status, 'received');
  assert.equal(received.body.receipt.fullyReceived, true);
  assert.ok(received.body.received_at, 'a completed receipt stamps received_at');

  const [stocks] = await pool.query('SELECT id, stock_quantity FROM medicines WHERE id IN (?, ?)', [medicines[0].id, medicines[1].id]);
  const stockById = new Map(stocks.map(row => [row.id, row.stock_quantity]));
  assert.equal(stockById.get(medicines[0].id), before[0] + 60, 'stock rises by the received quantity');
  assert.equal(stockById.get(medicines[1].id), before[1] + 60);

  const [ledger] = await pool.query(
    'SELECT quantity, reference_number FROM inventory_transactions WHERE reference_number LIKE ?',
    [`po:${order.order_number}:%`]
  );
  assert.equal(ledger.length, 2, 'each received line writes its own inventory movement');
  for (const row of ledger) {
    assert.equal(row.quantity, 60);
  }
});

test('a delivery can be received in parts and cannot over-receive a line', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();

  const order = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 100 });
  await request(app).post(`/api/procurement/orders/${order.id}/submit`).set(bearer(pharmacist)).expect(200);
  await request(app).post(`/api/procurement/orders/${order.id}/approve`).set(bearer(admin)).expect(200);

  const firstItem = order.items[0];
  const partial = await request(app)
    .post(`/api/procurement/orders/${order.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: [{ item_id: firstItem.id, quantity: 40 }] })
    .expect(200);
  assert.equal(partial.body.status, 'partially_received');
  assert.equal(partial.body.items.find(item => item.id === firstItem.id).quantity_received, 40);

  // Over-receiving the same line is refused.
  await request(app)
    .post(`/api/procurement/orders/${order.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: [{ item_id: firstItem.id, quantity: 61 }] })
    .expect(400);

  // A partially received order cannot be cancelled; the goods are real.
  await request(app)
    .post(`/api/procurement/orders/${order.id}/cancel`)
    .set(bearer(pharmacist))
    .send({ reason: 'changed our mind' })
    .expect(409);

  // Finishing both lines closes the order.
  const finish = await request(app)
    .post(`/api/procurement/orders/${order.id}/receive`)
    .set(bearer(pharmacist))
    .send({
      items: [
        { item_id: firstItem.id, quantity: 60 },
        { item_id: order.items[1].id, quantity: 100 },
      ],
    })
    .expect(200);
  assert.equal(finish.body.status, 'received');
  assert.equal(finish.body.items.find(item => item.id === firstItem.id).quantity_received, 100);
});

test('a receipt cannot claim a line from another order or repeat one within a request', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();

  const first = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 20 });
  const second = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 20 });
  for (const order of [first, second]) {
    await request(app).post(`/api/procurement/orders/${order.id}/submit`).set(bearer(pharmacist)).expect(200);
    await request(app).post(`/api/procurement/orders/${order.id}/approve`).set(bearer(admin)).expect(200);
  }

  // first's line does not belong to second.
  await request(app)
    .post(`/api/procurement/orders/${second.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: [{ item_id: first.items[0].id, quantity: 1 }] })
    .expect(400);

  await request(app)
    .post(`/api/procurement/orders/${first.id}/receive`)
    .set(bearer(pharmacist))
    .send({
      items: [
        { item_id: first.items[0].id, quantity: 1 },
        { item_id: first.items[0].id, quantity: 2 },
      ],
    })
    .expect(400);
});

test('a delivery may update the batch and expiry it arrives with', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();

  const order = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 25 });
  await request(app).post(`/api/procurement/orders/${order.id}/submit`).set(bearer(pharmacist)).expect(200);
  await request(app).post(`/api/procurement/orders/${order.id}/approve`).set(bearer(admin)).expect(200);

  await request(app)
    .post(`/api/procurement/orders/${order.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: [{ item_id: order.items[0].id, quantity: 25, batch_number: 'BATCH-77', expiry_date: '2027-01-31' }] })
    .expect(200);

  const [medicine] = await pool.query('SELECT batch_number, expiry_date FROM medicines WHERE id = ?', [medicines[0].id]);
  assert.equal(medicine[0].batch_number, 'BATCH-77');
  assert.equal(medicine[0].expiry_date, '2027-01-31');

  await request(app)
    .post(`/api/procurement/orders/${order.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: [{ item_id: order.items[1].id, quantity: 25, expiry_date: 'tomorrow' }] })
    .expect(400);
});

test('cancelling needs a reason and is refused once goods are received', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier();
  const medicines = await pickMedicines();

  const draft = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 10 });
  await request(app).post(`/api/procurement/orders/${draft.id}/cancel`).set(bearer(pharmacist)).send({}).expect(400);

  const cancelled = await request(app)
    .post(`/api/procurement/orders/${draft.id}/cancel`)
    .set(bearer(pharmacist))
    .send({ reason: 'Supplier out of stock' })
    .expect(200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal(cancelled.body.cancellation_reason, 'Supplier out of stock');

  const done = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 10 });
  await request(app).post(`/api/procurement/orders/${done.id}/submit`).set(bearer(pharmacist)).expect(200);
  await request(app).post(`/api/procurement/orders/${done.id}/approve`).set(bearer(admin)).expect(200);
  await request(app)
    .post(`/api/procurement/orders/${done.id}/receive`)
    .set(bearer(pharmacist))
    .send({ items: done.items.map(item => ({ item_id: item.id, quantity: 10 })) })
    .expect(200);
  await request(app)
    .post(`/api/procurement/orders/${done.id}/cancel`)
    .set(bearer(pharmacist))
    .send({ reason: 'too late' })
    .expect(409);
});

test('order filters reject unusable values instead of returning everything', async () => {
  const admin = await login();
  await request(app).get('/api/procurement/orders?status=nonsense').set(bearer(admin)).expect(400);
  await request(app).get('/api/procurement/orders?from_date=nope').set(bearer(admin)).expect(400);
  await request(app)
    .get('/api/procurement/orders?from_date=2026-02-02&to_date=2026-01-01')
    .set(bearer(admin))
    .expect(400);
  await request(app).get('/api/procurement/orders?supplier_id=abc').set(bearer(admin)).expect(400);
  await request(app).get('/api/procurement/orders?limit=0').set(bearer(admin)).expect(400);
  await request(app).get('/api/procurement/orders?limit=-5').set(bearer(admin)).expect(400);
  await request(app).get('/api/procurement/orders/999999').set(bearer(admin)).expect(404);
});

test('reorder suggestions size a top-up and price it from cost price', async () => {
  const pharmacist = await login('pharmacist@hospital.com');
  const response = await request(app).get('/api/procurement/suggestions').set(bearer(pharmacist)).expect(200);
  assert.ok(Array.isArray(response.body.suggestions));

  for (const suggestion of response.body.suggestions) {
    assert.ok(suggestion.suggested_quantity > 0, 'every suggestion must order a positive quantity');
    assert.ok(
      suggestion.suggested_quantity >= suggestion.min_stock_level,
      'a suggestion must at least clear the reorder minimum'
    );
    assert.equal(typeof suggestion.estimated_cost, 'number');
  }
  const sum = response.body.suggestions.reduce((total, item) => total + item.estimated_cost, 0);
  assert.ok(Math.abs(response.body.total_estimated_cost - Math.round(sum * 100) / 100) < 0.02);
});

test('procurement activity is written to the audit log for administrators', async () => {
  const admin = await login();
  const pharmacist = await login('pharmacist@hospital.com');
  const supplier = await createSupplier({ name: 'Audited Supplier' });
  const medicines = await pickMedicines();

  const order = await draftOrder({ token: pharmacist, supplierId: supplier.id, medicines, quantity: 8 });
  await request(app).post(`/api/procurement/orders/${order.id}/submit`).set(bearer(pharmacist)).expect(200);
  await request(app).post(`/api/procurement/orders/${order.id}/approve`).set(bearer(admin)).expect(200);

  const entries = await request(app)
    .get('/api/audit?limit=100')
    .set(bearer(admin))
    .expect(200);
  const forOrder = entries.body.entries.filter(
    entry => entry.table_name === 'purchase_orders' && entry.record_id === order.id
  );
  const actions = forOrder.map(entry => entry.action);
  assert.ok(actions.includes('procurement.order.created'));
  assert.ok(actions.includes('procurement.order.submitted'));
  assert.ok(actions.includes('procurement.order.approved'));

  // The pharmacist is not an administrator and cannot read the trail.
  await request(app).get('/api/audit').set(bearer(pharmacist)).expect(403);
});
