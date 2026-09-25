const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { evaluateSafety } = require('../utils/safety');
const { ApiError, asyncHandler, getPagination, isDateOnly, parseFiniteNumber, parseInteger, withTransaction } = require('../utils/http');
const { getRequestId } = require('../utils/requestId');

const PHARMACY_ROLES = ['admin', 'pharmacist'];
const PHARMACY_READ_ROLES = ['admin', 'pharmacist', 'doctor', 'nurse'];

router.get('/medicines', authenticate, authorize(...PHARMACY_READ_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { search, category, low_stock } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (search) {
    where += ' AND (name LIKE ? OR generic_name LIKE ?)';
    const term = `%${String(search).trim().slice(0, 100)}%`;
    params.push(term, term);
  }
  if (category) { where += ' AND category = ?'; params.push(category); }
  if (low_stock === 'true') where += ' AND stock_quantity <= min_stock_level AND is_active = 1';

  const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM medicines ${where}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM medicines ${where} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ medicines: rows, total: countRows[0].total, page, limit });
}));

router.get('/alerts', authenticate, authorize(...PHARMACY_ROLES), asyncHandler(async (req, res) => {
  const [lowStock] = await pool.query(
    'SELECT * FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1 ORDER BY stock_quantity ASC'
  );
  const [expired] = await pool.query(
    "SELECT * FROM medicines WHERE expiry_date < date('now') AND is_active = 1"
  );
  res.json({ low_stock: lowStock, expired });
}));

