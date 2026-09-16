const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const {
  validateLabOrder, validateLabResults, validateLabTest
} = require('../middleware/validation');
const audit = require('../utils/audit');

function generateOrderNumber() {
  const prefix = 'LAB';
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${datePart}-${rand}`;
}

// Numeric abnormal-detection: parse reference ranges of the forms
// "70-100", "70 - 100 mg/dL", "<5.0", ">10", "4.5-11.0 10^9/L", "negative"
function evaluateAbnormal(resultValue, referenceRange) {
  if (!resultValue || !referenceRange) return false;
  const val = parseFloat(String(resultValue).replace(',', '.'));
  if (isNaN(val)) return false;

  const range = String(referenceRange).trim().toLowerCase();
  const rangeMatch = range.match(/([\d.]+)\s*(?:-|–|to|−)\s*([\d.]+)/);
  const lessthan = range.match(/<\s*([\d.]+)/);
  const greaterthan = range.match(/>\s*([\d.]+)/);
  const lessthanEq = range.match(/≤\s*([\d.]+)/);
  const greaterthanEq = range.match(/≥\s*([\d.]+)/);

  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1]);
    const high = parseFloat(rangeMatch[2]);
    return val < low || val > high;
  }
  if (lessthan) return val >= parseFloat(lessthan[1]);
  if (lessthanEq) return val > parseFloat(lessthanEq[1]);
  if (greaterthan) return val <= parseFloat(greaterthan[1]);
  if (greaterthanEq) return val < parseFloat(greaterthanEq[1]);

  // Qualitative results like "negative", "positive", "normal" - no numeric judgement
  return false;
}

// Get all lab tests
router.get('/tests', authenticate, async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = 'SELECT * FROM lab_tests WHERE is_active = TRUE';
    const params = [];
    if (category) { query += ' AND category = ?'; params.push(category); }
    if (search) { query += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    query += ' ORDER BY category, name';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add lab test
router.post('/tests', authenticate, authorize('admin'), validateLabTest, async (req, res) => {
  try {
    const { name, category, description, normal_range, unit, price, turnaround_time } = req.body;
    
    const [result] = await pool.query(
      'INSERT INTO lab_tests (name, category, description, normal_range, unit, price, turnaround_time) VALUES (?,?,?,?,?,?,?)',
      [name, category, description, normal_range, unit, price, turnaround_time || '24 hours']
    );
    await audit.create(req.user.id, 'lab_tests', result.insertId, { name, category }, req.ip);
    const [newTest] = await pool.query('SELECT * FROM lab_tests WHERE id = ?', [result.insertId]);
    res.status(201).json(newTest[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all lab orders
router.get('/orders', authenticate, async (req, res) => {
  try {
    const { status, patient_id, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT lo.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
      u.first_name as doctor_first_name, u.last_name as doctor_last_name,
      GROUP_CONCAT(lt.name, ', ') as test_names
      FROM lab_orders lo
      JOIN patients p ON lo.patient_id = p.id
      JOIN users u ON lo.doctor_id = u.id
      LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
      LEFT JOIN lab_tests lt ON loi.lab_test_id = lt.id WHERE 1=1`;
    const params = [];
    if (status) { query += ' AND lo.status = ?'; params.push(status); }
    if (patient_id) { query += ' AND lo.patient_id = ?'; params.push(patient_id); }
    // Lab technicians and doctors are restricted to relevant orders
    if (req.user.role === 'doctor') {
      query += ' AND lo.doctor_id = ?';
      params.push(req.user.id);
    }
    query += ' GROUP BY lo.id';
    const [countRes] = await pool.query(query.replace(/SELECT lo\.[\s\S]*?FROM lab_orders lo/, 'SELECT COUNT(*) as total FROM lab_orders lo').replace(/GROUP BY lo.id/, ''), params);
    query += ' ORDER BY lo.order_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ orders: rows, total: countRes[0]?.total || rows.length, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create lab order (atomic: order + items + notifications)
router.post('/orders', authenticate, authorize('doctor', 'admin', 'nurse'), validateLabOrder, async (req, res) => {
  let conn;
  try {
    const { patient_id, medical_record_id, test_ids, priority, clinical_notes } = req.body;
    const uuid = uuidv4();
    const order_number = generateOrderNumber();

    // Verify all requested tests exist before inserting anything
    const [tests] = await pool.query(
      `SELECT * FROM lab_tests WHERE id IN (${test_ids.map(() => '?').join(',')}) AND is_active = TRUE`,
      test_ids
    );
    if (tests.length !== new Set(test_ids.map(Number)).size) {
      return res.status(400).json({ message: 'One or more test IDs are invalid or inactive' });
    }
    const testById = Object.fromEntries(tests.map(t => [String(t.id), t]));

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO lab_orders (uuid, order_number, patient_id, doctor_id, medical_record_id, priority, clinical_notes)
       VALUES (?,?,?,?,?,?,?)`,
      [uuid, order_number, patient_id, req.user.id, medical_record_id || null, priority || 'routine', clinical_notes]
    );
    for (const testId of test_ids) {
      const test = testById[String(testId)];
      await conn.query(
        'INSERT INTO lab_order_items (lab_order_id, lab_test_id, reference_range, result_unit) VALUES (?,?,?,?)',
        [result.insertId, testId, test?.normal_range, test?.unit]
      );
    }
    // Notify lab technicians
    const [techs] = await pool.query("SELECT id FROM users WHERE role = 'lab_technician' AND is_active = TRUE");
    for (const tech of techs) {
      await pool.query(
        'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, "lab", "New Lab Order", ?, ?)',
        [tech.id, `New ${priority || 'routine'} lab order: ${order_number}`, `/laboratory/orders/${result.insertId}`]
      );
    }
    await conn.commit();
    conn.release();
    conn = null;

    await audit.create(req.user.id, 'lab_orders', result.insertId, { order_number, patient_id, test_ids }, req.ip);
    res.status(201).json({ id: result.insertId, uuid, order_number });
  } catch (error) {
    if (conn) {
      try { await conn.rollback(); conn = null; } catch (e) { /* ignore */ }
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single lab order with results
router.get('/orders/:id', authenticate, async (req, res) => {
  try {
    const [order] = await pool.query(
      `SELECT lo.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn as patient_mrn, p.gender as patient_gender,
        p.date_of_birth as patient_dob,
        u.first_name as doctor_first_name, u.last_name as doctor_last_name
        FROM lab_orders lo JOIN patients p ON lo.patient_id = p.id JOIN users u ON lo.doctor_id = u.id WHERE lo.id = ?`,
      [req.params.id]
    );
    if (order.length === 0) return res.status(404).json({ message: 'Order not found' });
    if (req.user.role === 'doctor' && order[0].doctor_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only view your own lab orders' });
    }
    const [items] = await pool.query(
      `SELECT loi.*, lt.name as test_name, lt.normal_range, lt.unit as test_unit, lt.category,
        t.first_name as technician_first_name, t.last_name as technician_last_name
        FROM lab_order_items loi
        JOIN lab_tests lt ON loi.lab_test_id = lt.id
        LEFT JOIN users t ON loi.technician_id = t.id WHERE loi.lab_order_id = ?`,
      [req.params.id]
    );
    res.json({ ...order[0], items });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update lab results (atomic - results + order status + notifications)
router.put('/orders/:id/results', authenticate, authorize('lab_technician', 'admin'), validateLabResults, async (req, res) => {
  let conn;
  try {
    const { items } = req.body;
    const [check] = await pool.query('SELECT * FROM lab_orders WHERE id = ?', [req.params.id]);
    if (check.length === 0) return res.status(404).json({ message: 'Order not found' });

    conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const item of items) {
      const is_abnormal = evaluateAbnormal(item.result_value, item.reference_range);
      await conn.query(
        `UPDATE lab_order_items SET result_value=?, result_unit=?, reference_range=?, is_abnormal=?, notes=?, technician_id=?, result_date=datetime('now') WHERE id=?`,
        [item.result_value, item.result_unit, item.reference_range, is_abnormal ? 1 : 0, item.notes, req.user.id, item.id]
      );
    }
    // Update order status
    await conn.query("UPDATE lab_orders SET status = 'completed', completed_date = datetime('now') WHERE id = ?", [req.params.id]);
    // Notify requesting doctor
    const [order] = await conn.query('SELECT doctor_id FROM lab_orders WHERE id = ?', [req.params.id]);
    if (order.length > 0) {
      await conn.query(
        'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, "lab", "Lab Results Ready", ?, ?)',
        [order[0].doctor_id, `Lab results for order #${req.params.id} are ready`, `/laboratory/orders/${req.params.id}`]
      );
    }
    await conn.commit();
    conn.release();
    conn = null;

    await audit.update(req.user.id, 'lab_orders', req.params.id, { status: check[0].status }, { status: 'completed' }, req.ip);
    res.json({ message: 'Results updated successfully' });
  } catch (error) {
    if (conn) {
      try { await conn.rollback(); conn = null; } catch (e) { /* ignore */ }
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;