const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const {
  ApiError, asyncHandler, getPagination, isDateOnly, parseFiniteNumber, parseInteger, withTransaction,
} = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');
const { PAYMENT_METHODS, isPaymentMethod, PENDING_PAYMENT_STATUS, COMPLETED_PAYMENT_STATUS } = require('../config/paymentMethods');
const { isMobileMoneyEnabled, publicConfig: mobileMoneyPublicConfig, paystackSettings } = require('../config/mobileMoney');
const {
  getAdapter: getMobileMoneyAdapter,
  interpretGatewayStatus,
} = require('../services/mobileMoney');
const {
  validateRequest: validateMobileMoneyRequest,
  createPendingPayment,
  requestChargeFromProvider,
  attachProviderReference,
  applyGatewayResult,
  cancelPendingPayment,
} = require('../services/mobileMoneyPayments');
const { recordAudit, pick } = require('../utils/audit');
const { money, recalculateBillPayment } = require('../utils/bills');

const BILLING_ROLES = ['admin', 'receptionist'];
const BILL_STATUSES = ['pending', 'partial', 'paid', 'cancelled'];

// Rejects the request outright when no provider is configured, so the UI and
// the API agree on availability instead of the form failing at submit time.
function requireMobileMoney() {
  if (!isMobileMoneyEnabled()) {
    throw new ApiError(503, 'Mobile money payments are not enabled on this server');
  }
  return getMobileMoneyAdapter();
}

router.get('/', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, patient_id, from_date, to_date } = req.query;
  if (status && !BILL_STATUSES.includes(status)) throw new ApiError(400, 'Invalid bill status');
  for (const [name, value] of Object.entries({ from_date, to_date })) {
    if (value && !isDateOnly(value)) throw new ApiError(400, `${name} must use YYYY-MM-DD`);
  }
  if (from_date && to_date && from_date > to_date) throw new ApiError(400, 'from_date cannot be after to_date');

  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND b.payment_status = ?'; params.push(status); }
  if (patient_id) {
    where += ' AND b.patient_id = ?';
    params.push(parseInteger(patient_id, 'patient_id', { min: 1 }));
  }
  if (from_date) { where += ' AND date(b.created_at) >= ?'; params.push(from_date); }
  if (to_date) { where += ' AND date(b.created_at) <= ?'; params.push(to_date); }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM bills b JOIN patients p ON b.patient_id = p.id ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT b.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
     FROM bills b JOIN patients p ON b.patient_id = p.id ${where}
     ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ bills: rows, total: countRows[0].total, page, limit });
}));

router.get('/summary', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const [pending] = await pool.query(
    `SELECT COUNT(*) AS unpaid_count,
            COALESCE(SUM(CASE WHEN net_amount > paid_amount THEN net_amount - paid_amount ELSE 0 END), 0) AS pending_amount
     FROM bills WHERE payment_status IN ('pending','partial')`
  );
  // Net of refunds, so the cash figure matches what is actually banked.
  const [collected] = await pool.query(
    `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE date(payment_date) = date('now')), 0)
            - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE date(refund_date) = date('now')), 0)
            AS collected_today`
  );
  res.json({
    unpaid_count: pending[0].unpaid_count,
    pending_amount: money(pending[0].pending_amount),
    collected_today: money(collected[0].collected_today),
  });
}));

// Declared before '/:id' so the literal path is not swallowed by the bill lookup.
router.get('/payment-methods', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  res.json({ payment_methods: PAYMENT_METHODS });
}));

// Whether the mobile money form should be offered, and with which networks.
// Safe to expose to staff: it carries no secret, only the provider name.
router.get('/mobile-money/config', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  res.json(mobileMoneyPublicConfig());
}));

