const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate, authenticatePortal, authorize } = require('../middleware/auth');
const {
  ApiError, asyncHandler, parseFiniteNumber, parseInteger, withTransaction,
} = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');
const { FixedWindowRateLimiter } = require('../utils/rateLimiter');

const PAYMENT_METHODS = ['cash', 'card', 'insurance', 'online', 'bank_transfer', 'other'];
const CHECKIN_TRANSITIONS = {
  waiting: new Set(['in_consultation', 'completed', 'no_show', 'cancelled']),
  in_consultation: new Set(['completed', 'no_show', 'cancelled']),
  completed: new Set(),
  no_show: new Set(),
  cancelled: new Set(),
};
const portalLoginLimiter = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });
const checkinLimiter = new FixedWindowRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });

async function findPatientByIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return [];
  const isQrToken = /^HMS:CHECKIN:/i.test(value);
  const lookup = isQrToken ? value.replace(/^HMS:CHECKIN:/i, '') : value;
  if (isQrToken) {
    const [rows] = await pool.query('SELECT * FROM patients WHERE uuid = ? LIMIT 2', [lookup]);
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT * FROM patients
     WHERE mrn = ? OR uuid = ? OR UPPER(access_code) = ? OR phone = ? OR LOWER(email) = ?
     LIMIT 2`,
    [value, value, value.toUpperCase(), value, value.toLowerCase()]
  );
  return rows;
}

router.post('/login', asyncHandler(async (req, res) => {
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
  const portalPin = typeof req.body?.portal_pin === 'string' ? req.body.portal_pin : '';
  if (!identifier || !portalPin) throw new ApiError(400, 'MRN/access code and portal PIN are required');

  const limitKey = `portal:${req.ip}:${identifier.toLowerCase()}`;
  const limit = portalLoginLimiter.consume(limitKey);
  if (!limit.allowed) {
    res.setHeader('Retry-After', limit.retryAfterSeconds);
    throw new ApiError(429, 'Too many portal login attempts. Please try again later.');
  }

  const matches = await findPatientByIdentifier(identifier);
  if (matches.length > 1) throw new ApiError(409, 'Identifier is ambiguous. Use the patient MRN or QR code.');
  const patient = matches[0];
  const pinMatches = patient?.portal_pin && await bcrypt.compare(portalPin, patient.portal_pin);
  if (!patient || !pinMatches) throw new ApiError(401, 'Invalid patient credentials');
  if (patient.status !== 'active') throw new ApiError(403, 'This patient record is inactive');

  portalLoginLimiter.reset(limitKey);
  const token = jwt.sign(
    { pid: patient.id, portal: true },
    process.env.JWT_SECRET,
    { expiresIn: process.env.PORTAL_JWT_EXPIRE || '24h' }
  );
  res.json({
    token,
    patient: {
      id: patient.id,
      uuid: patient.uuid,
      mrn: patient.mrn,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.gender,
      blood_type: patient.blood_type,
      phone: patient.phone,
      email: patient.email,
    },
  });
}));

router.post('/checkin', asyncHandler(async (req, res) => {
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
  const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim().slice(0, 200) : null;
  if (!identifier) throw new ApiError(400, 'identifier is required');
  const limit = checkinLimiter.consume(`checkin:${req.ip}`);
  if (!limit.allowed) {
    res.setHeader('Retry-After', limit.retryAfterSeconds);
    throw new ApiError(429, 'Too many check-in attempts. Please wait before trying again.');
  }

  const matches = await findPatientByIdentifier(identifier);
  if (matches.length > 1) throw new ApiError(409, 'Identifier is ambiguous. Use the patient MRN or QR code.');
  const patient = matches[0];
  if (!patient) throw new ApiError(404, 'Patient not found. Please check your MRN or QR code.');
  if (patient.status !== 'active') throw new ApiError(403, 'This patient record is inactive.');

  const today = new Date().toISOString().slice(0, 10);
  const [todayAppointments] = await pool.query(
    `SELECT id, appointment_time, type, reason FROM appointments
     WHERE patient_id = ? AND appointment_date = ? AND status = 'scheduled'
     ORDER BY appointment_time ASC LIMIT 1`,
    [patient.id, today]
  );
  const [recentCheckins] = await pool.query(
    "SELECT * FROM checkins WHERE patient_id = ? AND date(checkin_time) = ? ORDER BY id DESC LIMIT 1",
    [patient.id, today]
  );
  if (recentCheckins.length > 0) {
    const existing = recentCheckins[0];
    if (!['waiting', 'in_consultation'].includes(existing.status)) {
      throw new ApiError(409, `Today's check-in is already ${existing.status.replace('_', ' ')}. Please contact reception.`);
    }
    if (purpose) {
      await pool.query('UPDATE checkins SET purpose = ? WHERE id = ?', [purpose, existing.id]);
      existing.purpose = purpose;
    }
  }

  let checkin = recentCheckins[0];
  if (!checkin) {
    const [result] = await pool.query(
      `INSERT INTO checkins
       (uuid, patient_id, appointment_id, checkin_time, purpose, status, qr_token)
       VALUES (?, ?, ?, datetime('now'), ?, 'waiting', ?)`,
      [
        randomUUID(), patient.id, todayAppointments[0]?.id || null,
        purpose || todayAppointments[0]?.type || 'visit', identifier,
      ]
    );
    const [created] = await pool.query('SELECT * FROM checkins WHERE id = ?', [result.insertId]);
    checkin = created[0];
  }

  const [positionRows] = await pool.query(
    `SELECT COUNT(*) AS count FROM checkins
     WHERE date(checkin_time) = ? AND status IN ('waiting','in_consultation') AND id <= ?`,
    [today, checkin.id]
  );
  res.json({
    success: true,
    checked_in: true,
    queue_position: positionRows[0].count,
    status: checkin.status,
    patient: {
      id: patient.id,
      name: `${patient.first_name} ${patient.last_name}`,
      mrn: patient.mrn,
      dob: patient.date_of_birth,
      gender: patient.gender,
    },
    appointment: todayAppointments[0]
      ? {
          time: todayAppointments[0].appointment_time.slice(0, 5),
          type: todayAppointments[0].type,
          reason: todayAppointments[0].reason,
        }
      : null,
    message: todayAppointments[0]
      ? `Checked in for your ${todayAppointments[0].appointment_time.slice(0, 5)} ${todayAppointments[0].type} appointment. Please take a seat and we will call you.`
      : 'Checked in successfully. Please take a seat. A staff member will assist you shortly.',
  });
}));