router.post('/interactions/check', authenticate, authorize(...PHARMACY_READ_ROLES), asyncHandler(async (req, res) => {
  const { medicineIds } = req.body;
  if (!Array.isArray(medicineIds) || medicineIds.length < 2) {
    throw new ApiError(400, 'Provide at least two medicineIds to check');
  }
  const uniqueIds = [...new Set(medicineIds.map(value => parseInteger(value, 'medicineId', { min: 1 })))];
  if (uniqueIds.length < 2) throw new ApiError(400, 'Provide at least two distinct medicines to check');

  const placeholders = uniqueIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT di.id, di.severity, di.description, di.clinical_management,
            ma.id as medicine_a_id, ma.name as medicine_a, ma.generic_name as medicine_a_generic,
            mb.id as medicine_b_id, mb.name as medicine_b, mb.generic_name as medicine_b_generic
     FROM drug_interactions di
     JOIN medicines ma ON di.medicine_a_id = ma.id
     JOIN medicines mb ON di.medicine_b_id = mb.id
     WHERE (di.medicine_a_id IN (${placeholders}) AND di.medicine_b_id IN (${placeholders}))
        OR (di.medicine_b_id IN (${placeholders}) AND di.medicine_a_id IN (${placeholders}))`,
    [...uniqueIds, ...uniqueIds, ...uniqueIds, ...uniqueIds]
  );
  res.json({ interactions: rows, checkedIds: uniqueIds });
}));

router.get('/interactions/summary', authenticate, authorize(...PHARMACY_READ_ROLES), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT severity, COUNT(*) as count FROM drug_interactions GROUP BY severity');
  const summary = { mild: 0, moderate: 0, severe: 0, contraindicated: 0 };
  rows.forEach(row => { summary[row.severity] = row.count; });
  res.json({ summary, total: rows.reduce((sum, row) => sum + row.count, 0) });
}));

router.get('/interactions/:medicineId', authenticate, authorize(...PHARMACY_READ_ROLES), asyncHandler(async (req, res) => {
  const medicineId = parseInteger(req.params.medicineId, 'medicineId', { min: 1 });
  const [rows] = await pool.query(
    `SELECT di.id, di.severity, di.description, di.clinical_management,
            ma.id as medicine_a_id, ma.name as medicine_a, ma.generic_name as medicine_a_generic,
            mb.id as medicine_b_id, mb.name as medicine_b, mb.generic_name as medicine_b_generic
     FROM drug_interactions di
     JOIN medicines ma ON di.medicine_a_id = ma.id
     JOIN medicines mb ON di.medicine_b_id = mb.id
     WHERE di.medicine_a_id = ? OR di.medicine_b_id = ?
     ORDER BY CASE di.severity WHEN 'contraindicated' THEN 0 WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END`,
    [medicineId, medicineId]
  );
  res.json({ interactions: rows });
}));

router.post('/medicines', authenticate, authorize(...PHARMACY_ROLES), asyncHandler(async (req, res) => {
  const {
    name, generic_name, category, manufacturer, unit_price, cost_price, stock_quantity,
    min_stock_level, max_stock_level, unit, expiry_date, batch_number, requires_prescription,
  } = req.body;
  if (!name || !String(name).trim()) throw new ApiError(400, 'name is required');
  if (requires_prescription !== undefined && typeof requires_prescription !== 'boolean') {
    throw new ApiError(400, 'requires_prescription must be a boolean');
  }
  const price = parseFiniteNumber(unit_price, 'unit_price', { min: 0 });
  const cost = cost_price === undefined || cost_price === null || cost_price === '' ? 0 : parseFiniteNumber(cost_price, 'cost_price', { min: 0 });
  const stock = stock_quantity === undefined || stock_quantity === null || stock_quantity === '' ? 0 : parseInteger(stock_quantity, 'stock_quantity', { min: 0 });
  const minimum = min_stock_level === undefined || min_stock_level === null || min_stock_level === '' ? 10 : parseInteger(min_stock_level, 'min_stock_level', { min: 0 });
  const maximum = max_stock_level === undefined || max_stock_level === null || max_stock_level === '' ? 1000 : parseInteger(max_stock_level, 'max_stock_level', { min: minimum });
  if (expiry_date && !isDateOnly(expiry_date)) throw new ApiError(400, 'expiry_date must use YYYY-MM-DD');

  const medicine = await withTransaction(pool, async connection => {
    const [result] = await connection.query(
      `INSERT INTO medicines
       (name, generic_name, category, manufacturer, unit_price, cost_price, stock_quantity,
        min_stock_level, max_stock_level, unit, expiry_date, batch_number, requires_prescription)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        String(name).trim(), generic_name || null, category || null, manufacturer || null, price, cost,
        stock, minimum, maximum, unit || 'tablet', expiry_date || null, batch_number || null,
        requires_prescription === false ? 0 : 1,
      ]
    );
    if (stock > 0) {
      await connection.query(
        `INSERT INTO inventory_transactions
         (medicine_id, transaction_type, quantity, notes, performed_by)
         VALUES (?, 'purchase', ?, 'Initial stock', ?)`,
        [result.insertId, stock, req.user.id]
      );
    }
    const [created] = await connection.query('SELECT * FROM medicines WHERE id = ?', [result.insertId]);
    return created[0];
  });
  res.status(201).json(medicine);
}));

