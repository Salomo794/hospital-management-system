const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, getPagination, parseFiniteNumber, parseInteger, withTransaction } = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');

const LAB_ROLES = ['admin', 'doctor', 'nurse', 'lab_technician'];
const ORDER_STATUSES = ['ordered', 'in_progress', 'completed', 'cancelled'];
const PRIORITIES = ['routine', 'urgent', 'stat'];

function numericResult(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return null;
  // Results may be written as "1,234 mg/dL"; do not interpret qualitative
  // values such as "negative" as zero.
  const match = text.replace(/,/g, '').match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function referenceConstraints(referenceRange) {
  if (!referenceRange) return [];
  const normalized = String(referenceRange)
    .replace(/[≤‹]/g, '<=')
    .replace(/[≥›]/g, '>=')
    .replace(/[–—]/g, '-');
  const constraints = [];

  // Reference ranges are currently stored as free text. Parse each
  // comma/semicolon-separated component independently so panels such as
  // "Glucose 70-100, BUN 7-20" do not accidentally use only the first pair.
  for (const component of normalized.split(/[,;\n]+/)) {
    const text = component.trim();
    if (!text) continue;

    const range = text.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
    if (range) {
      constraints.push({ type: 'range', min: Math.min(Number(range[1]), Number(range[2])), max: Math.max(Number(range[1]), Number(range[2])) });
      continue;
    }

    const inequality = text.match(/(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)/);
    if (inequality) {
      constraints.push({ type: inequality[1], value: Number(inequality[2]) });
    }
  }
  return constraints;
}

function isResultAbnormal(resultValue, referenceRange) {
  const value = numericResult(resultValue);
  if (value === null) return false;
  const constraints = referenceConstraints(referenceRange);
  if (!constraints.length) return false;

  return constraints.some(constraint => {
    if (constraint.type === 'range') return value < constraint.min || value > constraint.max;
    if (constraint.type === '<') return value >= constraint.value;
    if (constraint.type === '<=') return value > constraint.value;
    if (constraint.type === '>') return value <= constraint.value;
    if (constraint.type === '>=') return value < constraint.value;
    return false;
  });
}

router.get('/tests', authenticate, authorize(...LAB_ROLES), asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  let query = 'SELECT * FROM lab_tests WHERE is_active = 1';
  const params = [];
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (search) {
    query += ' AND (name LIKE ? OR description LIKE ?)';
    const term = `%${String(search).trim().slice(0, 100)}%`;
    params.push(term, term);
  }
  query += ' ORDER BY category, name';
  const [rows] = await pool.query(query, params);
  res.json(rows);
}));

router.post('/tests', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { name, category, description, normal_range, unit, price, turnaround_time } = req.body;
  if (!name || !String(name).trim()) throw new ApiError(400, 'name is required');
  const testPrice = price === undefined || price === null || price === '' ? 0 : parseFiniteNumber(price, 'price', { min: 0 });
  const [result] = await pool.query(
    `INSERT INTO lab_tests (name, category, description, normal_range, unit, price, turnaround_time)
     VALUES (?,?,?,?,?,?,?)`,
    [String(name).trim(), category || null, description || null, normal_range || null, unit || null, testPrice, turnaround_time || '24 hours']
  );
  const [newTest] = await pool.query('SELECT * FROM lab_tests WHERE id = ?', [result.insertId]);
  res.status(201).json(newTest[0]);
}));

router.get('/orders', authenticate, authorize(...LAB_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, patient_id } = req.query;
  if (status && !ORDER_STATUSES.includes(status)) throw new ApiError(400, 'Invalid lab order status');

  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND lo.status = ?'; params.push(status); }
  if (patient_id) {
    where += ' AND lo.patient_id = ?';
    params.push(parseInteger(patient_id, 'patient_id', { min: 1 }));
  }
  if (req.user.role === 'doctor') {
    where += ' AND lo.doctor_id = ?';
    params.push(req.user.id);
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM lab_orders lo
     JOIN patients p ON lo.patient_id = p.id JOIN users u ON lo.doctor_id = u.id ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT lo.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
            u.first_name as doctor_first_name, u.last_name as doctor_last_name,
            GROUP_CONCAT(lt.name, ', ') as test_names
     FROM lab_orders lo
     JOIN patients p ON lo.patient_id = p.id
     JOIN users u ON lo.doctor_id = u.id
     LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
     LEFT JOIN lab_tests lt ON loi.lab_test_id = lt.id
     ${where} GROUP BY lo.id ORDER BY lo.order_date DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ orders: rows, total: countRows[0].total, page, limit });
}));