// The provider's settlement callback. Authenticated by an HMAC signature over
// the raw body rather than by a session, because the caller is Paystack's
// servers, not a logged-in user. Declared before '/:id' for the same reason as
// '/payment-methods'.
router.post('/mobile-money/webhook', asyncHandler(async (req, res) => {
  const adapter = requireMobileMoney();
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from('');
  if (rawBody.length === 0) throw new ApiError(400, 'Webhook body is empty');
  if (!adapter.verifyWebhook(rawBody, req.get('x-paystack-signature') || req.get('x-mock-signature'))) {
    throw new ApiError(401, 'Invalid mobile money webhook signature');
  }

  // The signature proves the message is genuine but says nothing about whether
  // we understand it, so a replayed or unrecognised event is recorded and
  // acknowledged rather than retried forever.
  const event = String(req.body?.event || '');
  const data = req.body?.data || {};
  const reference = data.reference ? String(data.reference) : null;
  if (!reference) {
    res.json({ received: true, handled: false, reason: 'no reference' });
    return;
  }

  const [rows] = await pool.query('SELECT id, status FROM payments WHERE transaction_reference = ?', [reference]);
  if (rows.length === 0) {
    res.json({ received: true, handled: false, reason: 'unknown reference' });
    return;
  }
  const payment = rows[0];

  // A replayed delivery for a charge that has already settled changes nothing.
  if (payment.status !== PENDING_PAYMENT_STATUS) {
    res.json({ received: true, handled: true, replay: true, status: payment.status });
    return;
  }

  const result = interpretGatewayStatus(data, reference);
  const outcome = await withTransaction(pool, async connection => applyGatewayResult({
    connection, req, paymentId: payment.id, result,
  }));
  res.json({ received: true, handled: true, status: outcome.payment.status });
}));

// Current state of a mobile money charge. `?sync=1` asks the provider directly,
// which is what the UI does when a patient says they have approved the prompt
// but nothing has arrived yet.
router.get('/mobile-money/payments/:paymentId', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const adapter = requireMobileMoney();
  const paymentId = parseInteger(req.params.paymentId, 'paymentId', { min: 1 });
  const [rows] = await pool.query(
    `SELECT p.*, b.payment_status as bill_status, b.net_amount, b.paid_amount as bill_paid_amount
     FROM payments p JOIN bills b ON b.id = p.bill_id WHERE p.id = ?`,
    [paymentId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Payment not found');
  const payment = rows[0];
  if (payment.payment_method !== 'mobile_money') throw new ApiError(400, 'Not a mobile money payment');

  if (req.query.sync !== undefined && payment.status === PENDING_PAYMENT_STATUS) {
    const result = await adapter.verifyCharge(payment.transaction_reference);
    const outcome = await withTransaction(pool, async connection => applyGatewayResult({
      connection, req, paymentId, result,
    }));
    res.json({ payment: outcome.payment, bill: outcome.bill, synced: true });
    return;
  }
  res.json({ payment, synced: false });
}));

router.post('/mobile-money/payments/:paymentId/cancel', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  requireMobileMoney();
  const paymentId = parseInteger(req.params.paymentId, 'paymentId', { min: 1 });
  const outcome = await withTransaction(pool, async connection => cancelPendingPayment({
    connection, req, paymentId,
  }));
  res.json({ payment: outcome.payment, bill: outcome.bill });
}));

// Sends the approval prompt. The amount is always the full outstanding balance
// and the customer approves it on their own handset, so this returns before the
// money has moved and leaves a 'pending' row behind for the webhook to settle.
router.post('/:id/mobile-money', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const adapter = requireMobileMoney();
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const { phone, network, email } = validateMobileMoneyRequest(req.body || {});
  // The charge is always the full balance. An amount sent alongside it is
  // checked rather than ignored, because silently discarding a typed figure
  // would take more money than the operator asked for.
  const requestedAmount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
    ? null
    : money(parseFiniteNumber(req.body.amount, 'amount', { min: 0.01 }));

  const pending = await withTransaction(pool, async connection => {
    const [bills] = await connection.query('SELECT * FROM bills WHERE id = ?', [id]);
    if (bills.length === 0) throw new ApiError(404, 'Bill not found');
    const bill = bills[0];
    if (bill.payment_status === 'cancelled') throw new ApiError(409, 'Payments cannot be recorded for a cancelled bill');
    const outstanding = money(Number(bill.net_amount) - Number(bill.paid_amount));
    if (outstanding <= 0) throw new ApiError(409, 'This bill has no outstanding balance');
    return createPendingPayment({
      connection,
      req,
      bill: { ...bill, outstanding },
      amount: requestedAmount === null ? outstanding : requestedAmount,
      phone,
      network,
      email,
      receivedBy: req.user.id,
      notes: `Mobile money request to ${network} ending ${String(phone).slice(-4)}`,
    });
  });

  // The provider call runs with no transaction open. If it fails the pending
  // row is failed rather than deleted, so the attempt is still auditable and
  // the customer can be asked to try again.
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

  const outcome = await withTransaction(pool, async connection => {
    await attachProviderReference({
      connection,
      paymentId: pending.paymentId,
      provider: charge.adapter.name,
      providerReference: charge.result.providerReference,
    });
    await recordAudit({
      req,
      connection,
      action: 'billing.mobile_money.requested',
      table: 'payments',
      recordId: pending.paymentId,
      summary: `${pending.paymentNumber} ${pending.amount} via ${network}`,
      after: {
        payment_number: pending.paymentNumber,
        bill_id: id,
        amount: pending.amount,
        network,
        provider: charge.adapter.name,
        provider_reference: charge.result.providerReference,
        status: PENDING_PAYMENT_STATUS,
      },
    });
    return recalculateBillPayment(connection, id);
  });

  res.status(202).json({
    payment: { id: pending.paymentId, payment_number: pending.paymentNumber, amount: pending.amount, status: PENDING_PAYMENT_STATUS },
    bill: outcome,
    authorization_url: charge.result.authorizationUrl,
    // The customer still has to approve on their handset, so this is accepted
    // rather than created, and nothing counts towards the bill until then.
    message: 'Approval request sent. Waiting for the customer to authorise it on their phone.',
  });
}));

