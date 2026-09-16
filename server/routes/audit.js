const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { search, action, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT al.*, u.first_name, u.last_name, u.email
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1`;
    const params = [];
    if (search) {
      query += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR al.table_name LIKE ? OR al.action LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (action) { query += ' AND al.action = ?'; params.push(action); }
    const [countRes] = await pool.query(query.replace('SELECT al.*, u.first_name', 'SELECT COUNT(*) as total'), params);
    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ logs: rows, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/recent', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [topUsers] = await pool.query(
      `SELECT u.email, COUNT(*) as count FROM audit_log al
       JOIN users u ON al.user_id = u.id
       GROUP BY u.email ORDER BY count DESC LIMIT 5`
    );
    const [byAction] = await pool.query('SELECT action, COUNT(*) as count FROM audit_log GROUP BY action ORDER BY count DESC');
    const [byTable] = await pool.query(
      'SELECT table_name, COUNT(*) as count FROM audit_log WHERE table_name IS NOT NULL GROUP BY table_name ORDER BY count DESC'
    );
    const [recent] = await pool.query(
      `SELECT al.*, u.first_name, u.last_name FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       ORDER BY al.created_at DESC LIMIT 10`
    );
    res.json({ recent, topUsers, byAction, byTable });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;