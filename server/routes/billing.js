const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const {
  ApiError, asyncHandler, getPagination, isDateOnly, parseFiniteNumber, parseInteger, withTransaction,
} = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');

const BILLING_ROLES = ['admin', 'receptionist'];
const BILL_STATUSES = ['pending', 'partial', 'paid', 'cancelled'];
const PAYMENT_METHODS = ['cash', 'card', 'insurance', 'online', 'bank_transfer', 'other'];

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
  const [collected] = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS collected_today FROM payments WHERE date(payment_date) = date('now')"
  );
  res.json({
    unpaid_count: pending[0].unpaid_count,
    pending_amount: money(pending[0].pending_amount),
    collected_today: money(collected[0].collected_today),
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
    `SELECT pay.*, u.first_name as received_by_name, u.last_name as received_by_last_name
     FROM payments pay LEFT JOIN users u ON pay.received_by = u.id
     WHERE pay.bill_id = ? ORDER BY pay.payment_date DESC`,
    [id]
  );
  res.json({ ...bill[0], items, payments });
}));

router.post('/', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const { patient_id, appointment_id, items, discount, tax, payment_method, due_date, notes } = req.body;
  const patientId = parseInteger(patient_id, 'patient_id', { min: 1 });
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'At least one bill item is required');
  if (payment_method && !PAYMENT_METHODS.includes(payment_method)) throw new ApiError(400, 'Invalid payment method');
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
    return { ...created[0], items: createdItems };
  });
  res.status(201).json(bill);
}));

router.post('/:id/payments', authenticate, authorize(...BILLING_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const amount = money(parseFiniteNumber(req.body?.amount, 'amount', { min: 0.01 }));
  const paymentMethod = req.body?.payment_method;
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new ApiError(400, 'Invalid payment method');
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
    const newPaid = money(Number(bill.paid_amount) + amount);
    const paymentStatus = newPaid >= Number(bill.net_amount) ? 'paid' : 'partial';
    await connection.query(
      'UPDATE bills SET paid_amount = ?, payment_status = ? WHERE id = ?',
      [newPaid, paymentStatus, id]
    );
    const [updatedBill] = await connection.query('SELECT * FROM bills WHERE id = ?', [id]);
    return {
      payment: { id: result.insertId, uuid, payment_number: paymentNumber, amount },
      bill: updatedBill[0],
    };
  });
  res.status(201).json(payment);
}));

module.exports = router;