router.get('/:id', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [bill] = await pool.query(
    `SELECT b.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
            p.phone as patient_phone, p.email as patient_email, p.address as patient_address
     FROM bills b JOIN patients p ON b.patient_id = p.id WHERE b.id = ?`,
    [id]
  );
  if (bill.length === 0) throw new ApiError(404, 'Bill not found');
  const [items] = await pool.query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [id]);
  const [payments] = await pool.query(
    `SELECT pay.*,
            COALESCE((SELECT SUM(amount) FROM payment_refunds r WHERE r.payment_id = pay.id), 0) AS refunded_amount,
            u.first_name as received_by_name, u.last_name as received_by_last_name
     FROM payments pay LEFT JOIN users u ON pay.received_by = u.id
     WHERE pay.bill_id = ? ORDER BY pay.payment_date DESC`,
    [id]
  );
  const [refunds] = await pool.query(
    `SELECT r.*, u.first_name as refunded_by_name, u.last_name as refunded_by_last_name
     FROM payment_refunds r LEFT JOIN users u ON r.refunded_by = u.id
     WHERE r.bill_id = ? ORDER BY r.refund_date DESC`,
    [id]
  );
  res.json({ ...bill[0], items, payments, refunds });
}));

router.post('/', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const { patient_id, appointment_id, items, discount, tax, payment_method, due_date, notes } = req.body;
  const patientId = parseInteger(patient_id, 'patient_id', { min: 1 });
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'At least one bill item is required');
  if (payment_method && !isPaymentMethod(payment_method)) throw new ApiError(400, 'Invalid payment method');
  if (due_date && !isDateOnly(due_date)) throw new ApiError(400, 'due_date must use YYYY-MM-DD');

  const normalizedItems = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ApiError(400, `Bill item ${index + 1} is invalid`);
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const category = typeof item.category === 'string' ? item.category.trim() : '';
    if (!description || !category) throw new ApiError(400, `Bill item ${index + 1} requires description and category`);
    const quantity = parseInteger(item.quantity ?? 1, `item ${index + 1} quantity`, { min: 1 });
    const unitPrice = money(parseFiniteNumber(item.unit_price, `item ${index + 1} unit_price`, { min: 0 }));
    const referenceId = item.reference_id === undefined || item.reference_id === null || item.reference_id === ''
      ? null
      : parseInteger(item.reference_id, `item ${index + 1} reference_id`, { min: 1 });
    return {
      description,
      category,
      referenceId,
      quantity,
      unitPrice,
      total: money(quantity * unitPrice),
    };
  });

  const totalAmount = money(normalizedItems.reduce((sum, item) => sum + item.total, 0));
  const discountAmount = money(discount === undefined || discount === null || discount === '' ? 0 : parseFiniteNumber(discount, 'discount', { min: 0 }));
  if (discountAmount > totalAmount) throw new ApiError(400, 'discount cannot exceed the subtotal');
  const taxableAmount = totalAmount - discountAmount;
  const taxAmount = money(tax === undefined || tax === null || tax === ''
    ? taxableAmount * 0.10
    : parseFiniteNumber(tax, 'tax', { min: 0 }));
  const netAmount = money(taxableAmount + taxAmount);
  if (!Number.isFinite(netAmount) || netAmount < 0) throw new ApiError(400, 'Bill net amount is invalid');

  const [patient] = await pool.query('SELECT id FROM patients WHERE id = ? AND status = ?', [patientId, 'active']);
  if (patient.length === 0) throw new ApiError(400, 'Patient not found or inactive');
  if (appointment_id !== undefined && appointment_id !== null && appointment_id !== '') {
    const appointmentId = parseInteger(appointment_id, 'appointment_id', { min: 1 });
    const [appointment] = await pool.query('SELECT id FROM appointments WHERE id = ? AND patient_id = ?', [appointmentId, patientId]);
    if (appointment.length === 0) throw new ApiError(400, 'Appointment does not belong to the selected patient');
  }

  const bill = await withTransaction(pool, async connection => {
    const uuid = randomUUID();
    const billNumber = generateRecordNumber('BIL');
    const [result] = await connection.query(
      `INSERT INTO bills
       (uuid, bill_number, patient_id, appointment_id, total_amount, discount, tax, net_amount,
        payment_method, due_date, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid, billNumber, patientId, appointment_id || null, totalAmount, discountAmount, taxAmount,
        netAmount, payment_method || null, due_date || null, notes || null, req.user.id,
      ]
    );
    for (const item of normalizedItems) {
      await connection.query(
        `INSERT INTO bill_items
         (bill_id, description, category, reference_id, quantity, unit_price, total)
         VALUES (?,?,?,?,?,?,?)`,
        [result.insertId, item.description, item.category, item.referenceId, item.quantity, item.unitPrice, item.total]
      );
    }
    const [created] = await connection.query('SELECT * FROM bills WHERE id = ?', [result.insertId]);
    const [createdItems] = await connection.query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [result.insertId]);
    await recordAudit({
      req,
      connection,
      action: 'billing.bill.created',
      table: 'bills',
      recordId: result.insertId,
      summary: `${billNumber} net ${netAmount} for patient ${patientId}`,
      after: {
        bill_number: billNumber,
        patient_id: patientId,
        total_amount: totalAmount,
        discount: discountAmount,
        tax: taxAmount,
        net_amount: netAmount,
        payment_method: payment_method || null,
        item_count: normalizedItems.length,
      },
    });
    return { ...created[0], items: createdItems };
  });
  res.status(201).json(bill);
}));

router.post('/:id/payments', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const amount = money(parseFiniteNumber(req.body?.amount, 'amount', { min: 0.01 }));
  const paymentMethod = req.body?.payment_method;
  if (!isPaymentMethod(paymentMethod)) throw new ApiError(400, 'Invalid payment method');
  const transactionReference = req.body?.transaction_reference ? String(req.body.transaction_reference).trim() : null;
  if (transactionReference && transactionReference.length > 150) throw new ApiError(400, 'transaction_reference is too long');

  const payment = await withTransaction(pool, async connection => {
    const [bills] = await connection.query('SELECT * FROM bills WHERE id = ?', [id]);
    if (bills.length === 0) throw new ApiError(404, 'Bill not found');
    const bill = bills[0];
    if (bill.payment_status === 'cancelled') throw new ApiError(409, 'Payments cannot be recorded for a cancelled bill');
    const outstanding = money(Number(bill.net_amount) - Number(bill.paid_amount));
    if (outstanding <= 0) throw new ApiError(409, 'This bill has no outstanding balance');
    if (amount > outstanding) throw new ApiError(400, `Payment cannot exceed the outstanding balance of ${outstanding}`);

    const uuid = randomUUID();
    const paymentNumber = generateRecordNumber('PAY');
    const [result] = await connection.query(
      `INSERT INTO payments
       (uuid, payment_number, bill_id, patient_id, amount, payment_method,
        transaction_reference, received_by, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuid, paymentNumber, id, bill.patient_id, amount, paymentMethod, transactionReference, req.user.id, req.body?.notes || null]
    );
    const updatedBill = await recalculateBillPayment(connection, id);
    await recordAudit({
      req,
      connection,
      action: 'billing.payment.recorded',
      table: 'payments',
      recordId: result.insertId,
      summary: `${paymentNumber} ${amount} by ${paymentMethod}`,
      after: {
        payment_number: paymentNumber,
        amount,
        payment_method: paymentMethod,
        transaction_reference: transactionReference,
        bill_id: id,
        bill_paid_amount: updatedBill.paid_amount,
        bill_payment_status: updatedBill.payment_status,
      },
    });
    return {
      payment: { id: result.insertId, uuid, payment_number: paymentNumber, amount },
      bill: updatedBill,
    };
  });
  res.status(201).json(payment);
}));

