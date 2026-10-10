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
const { getRequestId } = require('../utils/requestId');
const { FixedWindowRateLimiter } = require('../utils/rateLimiter');
const { isPaymentMethod, PENDING_PAYMENT_STATUS, MOBILE_MONEY_METHOD } = require('../config/paymentMethods');
const { isMobileMoneyEnabled, publicConfig: mobileMoneyPublicConfig, paystackSettings } = require('../config/mobileMoney');
const { getAdapter: getMobileMoneyAdapter } = require('../services/mobileMoney');
const {
  validateRequest: validateMobileMoneyRequest,
  createPendingPayment,
  requestChargeFromProvider,
  attachProviderReference,
  applyGatewayResult,
} = require('../services/mobileMoneyPayments');
const { recalculateBillPayment } = require('../utils/bills');
const { zonedDate, zonedDateTime } = require('../config/time');
const { recordAudit } = require('../utils/audit');

const CHECKIN_TRANSITIONS = {
  waiting: new Set(['in_consultation', 'completed', 'no_show', 'cancelled']),
  in_consultation: new Set(['completed', 'no_show', 'cancelled']),
  completed: new Set(),
  no_show: new Set(),
  cancelled: new Set(),
};
const portalLoginLimiter = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });
const checkinLimiter = new FixedWindowRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });

