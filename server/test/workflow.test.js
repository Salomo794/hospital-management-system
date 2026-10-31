// One patient's complete journey through the API, one role at a time:
// reception registers and books -> doctor documents, orders a lab test and
// prescribes -> lab technician reports -> pharmacist dispenses -> reception bills
// and takes payment. Each step is also tried by a role that must be refused.
//
// The rest of the suite exercises these endpoints one at a time, usually after
// seeding rows directly. This file only uses the HTTP API, so it catches the
// breakage that appears between steps.
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:rootpass@127.0.0.1:3306/hms_test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const app = require('../index');
const pool = require('../config/database');

const tokens = new Map();
async function login(email) {
  const response = await request(app).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
  tokens.set(email, response.body.token);
}
// Synchronous on purpose: a supertest request is thenable, so awaiting it here would send it early.
const as = (email, method, url) => request(app)[method](url).set('Authorization', `Bearer ${tokens.get(email)}`);

const RECEPTION = 'receptionist@hospital.com';
const DOCTOR = 'doctor@hospital.com';
const NURSE = 'nurse@hospital.com';
const LAB = 'labtech@hospital.com';
const PHARMACIST = 'pharmacist@hospital.com';

before(async () => {
  await setupDatabase();
  await seedDatabase();
  for (const email of [RECEPTION, DOCTOR, NURSE, LAB, PHARMACIST]) await login(email);
});

after(async () => {
  await pool.close();
});