router.put('/checkins/:id/status', authenticate, authorize('admin', 'doctor', 'nurse', 'receptionist'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const status = req.body?.status;
  if (!['waiting', 'in_consultation', 'completed', 'no_show', 'cancelled'].includes(status)) {
    throw new ApiError(400, 'Invalid check-in status');
  }
  const [rows] = await pool.query('SELECT * FROM checkins WHERE id = ?', [id]);
  if (rows.length === 0) throw new ApiError(404, 'Check-in not found');
  if (status !== rows[0].status && !CHECKIN_TRANSITIONS[rows[0].status].has(status)) {
    throw new ApiError(409, `Cannot transition check-in from ${rows[0].status} to ${status}`);
  }
  await pool.query('UPDATE checkins SET status = ? WHERE id = ?', [status, id]);
  res.json({ message: 'Check-in status updated', id, status });
}));

router.get('/me', authenticatePortal, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, uuid, mrn, first_name, last_name, date_of_birth, gender, phone, email,
            blood_type, insurance_provider, insurance_number, allergies, chronic_conditions, address
     FROM patients WHERE id = ?`,
    [req.patient.id]
  );
  const [todayCheckins] = await pool.query(
    "SELECT * FROM checkins WHERE patient_id = ? AND date(checkin_time) = date('now') ORDER BY id DESC LIMIT 1",
    [req.patient.id]
  );
  const [aheadRows] = await pool.query(
    `SELECT COUNT(*) as count FROM checkins
     WHERE date(checkin_time) = date('now') AND status IN ('waiting','in_consultation') AND id < ?`,
    [todayCheckins[0]?.id || 0]
  );
  res.json({ patient: rows[0], checkin: todayCheckins[0] || null, ahead_in_queue: aheadRows[0].count });
}));

router.get('/appointments', authenticatePortal, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id, a.appointment_date, a.appointment_time, a.type, a.status, a.reason, a.notes,
            u.first_name || ' ' || u.last_name AS doctor_name,
            d.name || '' AS specialty
     FROM appointments a JOIN users u ON a.doctor_id = u.id
     LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
     LEFT JOIN specialties d ON dp.specialty_id = d.id
     WHERE a.patient_id = ? ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT 30`,
    [req.patient.id]
  );
  res.json({ appointments: rows });
}));