function paymentsEnabled() {
  return (
    (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test')
    && process.env.ALLOW_SIMULATED_PAYMENTS === 'true'
  );
}

// Lets a patient approve a bill from the portal. Gated on the provider being
// configured rather than on ALLOW_SIMULATED_PAYMENTS, because this rail settles
// against a real provider rather than a stand-in.
function payBillByMobileMoney(req, res, id) {
  if (!isMobileMoneyEnabled()) {
    throw new ApiError(503, 'Mobile money payments are not enabled. Please contact reception.');
  }
  const adapter = getMobileMoneyAdapter();
  const { phone, network, email } = validateMobileMoneyRequest(req.body || {});
  const requestId = getRequestId(req, 'request_id', { required: true });
  // Scoped to the request rather than the bill, so a patient paying two bills
  // in one session does not have their second attempt mistaken for a replay.
  const reference = `portal-mm:${requestId}`;

  return (async () => {
    const [existing] = await pool.query(
      'SELECT id, amount, status FROM payments WHERE transaction_reference = ?',
      [reference]
    );
    if (existing.length > 0) {
      const [bills] = await pool.query('SELECT net_amount, paid_amount FROM bills WHERE id = ?', [id]);
      const bill = bills[0] || { net_amount: 0, paid_amount: 0 };
      return res.json({
        success: true,
        replay: true,
        status: existing[0].status,
        amount: Number(existing[0].amount),
        balance_remaining: Math.max(Number(bill.net_amount) - Number(bill.paid_amount), 0),
        message: 'This request is already in progress.',
      });
    }

    const pending = await withTransaction(pool, async connection => {
      const [billRows] = await connection.query(
        'SELECT * FROM bills WHERE id = ? AND patient_id = ?',
        [id, req.patient.id]
      );
      if (billRows.length === 0) throw new ApiError(404, 'Bill not found');
      const bill = billRows[0];
      if (bill.payment_status === 'cancelled') throw new ApiError(409, 'Payments cannot be recorded for a cancelled bill');
      const outstanding = Math.round((Number(bill.net_amount) - Number(bill.paid_amount) + Number.EPSILON) * 100) / 100;
      if (outstanding <= 0) throw new ApiError(400, 'This bill has no outstanding balance');
      return createPendingPayment({
        connection,
        req,
        bill: { ...bill, outstanding },
        amount: outstanding,
        phone,
        network,
        // Providers reject an unusable address, and the patient on the portal
        // already has a verified one on file.
        email: email || req.patient.email || null,
        receivedBy: null,
        notes: `Portal mobile money request to ${network} ending ${String(phone).slice(-4)}`,
        prefix: 'PAY-MMPTL',
        reference,
      });
    });

    let charge;
    try {
      charge = await requestChargeFromProvider(pending, { callbackUrl: paystackSettings().callbackUrl });
    } catch (error) {
      await withTransaction(pool, async connection => applyGatewayResult({
        connection,
        req,
        paymentId: pending.paymentId,
        result: { status: 'failed', providerReference: null, failureReason: error.message.slice(0, 300) },
      }));
      throw error;
    }

    const bill = await withTransaction(pool, async connection => {
      await attachProviderReference({
        connection,
        paymentId: pending.paymentId,
        provider: charge.adapter.name,
        providerReference: charge.result.providerReference,
      });
      await recordAudit({
        req,
        connection,
        action: 'billing.portal_mobile_money.requested',
        table: 'payments',
        recordId: pending.paymentId,
        summary: `${pending.paymentNumber} ${pending.amount} via ${network} for patient ${req.patient.id}`,
        after: {
          payment_number: pending.paymentNumber,
          bill_id: id,
          amount: pending.amount,
          network,
          provider: charge.adapter.name,
          status: PENDING_PAYMENT_STATUS,
        },
      });
      return recalculateBillPayment(connection, id);
    });

    res.status(202).json({
      success: true,
      replay: false,
      payment_id: pending.paymentId,
      status: PENDING_PAYMENT_STATUS,
      amount: pending.amount,
      balance_remaining: Math.max(Number(bill.net_amount) - Number(bill.paid_amount), 0),
      message: 'Approve the payment on your phone to complete it.',
    });
  })();
}

// Polls a portal-initiated charge. `?sync=1` asks the provider directly, which
// is what the browser does while the patient is still typing their PIN.
router.get('/bills/:id/mobile-money/:paymentId', authenticatePortal, asyncHandler(async (req, res) => {
  if (!isMobileMoneyEnabled()) {
    throw new ApiError(503, 'Mobile money payments are not enabled. Please contact reception.');
  }
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const paymentId = parseInteger(req.params.paymentId, 'paymentId', { min: 1 });
  const [rows] = await pool.query(
    'SELECT id, bill_id, patient_id, amount, status, failure_reason FROM payments WHERE id = ?',
    [paymentId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Payment not found');
  const payment = rows[0];
  // Scoped to the bill, which the route already scoped to this patient, so one
  // patient cannot read another's charge state by guessing an id.
  if (Number(payment.bill_id) !== id || Number(payment.patient_id) !== Number(req.patient.id)) {
    throw new ApiError(404, 'Payment not found');
  }

  if (req.query.sync !== undefined && payment.status === PENDING_PAYMENT_STATUS) {
    const adapter = getMobileMoneyAdapter();
    const [full] = await pool.query('SELECT transaction_reference FROM payments WHERE id = ?', [paymentId]);
    const result = await adapter.verifyCharge(full[0].transaction_reference);
    const outcome = await withTransaction(pool, async connection => applyGatewayResult({
      connection, req, paymentId, result,
    }));
    res.json({ status: outcome.payment.status, amount: Number(payment.amount), synced: true });
    return;
  }
  res.json({ status: payment.status, amount: Number(payment.amount), synced: false });
}));

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
  if (!identifier || !portalPin) throw new ApiError(400, 'MRN, access code, phone, or email and portal PIN are required');

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
    { pid: patient.id, portal: true, psv: patient.portal_session_version },
    process.env.JWT_SECRET,
    { expiresIn: process.env.PORTAL_JWT_EXPIRE || '24h' }
  );
  res.json({
    token,
    payments_enabled: paymentsEnabled(),
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

  const result = await withTransaction(pool, async connection => {
    // The check-in clock is the hospital's wall clock, not the server's UTC one,
    // and 'today' is the hospital's calendar day.
    const checkinTime = zonedDateTime();
    const today = zonedDate();
    const [todayAppointments] = await connection.query(
      `SELECT id, appointment_time, type, reason FROM appointments
       WHERE patient_id = ? AND appointment_date = ? AND status = 'scheduled'
       ORDER BY appointment_time ASC LIMIT 1`,
      [patient.id, today]
    );
    const [recentCheckins] = await connection.query(
      `SELECT * FROM checkins
       WHERE patient_id = ? AND checkin_date = ?
       ORDER BY id DESC LIMIT 1`,
      [patient.id, today]
    );

    let checkin = recentCheckins[0];
    if (checkin) {
      if (!['waiting', 'in_consultation'].includes(checkin.status)) {
        throw new ApiError(409, `Today's check-in is already ${checkin.status.replace('_', ' ')}. Please contact reception.`);
      }
      if (purpose) {
        await connection.query('UPDATE checkins SET purpose = ? WHERE id = ?', [purpose, checkin.id]);
        checkin.purpose = purpose;
      }
    } else {
      const [insertResult] = await connection.query(
        `INSERT INTO checkins
         (uuid, patient_id, appointment_id, checkin_time, checkin_date, purpose, status, qr_token)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)`,
        [
          randomUUID(), patient.id, todayAppointments[0]?.id || null, checkinTime, today,
          purpose || todayAppointments[0]?.type || 'visit', identifier,
        ]
      );
      const [created] = await connection.query('SELECT * FROM checkins WHERE id = ?', [insertResult.insertId]);
      checkin = created[0];
    }

    const [positionRows] = await connection.query(
      `SELECT COUNT(*) AS count FROM checkins
       WHERE checkin_date = ? AND status IN ('waiting', 'in_consultation') AND id <= ?`,
      [today, checkin.id]
    );
    return {
      checkin,
      todayAppointments,
      queuePosition: Number(positionRows[0].count),
    };
  });

  const { checkin, todayAppointments, queuePosition } = result;
  res.json({
    success: true,
    checked_in: true,
    queue_position: queuePosition,
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
  await withTransaction(pool, async connection => {
    const [rows] = await connection.query('SELECT status FROM checkins WHERE id = ?', [id]);
    if (rows.length === 0) throw new ApiError(404, 'Check-in not found');

    const currentStatus = rows[0].status;
    if (status !== currentStatus && !CHECKIN_TRANSITIONS[currentStatus]?.has(status)) {
      throw new ApiError(409, `Cannot transition check-in from ${currentStatus} to ${status}`);
    }

    const [updateResult] = await connection.query(
      'UPDATE checkins SET status = ? WHERE id = ? AND status = ?',
      [status, id, currentStatus]
    );
    if (updateResult.affectedRows === 0) {
      throw new ApiError(409, 'Check-in status changed while applying the transition. Please retry.');
    }
  });
  res.json({ message: 'Check-in status updated', id, status });
}));

router.get('/me', authenticatePortal, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, uuid, mrn, first_name, last_name, date_of_birth, gender, phone, email,
            blood_type, insurance_provider, insurance_number, allergies, chronic_conditions, address
     FROM patients WHERE id = ?`,
    [req.patient.id]
  );
  const hospitalToday = zonedDate();
  const [todayCheckins] = await pool.query(
    'SELECT * FROM checkins WHERE patient_id = ? AND checkin_date = ? ORDER BY id DESC LIMIT 1',
    [req.patient.id, hospitalToday]
  );
  const [aheadRows] = await pool.query(
    `SELECT COUNT(*) as count FROM checkins
     WHERE checkin_date = ? AND status IN ('waiting','in_consultation') AND id < ?`,
    [hospitalToday, todayCheckins[0]?.id || 0]
  );
  res.json({
    patient: rows[0],
    checkin: todayCheckins[0] || null,
    ahead_in_queue: aheadRows[0].count,
    payments_enabled: paymentsEnabled(),
    // Mobile money settles against a real provider rather than a stand-in, so
    // it carries its own gate and is advertised separately. This is the same
    // public config staff see: the provider name and network list, no secret.
    mobile_money: mobileMoneyPublicConfig(),
  });
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
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const paymentMethod = req.body?.payment_method || 'card';
  if (!isPaymentMethod(paymentMethod)) throw new ApiError(400, 'Invalid payment method');

  // Mobile money is a different shape of payment, not a different value for the
  // same one: the patient approves on their handset, so it starts a pending
  // charge instead of recording settled money straight away.
  if (paymentMethod === MOBILE_MONEY_METHOD) {
    await payBillByMobileMoney(req, res, id);
    return;
  }
  if (!paymentsEnabled()) {
    throw new ApiError(503, 'Online payments are not enabled. Please contact reception.');
  }

  const amount = Math.round((parseFiniteNumber(req.body?.amount, 'amount', { min: 0.01 }) + Number.EPSILON) * 100) / 100;
  const requestId = getRequestId(req, 'request_id', { required: true });
  const referenceNumber = `portal:${requestId}`;

  const payment = await withTransaction(pool, async connection => {
    const [existingPayment] = await connection.query(
      `SELECT p.bill_id, p.patient_id, p.amount, p.payment_method,
              b.net_amount, b.paid_amount
       FROM payments p JOIN bills b ON b.id = p.bill_id
       WHERE p.transaction_reference = ?`,
      [referenceNumber]
    );
    if (existingPayment.length > 0) {
      const existing = existingPayment[0];
      if (
        Number(existing.bill_id) !== id
        || Number(existing.patient_id) !== Number(req.patient.id)
        || Number(existing.amount) !== amount
        || existing.payment_method !== paymentMethod
      ) {
        throw new ApiError(409, 'request_id has already been used for a different payment');
      }
      return {
        success: true,
        replay: true,
        amount: Number(existing.amount),
        balance_remaining: Math.max(Number(existing.net_amount) - Number(existing.paid_amount), 0),
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
    await connection.query('UPDATE bills SET payment_method = COALESCE(payment_method, ?) WHERE id = ?', [paymentMethod, id]);
    const updatedBill = await recalculateBillPayment(connection, id);
    await recordAudit({
      req,
      connection,
      action: 'billing.portal_payment.recorded',
      table: 'payments',
      summary: `${paymentNumber} ${amount} by ${paymentMethod} for patient ${req.patient.id}`,
      after: {
        payment_number: paymentNumber,
        bill_id: id,
        amount,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        bill_paid_amount: updatedBill.paid_amount,
        bill_payment_status: updatedBill.payment_status,
      },
    });
    return {
      success: true,
      replay: false,
      amount,
      balance_remaining: Math.max(Number(updatedBill.net_amount) - Number(updatedBill.paid_amount), 0),
    };
  });

  res.json({ ...payment, message: 'Payment recorded successfully. Thank you!' });
}));

module.exports = router;