router.post('/orders', authenticate, authorize('doctor', 'admin', 'nurse'), asyncHandler(async (req, res) => {
  const { patient_id, medical_record_id, test_ids, priority = 'routine', clinical_notes, doctor_id } = req.body;
  const patientId = parseInteger(patient_id, 'patient_id', { min: 1 });
  if (!Array.isArray(test_ids) || test_ids.length === 0) {
    throw new ApiError(400, 'patient_id and at least one test_id are required');
  }
  if (!PRIORITIES.includes(priority)) throw new ApiError(400, 'Invalid lab priority');

  const normalizedTestIds = test_ids.map(value => parseInteger(value, 'test_id', { min: 1 }));
  const uniqueTestIds = [...new Set(normalizedTestIds)];
  if (uniqueTestIds.length !== normalizedTestIds.length) throw new ApiError(400, 'test_ids cannot contain duplicates');

  const doctorId = req.user.role === 'doctor'
    ? req.user.id
    : parseInteger(doctor_id, 'doctor_id', { min: 1 });
  const [[patient], [doctor]] = await Promise.all([
    pool.query('SELECT id FROM patients WHERE id = ? AND status = ?', [patientId, 'active']),
    pool.query("SELECT id FROM users WHERE id = ? AND role = 'doctor' AND is_active = 1", [doctorId]),
  ]);
  if (patient.length === 0) throw new ApiError(400, 'Patient not found or inactive');
  if (doctor.length === 0) throw new ApiError(400, 'Ordering doctor not found or inactive');

  if (medical_record_id !== undefined && medical_record_id !== null && medical_record_id !== '') {
    const recordId = parseInteger(medical_record_id, 'medical_record_id', { min: 1 });
    const [record] = await pool.query('SELECT id FROM medical_records WHERE id = ? AND patient_id = ?', [recordId, patientId]);
    if (record.length === 0) throw new ApiError(400, 'Medical record does not belong to the selected patient');
  }

  const placeholders = uniqueTestIds.map(() => '?').join(',');
  const [availableTests] = await pool.query(
    `SELECT id, normal_range, unit FROM lab_tests WHERE id IN (${placeholders}) AND is_active = 1`,
    uniqueTestIds
  );
  if (availableTests.length !== uniqueTestIds.length) {
    throw new ApiError(400, 'One or more selected lab tests do not exist or are inactive');
  }
  const testsById = new Map(availableTests.map(test => [test.id, test]));

  const order = await withTransaction(pool, async connection => {
    const uuid = randomUUID();
    const orderNumber = generateRecordNumber('LAB');
    const [result] = await connection.query(
      `INSERT INTO lab_orders (uuid, order_number, patient_id, doctor_id, medical_record_id, priority, clinical_notes)
       VALUES (?,?,?,?,?,?,?)`,
      [uuid, orderNumber, patientId, doctorId, medical_record_id || null, priority, clinical_notes || null]
    );
    for (const testId of uniqueTestIds) {
      const test = testsById.get(testId);
      await connection.query(
        'INSERT INTO lab_order_items (lab_order_id, lab_test_id, reference_range, result_unit) VALUES (?,?,?,?)',
        [result.insertId, testId, test.normal_range || null, test.unit || null]
      );
    }
    const [technicians] = await connection.query("SELECT id FROM users WHERE role = 'lab_technician' AND is_active = 1");
    for (const technician of technicians) {
      await connection.query(
        `INSERT INTO notifications (user_id, type, title, message, link)
         VALUES (?, 'lab', 'New Lab Order', ?, ?)`,
        [technician.id, `New ${priority} lab order: ${orderNumber}`, `/laboratory/orders/${result.insertId}`]
      );
    }
    return { id: result.insertId, uuid, order_number: orderNumber };
  });
  res.status(201).json(order);
}));

