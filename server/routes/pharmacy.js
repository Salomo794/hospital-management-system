const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validateMedicine, validateDispense } = require('../middleware/validation');
const audit = require('../utils/audit');

// Get all medicines
router.get('/medicines', authenticate, async (req, res) => {
  try {
    const { search, category, low_stock, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM medicines WHERE 1=1';
    const params = [];
    if (search) { query += ' AND (name LIKE ? OR generic_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (category) { query += ' AND category = ?'; params.push(category); }
    if (low_stock === 'true') { query += ' AND stock_quantity <= min_stock_level AND is_active = TRUE'; }
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
      "SELECT * FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = TRUE ORDER BY stock_quantity ASC"
    );
    const [expired] = await pool.query(
      "SELECT * FROM medicines WHERE expiry_date < date('now') AND is_active = TRUE"
    );
    res.json({ low_stock: rows, expired });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add medicine
router.post('/medicines', authenticate, authorize('admin', 'pharmacist'), validateMedicine, async (req, res) => {
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
        'INSERT INTO inventory_transactions (medicine_id, transaction_type, quantity, notes, performed_by) VALUES (?, "purchase", ?, "Initial stock", ?)',
        [result.insertId, stock_quantity, req.user.id]
      );
    }
    await audit.create(req.user.id, 'medicines', result.insertId, { name, stock_quantity }, req.ip);
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
    const [old] = await pool.query('SELECT * FROM medicines WHERE id = ?', [req.params.id]);
    if (old.length === 0) return res.status(404).json({ message: 'Medicine not found' });

    // Stock change => record inventory transaction (increase only for purchases)
    if (req.body.stock_quantity !== undefined && old[0].stock_quantity < req.body.stock_quantity) {
      const delta = req.body.stock_quantity - old[0].stock_quantity;
      await pool.query(
        'INSERT INTO inventory_transactions (medicine_id, transaction_type, quantity, notes, performed_by) VALUES (?, "purchase", ?, "Stock adjustment", ?)',
        [req.params.id, delta, req.user.id]
      );
    }

    values.push(req.params.id);
    await pool.query(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, values);
    await audit.update(req.user.id, 'medicines', req.params.id, old[0], req.body, req.ip);
    const [updated] = await pool.query('SELECT * FROM medicines WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Dispense medicine (atomic - stock update + prescription update + inventory log)
router.post('/dispense', authenticate, authorize('pharmacist', 'admin'), validateDispense, async (req, res) => {
  let conn;
  try {
    const { prescription_item_id, quantity } = req.body;
    const [pi] = await pool.query('SELECT * FROM prescription_items WHERE id = ?', [prescription_item_id]);
    if (pi.length === 0) return res.status(404).json({ message: 'Prescription item not found' });
    if (pi[0].dispensed) return res.status(400).json({ message: 'This prescription item has already been dispensed' });

    const [med] = await pool.query('SELECT * FROM medicines WHERE id = ?', [pi[0].medicine_id]);
    if (med.length === 0 || !med[0].is_active) return res.status(404).json({ message: 'Medicine not found' });
    if (med[0].stock_quantity < quantity) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?', [quantity, pi[0].medicine_id]);
    await conn.query("UPDATE prescription_items SET dispensed = TRUE, dispensed_date = datetime('now') WHERE id = ?", [prescription_item_id]);
    await conn.query(
      'INSERT INTO inventory_transactions (medicine_id, transaction_type, quantity, reference_number, performed_by) VALUES (?, "dispense", ?, ?, ?)',
      [pi[0].medicine_id, quantity, `RX-${prescription_item_id}`, req.user.id]
    );
    await conn.commit();
    conn.release();
    conn = null;

    await audit.custom(req.user.id, 'DISPENSE', 'prescription_items', prescription_item_id, { medicine_id: pi[0].medicine_id, quantity }, req.ip);
    res.json({ message: 'Medicine dispensed successfully' });
  } catch (error) {
    if (conn) {
      try { await conn.rollback(); conn = null; } catch (e) { /* ignore */ }
    }
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

// Smart stock-out prediction & reorder suggestions.
// Estimates each medicine's average daily consumption from dispensing history
// and projects the remaining days of stock. Medicines whose projected days
// remaining fall short of the lead-time buffer are pushed as reorder items.
router.get('/reorder-suggestions', authenticate, authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const [medicines] = await pool.query(
      `SELECT * FROM medicines WHERE is_active = TRUE ORDER BY name`
    );
    if (medicines.length === 0) return res.json({ suggestions: [], generated_at: new Date().toISOString() });

    const [consumption] = await pool.query(
      `SELECT medicine_id, COALESCE(SUM(quantity), 0) as qty
       FROM inventory_transactions
       WHERE transaction_type = 'dispense' AND created_at >= datetime('now', '-30 days')
       GROUP BY medicine_id`
    );
    const consumeByMed = Object.fromEntries(consumption.map(c => [c.medicine_id, c.qty]));

    const suggestions = medicines.map(m => {
      const daily = (consumeByMed[m.id] || 0) / 30;
      const stock = m.stock_quantity || 0;
      const daysLeft = daily > 0 ? Math.floor(stock / daily) : null;
      // Suggested order aims to reach ~30 day cover (or max_stock if lower),
      // always preserving the minimum stock as a safety buffer.
      const target = Math.min(m.max_stock_level || 1000, Math.max(m.min_stock_level || 10, Math.round(daily * 30)));
      const suggested = Math.max(0, target - stock);
      const urgency = daily === 0
        ? 'inactive'
        : (daysLeft <= 3 ? 'critical' : daysLeft <= 7 ? 'urgent' : daysLeft <= 14 ? 'warning' : 'healthy');
      return {
        id: m.id,
        name: m.name,
        generic_name: m.generic_name,
        category: m.category,
        unit: m.unit,
        stock_quantity: stock,
        min_stock_level: m.min_stock_level,
        max_stock_level: m.max_stock_level,
        daily_consumption: Math.round(daily * 100) / 100,
        days_left: daysLeft,
        suggested_order_quantity: suggested,
        urgency,
        forecast_date: daysLeft !== null ? new Date(Date.now() + daysLeft * 86400000).toISOString().split('T')[0] : null
      };
    });

    const rank = { critical: 0, urgent: 1, warning: 2, healthy: 3, inactive: 4 };
    suggestions.sort((a, b) => rank[a.urgency] - rank[b.urgency] || b.days_left - a.days_left);

    res.json({
      suggestions,
      summary: {
        critical: suggestions.filter(s => s.urgency === 'critical').length,
        urgent: suggestions.filter(s => s.urgency === 'urgent').length,
        warning: suggestions.filter(s => s.urgency === 'warning').length
      },
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;