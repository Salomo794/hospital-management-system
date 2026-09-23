const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { evaluateSafety } = require('../utils/safety');

// Get all medicines
router.get('/medicines', authenticate, async (req, res) => {
  try {
    const { search, category, low_stock, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM medicines WHERE 1=1';
    const params = [];
    if (search) { query += ' AND (name LIKE ? OR generic_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (category) { query += ' AND category = ?'; params.push(category); }
    if (low_stock === 'true') { query += ' AND stock_quantity <= min_stock_level AND is_active = 1'; }
    const [countRes] = await pool.query(query.replace('SELECT *', 'SELECT COUNT(*) as total'), params);
    query += ' ORDER BY name LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ medicines: rows, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get low stock alerts
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1 ORDER BY stock_quantity ASC"
    );
    const [expired] = await pool.query(
      "SELECT * FROM medicines WHERE expiry_date < date('now') AND is_active = 1"
    );
    res.json({ low_stock: rows, expired });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Check for interactions among a set of medicines
// Body: { medicineIds: [1, 5, 12, ...] }
router.post('/interactions/check', authenticate, async (req, res) => {
  try {
    const { medicineIds } = req.body;
    if (!Array.isArray(medicineIds) || medicineIds.length < 2) {
      return res.status(400).json({ message: 'Provide at least two medicineIds to check' });
    }
    const uniqueIds = [...new Set(medicineIds.map(Number).filter(Boolean))];
    if (uniqueIds.length < 2) {
      return res.status(400).json({ message: 'Provide at least two distinct medicines to check' });
    }
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
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Summary counts of known interaction severity across the formulary
router.get('/interactions/summary', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT severity, COUNT(*) as count FROM drug_interactions GROUP BY severity"
    );
    const summary = { mild: 0, moderate: 0, severe: 0, contraindicated: 0 };
    rows.forEach(r => { summary[r.severity] = r.count; });
    res.json({ summary, total: rows.reduce((s, r) => s + r.count, 0) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// List all known interactions involving a specific medicine
router.get('/interactions/:medicineId', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT di.id, di.severity, di.description, di.clinical_management,
        ma.id as medicine_a_id, ma.name as medicine_a, ma.generic_name as medicine_a_generic,
        mb.id as medicine_b_id, mb.name as medicine_b, mb.generic_name as medicine_b_generic
       FROM drug_interactions di
       JOIN medicines ma ON di.medicine_a_id = ma.id
       JOIN medicines mb ON di.medicine_b_id = mb.id
       WHERE di.medicine_a_id = ? OR di.medicine_b_id = ?
       ORDER BY CASE di.severity WHEN 'contraindicated' THEN 0 WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END`,
      [req.params.medicineId, req.params.medicineId]
    );
    res.json({ interactions: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add medicine
router.post('/medicines', authenticate, authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const { name, generic_name, category, manufacturer, unit_price, cost_price, stock_quantity,
      min_stock_level, max_stock_level, unit, expiry_date, batch_number, requires_prescription } = req.body;
    const [result] = await pool.query(
      `INSERT INTO medicines (name, generic_name, category, manufacturer, unit_price, cost_price,
        stock_quantity, min_stock_level, max_stock_level, unit, expiry_date, batch_number, requires_prescription)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name, generic_name, category, manufacturer, unit_price, cost_price, stock_quantity,
        min_stock_level || 10, max_stock_level || 1000, unit || 'tablet', expiry_date, batch_number, requires_prescription !== false]
    );
    // Log inventory transaction
    if (stock_quantity > 0) {
      await pool.query(
        "INSERT INTO inventory_transactions (medicine_id, transaction_type, quantity, notes, performed_by) VALUES (?, 'purchase', ?, 'Initial stock', ?)",
        [result.insertId, stock_quantity, req.user.id]
      );
    }
    const [newMed] = await pool.query('SELECT * FROM medicines WHERE id = ?', [result.insertId]);
    res.status(201).json(newMed[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update medicine
router.put('/medicines/:id', authenticate, authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const fields = ['name','generic_name','category','manufacturer','unit_price','cost_price',
      'stock_quantity','min_stock_level','max_stock_level','unit','expiry_date','batch_number','requires_prescription','is_active'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    });
    if (updates.length === 0) return res.status(400).json({ message: 'Nothing to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, values);
    const [updated] = await pool.query('SELECT * FROM medicines WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Dispense medicine
router.post('/dispense', authenticate, authorize('pharmacist'), async (req, res) => {
  try {
    const { prescription_item_id, quantity, acknowledge_warnings } = req.body;
    const [pi] = await pool.query('SELECT * FROM prescription_items WHERE id = ?', [prescription_item_id]);
    if (pi.length === 0) return res.status(404).json({ message: 'Prescription item not found' });
    const [med] = await pool.query('SELECT * FROM medicines WHERE id = ?', [pi[0].medicine_id]);
    if (med[0].stock_quantity < quantity) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    const [pr] = await pool.query('SELECT patient_id FROM prescriptions WHERE id = ?', [pi[0].prescription_id]);
    const patientId = pr[0] && pr[0].patient_id;
    const [activeMeds] = await pool.query(
      `SELECT DISTINCT pi2.medicine_id
       FROM prescription_items pi2
       JOIN prescriptions pr2 ON pi2.prescription_id = pr2.id
       WHERE pr2.patient_id = ? AND pr2.status = 'active' AND pi2.dispensed = 0`,
      [patientId]
    );
    const medIds = [...new Set([...activeMeds.map((m) => m.medicine_id), pi[0].medicine_id])];
    const safety = await evaluateSafety(patientId, medIds);
    if (safety.blocking && !acknowledge_warnings) {
      return res.status(409).json({
        message: 'Safety alert: dispensing this medicine conflicts with a recorded allergy or a contraindicated interaction.',
        warnings: safety.warnings,
        requires_acknowledgement: true,
      });
    }

    await pool.query('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?', [quantity, pi[0].medicine_id]);
    await pool.query("UPDATE prescription_items SET dispensed = 1, dispensed_date = datetime('now') WHERE id = ?", [prescription_item_id]);
    await pool.query(
      "INSERT INTO inventory_transactions (medicine_id, transaction_type, quantity, reference_number, performed_by) VALUES (?, 'dispense', ?, ?, ?)",
      [pi[0].medicine_id, quantity, `RX-${prescription_item_id}`, req.user.id]
    );
    res.json({ message: 'Medicine dispensed successfully', warnings: safety.warnings, acknowledged: !!acknowledge_warnings });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Inventory transactions
router.get('/transactions', authenticate, authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const { medicine_id, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT it.*, m.name as medicine_name, u.first_name, u.last_name
      FROM inventory_transactions it JOIN medicines m ON it.medicine_id = m.id
      LEFT JOIN users u ON it.performed_by = u.id WHERE 1=1`;
    const params = [];
    if (medicine_id) { query += ' AND it.medicine_id = ?'; params.push(medicine_id); }
    query += ' ORDER BY it.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