router.get('/orders/:id', authenticate, authorize(...LAB_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [order] = await pool.query(
    `SELECT lo.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
            p.mrn, p.mrn as patient_mrn,
            p.gender as patient_gender, p.date_of_birth as patient_dob,
            u.first_name as doctor_first_name, u.last_name as doctor_last_name
     FROM lab_orders lo JOIN patients p ON lo.patient_id = p.id JOIN users u ON lo.doctor_id = u.id
     WHERE lo.id = ?`,
    [id]
  );
  if (order.length === 0) throw new ApiError(404, 'Order not found');
  if (req.user.role === 'doctor' && order[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only view lab orders that you requested.');
  }
  const [items] = await pool.query(
    `SELECT loi.*, loi.id as order_item_id, lt.id as test_id, lt.name, lo.status,
            lo.status as order_status, loi.result_value, loi.result_value as result,
            lt.name as test_name, lt.normal_range, lt.unit as test_unit, lt.category,
            u.first_name as technician_first_name, u.last_name as technician_last_name
     FROM lab_order_items loi
     JOIN lab_orders lo ON lo.id = loi.lab_order_id
     JOIN lab_tests lt ON loi.lab_test_id = lt.id
     LEFT JOIN users u ON loi.technician_id = u.id
     WHERE loi.lab_order_id = ? ORDER BY loi.id`,
    [id]
  );
  res.json({ ...order[0], items });
}));

router.put('/orders/:id/results', authenticate, authorize('lab_technician', 'admin'), asyncHandler(async (req, res) => {
  const orderId = parseInteger(req.params.id, 'id', { min: 1 });
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'At least one lab result is required');

  const submitted = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new ApiError(400, 'Each result must be an object');
    const itemId = parseInteger(item.id, 'result item id', { min: 1 });
    if (submitted.has(itemId)) throw new ApiError(400, 'Duplicate result item IDs are not allowed');
    const resultValue = typeof item.result_value === 'string' ? item.result_value.trim() : String(item.result_value ?? '').trim();
    if (!resultValue) throw new ApiError(400, `result_value is required for item ${itemId}`);
    submitted.set(itemId, { resultValue, notes: item.notes || null });
  }

  const result = await withTransaction(pool, async connection => {
    const [orders] = await connection.query('SELECT * FROM lab_orders WHERE id = ?', [orderId]);
    if (orders.length === 0) throw new ApiError(404, 'Order not found');
    if (orders[0].status === 'completed') throw new ApiError(409, 'This order already has final results');
    if (orders[0].status === 'cancelled') throw new ApiError(409, 'Results cannot be entered for a cancelled order');

    const [expectedItems] = await connection.query(
      `SELECT loi.*, lt.normal_range AS catalog_reference_range, lt.unit AS catalog_unit
       FROM lab_order_items loi JOIN lab_tests lt ON lt.id = loi.lab_test_id
       WHERE loi.lab_order_id = ? ORDER BY loi.id`,
      [orderId]
    );
    const expectedIds = new Set(expectedItems.map(item => item.id));
    if (submitted.size !== expectedItems.length || [...submitted.keys()].some(id => !expectedIds.has(id))) {
      throw new ApiError(400, 'Results must contain every item belonging to this order exactly once');
    }

    for (const item of expectedItems) {
      const value = submitted.get(item.id);
      const referenceRange = item.catalog_reference_range || item.reference_range || null;
      const resultUnit = item.catalog_unit || item.result_unit || null;
      const isAbnormal = isResultAbnormal(value.resultValue, referenceRange);
      const [update] = await connection.query(
        `UPDATE lab_order_items
         SET result_value=?, result_unit=?, reference_range=?, is_abnormal=?, notes=?,
             technician_id=?, result_date=datetime('now')
         WHERE id=? AND lab_order_id=?`,
        [value.resultValue, resultUnit, referenceRange, isAbnormal, value.notes, req.user.id, item.id, orderId]
      );
      if (update.affectedRows !== 1) throw new ApiError(409, `Could not update lab result item ${item.id}`);
    }

    await connection.query(
      "UPDATE lab_orders SET status = 'completed', completed_date = datetime('now') WHERE id = ?",
      [orderId]
    );
    await connection.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES (?, 'lab', 'Lab Results Ready', ?, ?)`,
      [orders[0].doctor_id, 'Lab results are ready', `/laboratory/orders/${orderId}`]
    );
    return { message: 'Results updated successfully' };
  });
  res.json(result);
}));

module.exports = router;