router.get('/lab-results', authenticatePortal, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT lo.order_number, lo.order_date, lo.status, lo.priority,
            li.result_value, li.result_unit, li.reference_range, li.is_abnormal, li.result_date,
            lt.name AS test_name
     FROM lab_orders lo JOIN lab_order_items li ON li.lab_order_id = lo.id
     JOIN lab_tests lt ON lt.id = li.lab_test_id
     WHERE lo.patient_id = ? AND lo.status = 'completed'
     ORDER BY lo.order_date DESC LIMIT 40`,
    [req.patient.id]
  );
  res.json({ results: rows });
}));

router.get('/prescriptions', authenticatePortal, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pr.prescription_number, pr.prescribed_date, pr.status,
            u.first_name || ' ' || u.last_name AS doctor_name,
            pi.dosage, pi.frequency, pi.duration, pi.quantity,
            COALESCE(pi.dispensed_quantity, 0) AS dispensed_quantity,
            pi.quantity - COALESCE(pi.dispensed_quantity, 0) AS remaining_quantity,
            pi.instructions, pi.dispensed, m.name AS medicine_name
     FROM prescriptions pr JOIN users u ON pr.doctor_id = u.id
     LEFT JOIN prescription_items pi ON pi.prescription_id = pr.id
     LEFT JOIN medicines m ON m.id = pi.medicine_id
     WHERE pr.patient_id = ? ORDER BY pr.prescribed_date DESC LIMIT 40`,
    [req.patient.id]
  );
  res.json({ prescriptions: rows });
}));

router.get('/bills', authenticatePortal, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.id, b.bill_number, b.total_amount, b.discount, b.tax, b.net_amount,
            b.paid_amount, b.payment_status, b.payment_method, b.due_date, b.created_at
     FROM bills b WHERE b.patient_id = ? ORDER BY b.created_at DESC LIMIT 30`,
    [req.patient.id]
  );
  res.json({ bills: rows });
}));

router.post('/bills/:id/pay', authenticatePortal, asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PAYMENTS !== 'true') {
    throw new ApiError(503, 'Online payments are not enabled. Please contact reception.');
  }
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const amount = Math.round((parseFiniteNumber(req.body?.amount, 'amount', { min: 0.01 }) + Number.EPSILON) * 100) / 100;
  const paymentMethod = req.body?.payment_method || 'card';
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new ApiError(400, 'Invalid payment method');
  const requestId = typeof req.body?.request_id === 'string'
    ? req.body.request_id.trim()
    : (req.get('X-Request-ID') || randomUUID());
  if (requestId.length > 100) throw new ApiError(400, 'request_id is too long');
  const referenceNumber = `portal:${requestId}`;

  const payment = await withTransaction(pool, async connection => {
    const [existingPayment] = await connection.query(
      `SELECT p.amount, b.net_amount, b.paid_amount
       FROM payments p JOIN bills b ON b.id = p.bill_id
       WHERE p.transaction_reference = ? AND p.bill_id = ? AND p.patient_id = ?`,
      [referenceNumber, id, req.patient.id]
    );
    if (existingPayment.length > 0) {
      if (Number(existingPayment[0].amount) !== amount) {
        throw new ApiError(409, 'request_id has already been used for a different payment');
      }
      return {
        success: true,
        replay: true,
        amount: Number(existingPayment[0].amount),
        balance_remaining: Math.max(Number(existingPayment[0].net_amount) - Number(existingPayment[0].paid_amount), 0),
      };
    }

    const [billRows] = await connection.query(
      'SELECT * FROM bills WHERE id = ? AND patient_id = ?',
      [id, req.patient.id]
    );
    if (billRows.length === 0) throw new ApiError(404, 'Bill not found');
    const bill = billRows[0];
    if (bill.payment_status === 'cancelled') throw new ApiError(409, 'Payments cannot be recorded for a cancelled bill');
    const outstanding = Math.round((Number(bill.net_amount) - Number(bill.paid_amount) + Number.EPSILON) * 100) / 100;
    if (outstanding <= 0) throw new ApiError(400, 'This bill has no outstanding balance');
    if (amount > outstanding) throw new ApiError(400, `Payment cannot exceed the outstanding balance of ${outstanding}`);

    const paymentNumber = generateRecordNumber('PAY-PTL');
    await connection.query(
      `INSERT INTO payments
       (uuid, payment_number, bill_id, patient_id, amount, payment_method,
        transaction_reference, received_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [randomUUID(), paymentNumber, id, req.patient.id, amount, paymentMethod, referenceNumber, 'Portal self-service payment']
    );
    await connection.query(
      `UPDATE bills
       SET paid_amount = paid_amount + ?,
           payment_status = CASE WHEN paid_amount + ? >= net_amount THEN 'paid' ELSE 'partial' END,
           payment_method = COALESCE(payment_method, ?)
       WHERE id = ?`,
      [amount, amount, paymentMethod, id]
    );
    const [updated] = await connection.query('SELECT net_amount, paid_amount FROM bills WHERE id = ?', [id]);
    return {
      success: true,
      replay: false,
      amount,
      balance_remaining: Math.max(updated[0].net_amount - updated[0].paid_amount, 0),
    };
  });

  res.json({ ...payment, message: 'Payment recorded successfully. Thank you!' });
}));

module.exports = router;