router.put('/medicines/:id', authenticate, authorize(...PHARMACY_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [existingRows] = await pool.query('SELECT * FROM medicines WHERE id = ?', [id]);
  if (existingRows.length === 0) throw new ApiError(404, 'Medicine not found');
  const existing = existingRows[0];

  const allowed = [
    'name', 'generic_name', 'category', 'manufacturer', 'unit_price', 'cost_price',
    'stock_quantity', 'min_stock_level', 'max_stock_level', 'unit', 'expiry_date',
    'batch_number', 'requires_prescription', 'is_active',
  ];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] === undefined) continue;
    let value = req.body[field];
    if (field === 'unit_price' || field === 'cost_price') value = parseFiniteNumber(value, field, { min: 0 });
    if (['stock_quantity', 'min_stock_level', 'max_stock_level'].includes(field)) value = parseInteger(value, field, { min: 0 });
    if (['requires_prescription', 'is_active'].includes(field) && typeof value !== 'boolean') {
      throw new ApiError(400, `${field} must be a boolean`);
    }
    if (field === 'name' && !String(value).trim()) throw new ApiError(400, 'name cannot be empty');
    if (field === 'expiry_date' && value && !isDateOnly(value)) throw new ApiError(400, 'expiry_date must use YYYY-MM-DD');
    updates[field] = value;
  }
  if (Object.keys(updates).length === 0) throw new ApiError(400, 'Nothing to update');
  const minimum = updates.min_stock_level ?? existing.min_stock_level;
  const maximum = updates.max_stock_level ?? existing.max_stock_level;
  if (maximum < minimum) throw new ApiError(400, 'max_stock_level must be at least min_stock_level');

  const medicine = await withTransaction(pool, async connection => {
    const fields = Object.keys(updates);
    const values = fields.map(field => updates[field]);
    values.push(id);
    const [result] = await connection.query(
      `UPDATE medicines SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE id = ?`,
      values
    );
    if (result.affectedRows !== 1) throw new ApiError(404, 'Medicine not found');
    if (updates.stock_quantity !== undefined && updates.stock_quantity !== existing.stock_quantity) {
      const difference = updates.stock_quantity - existing.stock_quantity;
      await connection.query(
        `INSERT INTO inventory_transactions
         (medicine_id, transaction_type, quantity, notes, performed_by)
         VALUES (?, ?, ?, 'Manual inventory adjustment', ?)`,
        [id, difference >= 0 ? 'purchase' : 'adjustment', difference, req.user.id]
      );
    }
    const [updated] = await connection.query('SELECT * FROM medicines WHERE id = ?', [id]);
    return updated[0];
  });
  res.json(medicine);
}));

