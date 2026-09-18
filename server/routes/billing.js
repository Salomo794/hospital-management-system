const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

function generateBillNumber() {
  const prefix = 'BIL';
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${datePart}-${rand}`;
}

function generatePaymentNumber() {
  const prefix = 'PAY';
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${datePart}-${rand}`;
}

// Get all bills
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, patient_id, from_date, to_date, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT b.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
      FROM bills b JOIN patients p ON b.patient_id = p.id WHERE 1=1`;
    const params = [];
    if (status) { query += ' AND b.payment_status = ?'; params.push(status); }
    if (patient_id) { query += ' AND b.patient_id = ?'; params.push(patient_id); }
    if (from_date) { query += ' AND b.created_at >= ?'; params.push(from_date); }
    if (to_date) { query += ' AND b.created_at <= ?'; params.push(to_date + ' 23:59:59'); }
    const countQuery = query.replace(/SELECT b\.[\s\S]*?FROM bills b/, 'SELECT COUNT(*) as total FROM bills b');
    const [countRes] = await pool.query(countQuery, params);
    query += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ bills: rows, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single bill with items and payments
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [bill] = await pool.query(
      `SELECT b.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
        p.phone as patient_phone, p.email as patient_email, p.address as patient_address
        FROM bills b JOIN patients p ON b.patient_id = p.id WHERE b.id = ?`,
      [req.params.id]
    );
    if (bill.length === 0) return res.status(404).json({ message: 'Bill not found' });
    const [items] = await pool.query('SELECT * FROM bill_items WHERE bill_id = ?', [req.params.id]);
    const [payments] = await pool.query(
      `SELECT pay.*, u.first_name as received_by_name, u.last_name as received_by_last_name
       FROM payments pay LEFT JOIN users u ON pay.received_by = u.id WHERE pay.bill_id = ? ORDER BY pay.payment_date DESC`,
      [req.params.id]
    );
    res.json({ ...bill[0], items, payments });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create bill
router.post('/', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
  try {
    const { patient_id, appointment_id, items, discount, tax, payment_method, due_date, notes } = req.body;
    const uuid = uuidv4();
    const bill_number = generateBillNumber();
    const total_amount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const discountAmount = discount || 0;
    const taxAmount = tax || (total_amount - discountAmount) * 0.10;
    const net_amount = total_amount - discountAmount + taxAmount;
    const [result] = await pool.query(
      `INSERT INTO bills (uuid, bill_number, patient_id, appointment_id, total_amount, discount, tax,
        net_amount, payment_method, due_date, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuid, bill_number, patient_id, appointment_id || null, total_amount, discountAmount, taxAmount,
        net_amount, payment_method, due_date, notes, req.user.id]
    );
    for (const item of items) {
      await pool.query(
        'INSERT INTO bill_items (bill_id, description, category, reference_id, quantity, unit_price, total) VALUES (?,?,?,?,?,?,?)',
        [result.insertId, item.description, item.category, item.reference_id || null,
          item.quantity || 1, item.unit_price, (item.quantity || 1) * item.unit_price]
      );
    }
    const [newBill] = await pool.query('SELECT * FROM bills WHERE id = ?', [result.insertId]);
    const [newItems] = await pool.query('SELECT * FROM bill_items WHERE bill_id = ?', [result.insertId]);
    res.status(201).json({ ...newBill[0], items: newItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Record payment
router.post('/:id/payments', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
  try {
    const { amount, payment_method, transaction_reference, notes } = req.body;
    const uuid = uuidv4();
    const payment_number = generatePaymentNumber();
    const [bill] = await pool.query('SELECT * FROM bills WHERE id = ?', [req.params.id]);
    if (bill.length === 0) return res.status(404).json({ message: 'Bill not found' });
    const [result] = await pool.query(
      `INSERT INTO payments (uuid, payment_number, bill_id, patient_id, amount, payment_method,
        transaction_reference, received_by, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuid, payment_number, req.params.id, bill[0].patient_id, amount, payment_method,
        transaction_reference, req.user.id, notes]
    );
    const newPaid = parseFloat(bill[0].paid_amount) + parseFloat(amount);
    let paymentStatus = 'partial';
    if (newPaid > bill[0].net_amount) paymentStatus = 'overpaid';
    else if (newPaid >= bill[0].net_amount) paymentStatus = 'paid';
    await pool.query('UPDATE bills SET paid_amount = ?, payment_status = ? WHERE id = ?',
      [newPaid, paymentStatus, req.params.id]);
    const [updatedBill] = await pool.query('SELECT * FROM bills WHERE id = ?', [req.params.id]);
    res.status(201).json({ payment: { id: result.insertId, uuid, payment_number, amount }, bill: updatedBill[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