// Refunds are recorded as their own append-only rows rather than by deleting
// or editing the original payment, so the money trail stays intact. The
// original payment row is never destroyed and a reason is always required.
router.post('/payments/:paymentId/refund', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const paymentId = parseInteger(req.params.paymentId, 'paymentId', { min: 1 });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3) throw new ApiError(400, 'A refund reason of at least 3 characters is required');
  if (reason.length > 500) throw new ApiError(400, 'The refund reason is too long');
  const methodOverride = req.body?.payment_method;
  if (methodOverride !== undefined && methodOverride !== null && methodOverride !== '' && !isPaymentMethod(methodOverride)) {
    throw new ApiError(400, 'Invalid payment method');
  }

  const refund = await withTransaction(pool, async connection => {
    const [payments] = await connection.query(
      `SELECT pay.*,
              COALESCE((SELECT SUM(amount) FROM payment_refunds r WHERE r.payment_id = pay.id), 0) AS refunded_amount,
              b.payment_status as bill_status, b.net_amount, b.paid_amount as bill_paid_amount
       FROM payments pay JOIN bills b ON b.id = pay.bill_id
       WHERE pay.id = ?`,
      [paymentId]
    );
    if (payments.length === 0) throw new ApiError(404, 'Payment not found');
    const payment = payments[0];
    if (payment.bill_status === 'cancelled') throw new ApiError(409, 'Refunds cannot be recorded against a cancelled bill');
    // Only money that actually arrived can be given back. A pending or failed
    // mobile money charge never reached the hospital, so refunding it would
    // subtract from the bill a phantom payment was never counted in.
    if (payment.status !== COMPLETED_PAYMENT_STATUS) {
      throw new ApiError(409, `This payment is ${payment.status}, so there is nothing to refund`);
    }

    const refundable = money(Number(payment.amount) - Number(payment.refunded_amount));
    if (refundable <= 0) throw new ApiError(409, 'This payment has already been fully refunded');

    // Omitting the amount refunds everything still refundable.
    const requested = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
      ? refundable
      : money(parseFiniteNumber(req.body.amount, 'amount', { min: 0.01 }));
    if (requested > refundable) {
      throw new ApiError(400, `Refund cannot exceed the refundable balance of ${refundable}`);
    }

    // A refund normally goes back the way it came in, so default to the
    // original method rather than forcing the caller to restate it.
    const paymentMethod = methodOverride || payment.payment_method;
    const uuid = randomUUID();
    const refundNumber = generateRecordNumber('REF');
    const [result] = await connection.query(
      `INSERT INTO payment_refunds
         (uuid, refund_number, payment_id, bill_id, patient_id, amount, payment_method, reason, refunded_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        uuid, refundNumber, payment.id, payment.bill_id, payment.patient_id,
        requested, paymentMethod, reason, req.user.id,
      ]
    );
    const updatedBill = await recalculateBillPayment(connection, payment.bill_id);
    await recordAudit({
      req,
      connection,
      action: 'billing.payment.refunded',
      table: 'payment_refunds',
      recordId: result.insertId,
      summary: `${refundNumber} ${requested} against ${payment.payment_number}: ${reason}`,
      before: { bill_paid_amount: payment.bill_paid_amount, bill_payment_status: payment.bill_status },
      after: {
        refund_number: refundNumber,
        payment_id: payment.id,
        payment_number: payment.payment_number,
        amount: requested,
        payment_method: paymentMethod,
        reason,
        bill_paid_amount: updatedBill.paid_amount,
        bill_payment_status: updatedBill.payment_status,
      },
    });
    return {
      refund: {
        id: result.insertId,
        uuid,
        refund_number: refundNumber,
        payment_id: payment.id,
        amount: requested,
        payment_method: paymentMethod,
        reason,
        refunded_at: updatedBill.updated_at,
      },
      bill: updatedBill,
    };
  });
  res.status(201).json(refund);
}));

module.exports = router;