router.post('/dispense', authenticate, authorize('pharmacist'), asyncHandler(async (req, res) => {
  const prescriptionItemId = parseInteger(req.body?.prescription_item_id, 'prescription_item_id', { min: 1 });
  const quantity = parseInteger(req.body?.quantity, 'quantity', { min: 1 });
  const requestId = getRequestId(req, 'request_id', { required: true });
  const referenceNumber = `dispense:${requestId}`;

  const result = await withTransaction(pool, async connection => {
    const [items] = await connection.query(
      `SELECT pi.*, pr.patient_id, pr.status as prescription_status,
              m.name as medicine_name, m.stock_quantity, m.is_active as medicine_active, m.expiry_date
       FROM prescription_items pi
       JOIN prescriptions pr ON pr.id = pi.prescription_id
       JOIN medicines m ON m.id = pi.medicine_id
       WHERE pi.id = ?`,
      [prescriptionItemId]
    );
    if (items.length === 0) throw new ApiError(404, 'Prescription item not found');
    const item = items[0];

    const [replayRows] = await connection.query(
      `SELECT it.id, it.quantity, it.medicine_id, it.prescription_item_id
       FROM inventory_transactions it
       WHERE it.reference_number = ? AND it.transaction_type = 'dispense'`,
      [referenceNumber]
    );
    if (replayRows.length > 0) {
      if (
        Number(replayRows[0].prescription_item_id) !== Number(item.id)
        || Number(replayRows[0].medicine_id) !== Number(item.medicine_id)
        || Number(replayRows[0].quantity) !== quantity
      ) {
        throw new ApiError(409, 'request_id has already been used for a different dispense request');
      }
      return {
        replay: true,
        safety: null,
        quantity: Number(replayRows[0].quantity),
        remaining: Number(item.quantity) - Number(item.dispensed_quantity || 0),
      };
    }

    if (item.prescription_status !== 'active') throw new ApiError(409, 'This prescription is not active');
    if (!item.medicine_active) throw new ApiError(409, 'This medicine is inactive');
    if (item.expiry_date && item.expiry_date < new Date().toISOString().slice(0, 10)) {
      throw new ApiError(409, 'This medicine has expired');
    }

    const dispensedQuantity = Number(item.dispensed_quantity || 0);
    const prescriptionQuantity = Number(item.quantity);
    const remaining = prescriptionQuantity - dispensedQuantity;
    if (remaining <= 0) throw new ApiError(409, 'This prescription item has already been fully dispensed');
    if (quantity > remaining) throw new ApiError(400, `Only ${remaining} unit(s) remain to be dispensed`);

    const [activeMedicines] = await connection.query(
      `SELECT DISTINCT pi2.medicine_id
       FROM prescription_items pi2
       JOIN prescriptions pr2 ON pi2.prescription_id = pr2.id
       WHERE pr2.patient_id = ? AND pr2.status = 'active' AND pi2.dispensed_quantity < pi2.quantity`,
      [item.patient_id]
    );
    const medicineIds = [...new Set([...activeMedicines.map(row => row.medicine_id), item.medicine_id])];
    const safety = await evaluateSafety(item.patient_id, medicineIds, connection);
    if (safety.blocking && req.body.acknowledge_warnings !== true) {
      return { safety_blocked: true, safety };
    }

    const [stockUpdate] = await connection.query(
      'UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
      [quantity, item.medicine_id, quantity]
    );
    if (stockUpdate.affectedRows !== 1) throw new ApiError(409, 'Insufficient stock');

    const newDispensedQuantity = dispensedQuantity + quantity;
    const [itemUpdate] = await connection.query(
      `UPDATE prescription_items
       SET dispensed_quantity = ?, dispensed = ?, dispensed_date = CASE WHEN ? >= quantity THEN datetime('now') ELSE dispensed_date END
       WHERE id = ? AND prescription_id = ? AND dispensed_quantity = ?`,
      [newDispensedQuantity, newDispensedQuantity >= prescriptionQuantity ? 1 : 0, newDispensedQuantity, prescriptionItemId, item.prescription_id, dispensedQuantity]
    );
    if (itemUpdate.affectedRows !== 1) throw new ApiError(409, 'The prescription item changed while dispensing; reload and try again');

    await connection.query(
      `INSERT INTO inventory_transactions
       (medicine_id, prescription_item_id, transaction_type, quantity, reference_number, performed_by)
       VALUES (?, ?, 'dispense', ?, ?, ?)`,
      [item.medicine_id, prescriptionItemId, quantity, referenceNumber, req.user.id]
    );

    const [pending] = await connection.query(
      'SELECT COUNT(*) as count FROM prescription_items WHERE prescription_id = ? AND dispensed_quantity < quantity',
      [item.prescription_id]
    );
    if (pending[0].count === 0) {
      await connection.query("UPDATE prescriptions SET status = 'completed' WHERE id = ?", [item.prescription_id]);
    }
    return { replay: false, safety, quantity, remaining: prescriptionQuantity - newDispensedQuantity };
  });

  if (result.safety_blocked) {
    return res.status(409).json({
      message: 'Safety alert: dispensing this medicine conflicts with a recorded allergy or a contraindicated interaction.',
      warnings: result.safety.warnings,
      requires_acknowledgement: true,
    });
  }

  res.json({
    message: 'Medicine dispensed successfully',
    warnings: result.safety?.warnings || [],
    acknowledged: req.body.acknowledge_warnings === true,
    replay: result.replay,
    quantity: result.quantity,
    remaining: result.remaining,
  });
}));

router.get('/transactions', authenticate, authorize(...PHARMACY_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { medicine_id } = req.query;
  let where = '';
  const params = [];
  if (medicine_id) {
    where = 'WHERE it.medicine_id = ?';
    params.push(parseInteger(medicine_id, 'medicine_id', { min: 1 }));
  }
  const [rows] = await pool.query(
    `SELECT it.*, m.name as medicine_name, u.first_name, u.last_name
     FROM inventory_transactions it JOIN medicines m ON it.medicine_id = m.id
     LEFT JOIN users u ON it.performed_by = u.id ${where}
     ORDER BY it.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ transactions: rows, page, limit });
}));

module.exports = router;