test('a patient can be taken from registration to a settled bill, with every role kept in its lane', async () => {
  // ── Reception registers the patient ──────────────────────────────────────
  const registered = await (as(RECEPTION, 'post', '/api/patients')).send({
    first_name: 'Journey',
    last_name: 'Patient',
    date_of_birth: '1988-03-14',
    gender: 'female',
    phone: '0788123456',
    email: `journey-${Date.now()}@example.com`,
  }).expect(201);
  const patientId = registered.body.patient.id;
  assert.ok(patientId, 'registration returns the new patient');
  assert.ok(registered.body.patient.mrn, 'the patient gets a medical record number');

  // ── Reception books the first free slot in the doctor's schedule ─────────
  const [doctors] = await pool.query("SELECT id FROM users WHERE email = ?", [DOCTOR]);
  const doctorId = doctors[0].id;
  let date;
  let slot;
  for (let offset = 2; offset < 30 && !slot; offset += 1) {
    const candidate = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const slots = await (as(RECEPTION, 'get', `/api/appointments/slots/${doctorId}?date=${candidate}`)).expect(200);
    if (slots.body.slots.length) {
      date = candidate;
      slot = slots.body.slots[0];
    }
  }
  assert.ok(slot, 'the doctor has at least one bookable slot in the next 30 days');
  const booked = await (as(RECEPTION, 'post', '/api/appointments')).send({
    patient_id: patientId,
    doctor_id: doctorId,
    appointment_date: date,
    appointment_time: slot,
    type: 'consultation',
    reason: 'Persistent cough',
  }).expect(201);
  const appointmentId = booked.body.id ?? booked.body.appointment?.id;
  assert.ok(appointmentId, 'booking returns the appointment id');

  // The same slot cannot be booked twice.
  await (as(RECEPTION, 'post', '/api/appointments')).send({
    patient_id: patientId, doctor_id: doctorId, appointment_date: date, appointment_time: slot,
    type: 'consultation', reason: 'Double booking',
  }).expect(res => assert.ok(res.status >= 400 && res.status < 500, `double booking refused, got ${res.status}`));

  // ── Roles that must not write clinical notes are refused ─────────────────
  await (as(RECEPTION, 'post', '/api/emr')).send({ patient_id: patientId, chief_complaint: 'x' }).expect(403);
  await (as(NURSE, 'post', '/api/emr')).send({ patient_id: patientId, chief_complaint: 'x' }).expect(403);
  await (as(PHARMACIST, 'get', `/api/emr/patient/${patientId}`)).expect(403);

  // ── Doctor documents the visit; the appointment closes ───────────────────
  const record = await (as(DOCTOR, 'post', '/api/emr')).send({
    patient_id: patientId,
    appointment_id: appointmentId,
    chief_complaint: 'Persistent cough for two weeks',
    diagnosis: 'Suspected bronchitis',
    treatment_plan: 'Chest X-ray, blood count, antibiotics',
  }).expect(201);
  const recordId = record.body.id;
  const [afterVisit] = await pool.query('SELECT status FROM appointments WHERE id = ?', [appointmentId]);
  assert.equal(afterVisit[0].status, 'completed', 'documenting the visit completes the appointment');

  // ── Doctor orders a lab test; only the lab technician can report ─────────
  const catalogue = await (as(DOCTOR, 'get', '/api/laboratory/tests')).expect(200);
  const tests = catalogue.body.tests ?? catalogue.body;
  assert.ok(Array.isArray(tests) && tests.length, 'the lab catalogue is not empty');
  const order = await (as(DOCTOR, 'post', '/api/laboratory/orders')).send({
    patient_id: patientId,
    medical_record_id: recordId,
    test_ids: [tests[0].id],
    priority: 'routine',
    clinical_notes: 'Rule out infection',
  }).expect(201);
  const orderId = order.body.id ?? order.body.order?.id;
  assert.ok(orderId, 'the lab order is created');

  await (as(RECEPTION, 'get', '/api/laboratory/orders')).expect(403);
  const detail = await (as(LAB, 'get', `/api/laboratory/orders/${orderId}`)).expect(200);
  const items = detail.body.items ?? detail.body.order?.items;
  assert.ok(items?.length, 'the lab technician can see what was ordered');

  await (as(DOCTOR, 'put', `/api/laboratory/orders/${orderId}/results`))
    .send({ items: items.map(item => ({ id: item.id, result_value: '7.2' })) }).expect(403);
  await (as(LAB, 'put', `/api/laboratory/orders/${orderId}/results`))
    .send({ items: items.map(item => ({ id: item.id, result_value: '7.2' })) }).expect(200);
  const reported = await (as(DOCTOR, 'get', `/api/laboratory/orders/${orderId}`)).expect(200);
  assert.equal((reported.body.status ?? reported.body.order?.status), 'completed', 'the doctor sees the finished result');

  // ── Doctor prescribes; pharmacist dispenses and stock falls ──────────────
  const [stocked] = await pool.query(
    "SELECT id, stock_quantity FROM medicines WHERE is_active = 1 AND stock_quantity >= 20 AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE) ORDER BY id LIMIT 1"
  );
  assert.ok(stocked.length, 'the seed data has an in-date medicine with stock');
  const medicine = stocked[0];

  await (as(RECEPTION, 'post', '/api/emr/prescriptions')).send({
    medical_record_id: recordId, patient_id: patientId,
    items: [{ medicine_id: medicine.id, dosage: '500mg', frequency: 'Twice daily', quantity: 10 }],
  }).expect(403);
  const prescribed = await (as(DOCTOR, 'post', '/api/emr/prescriptions')).send({
    medical_record_id: recordId,
    patient_id: patientId,
    acknowledge_warnings: true,
    items: [{ medicine_id: medicine.id, dosage: '500mg', frequency: 'Twice daily', duration: '5 days', quantity: 10 }],
  }).expect(201);
  assert.ok(prescribed.body, 'the prescription is created');

  const pending = await (as(PHARMACIST, 'get', '/api/prescriptions/pending-items')).expect(200);
  const [ownItems] = await pool.query(
    `SELECT pi.id FROM prescription_items pi JOIN prescriptions pr ON pr.id = pi.prescription_id
     WHERE pr.patient_id = ?`, [patientId]);
  assert.equal(ownItems.length, 1, 'exactly one item was prescribed to this patient');
  const item = pending.body.items.find(candidate => candidate.id === ownItems[0].id);
  assert.ok(item, 'the new prescription reaches the pharmacy queue');

  await (as(DOCTOR, 'post', '/api/pharmacy/dispense'))
    .send({ prescription_item_id: item.id, quantity: 10, request_id: `wf-doctor-${Date.now()}` }).expect(403);
  await (as(PHARMACIST, 'post', '/api/pharmacy/dispense'))
    .send({ prescription_item_id: item.id, quantity: 10, request_id: `wf-${Date.now()}` }).expect(200);
  const [stockAfter] = await pool.query('SELECT stock_quantity FROM medicines WHERE id = ?', [medicine.id]);
  assert.equal(stockAfter[0].stock_quantity, medicine.stock_quantity - 10, 'dispensing removes exactly the dispensed units from stock');

  // A fully dispensed item cannot be dispensed again under a new request id.
  await (as(PHARMACIST, 'post', '/api/pharmacy/dispense'))
    .send({ prescription_item_id: item.id, quantity: 1, request_id: `wf-again-${Date.now()}` })
    .expect(res => assert.ok(res.status >= 400 && res.status < 500, `over-dispensing refused, got ${res.status}`));
  const [stockUnchanged] = await pool.query('SELECT stock_quantity FROM medicines WHERE id = ?', [medicine.id]);
  assert.equal(stockUnchanged[0].stock_quantity, medicine.stock_quantity - 10, 'a refused dispense leaves stock untouched');

  // ── Reception bills the visit and takes payment in two parts ─────────────
  await (as(PHARMACIST, 'post', '/api/billing'))
    .send({ patient_id: patientId, items: [{ description: 'Consultation', category: 'consultation', quantity: 1, unit_price: 50 }] })
    .expect(403);
  const bill = await (as(RECEPTION, 'post', '/api/billing')).send({
    patient_id: patientId,
    items: [
      { description: 'Consultation', category: 'consultation', quantity: 1, unit_price: 50 },
      { description: 'Blood count', category: 'laboratory', quantity: 1, unit_price: 25.5 },
    ],
    tax: 0,
  }).expect(201);
  const billId = bill.body.id ?? bill.body.bill?.id;
  assert.ok(billId, 'the bill is created');
  assert.equal(Number(bill.body.total_amount ?? bill.body.bill?.total_amount), 75.5, 'the total is the sum of the lines');

  await (as(RECEPTION, 'post', `/api/billing/${billId}/payments`))
    .send({ amount: 100, payment_method: 'cash' })
    .expect(res => assert.ok(res.status >= 400 && res.status < 500, `overpayment refused, got ${res.status}`));
  await (as(RECEPTION, 'post', `/api/billing/${billId}/payments`)).send({ amount: 30, payment_method: 'cash' }).expect(201);
  const [partial] = await pool.query('SELECT payment_status AS status, paid_amount FROM bills WHERE id = ?', [billId]);
  assert.equal(partial[0].status, 'partial');
  assert.equal(Number(partial[0].paid_amount), 30);

  await (as(RECEPTION, 'post', `/api/billing/${billId}/payments`)).send({ amount: 45.5, payment_method: 'cash' }).expect(201);
  const [settled] = await pool.query('SELECT payment_status AS status, paid_amount FROM bills WHERE id = ?', [billId]);
  assert.equal(settled[0].status, 'paid');
  assert.equal(Number(settled[0].paid_amount), 75.5);

  // ── The patient history shows the whole journey ─────────────────────────
  const history = await (as(DOCTOR, 'get', `/api/patients/${patientId}/history`)).expect(200);
  const serialised = JSON.stringify(history.body);
  assert.match(serialised, /Suspected bronchitis/, 'the history includes the diagnosis');
});
