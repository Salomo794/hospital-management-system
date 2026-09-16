const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validateUserUpdate } = require('../middleware/validation');
const audit = require('../utils/audit');

// Get all users (admin only)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = 'SELECT id, uuid, email, role, first_name, last_name, phone, is_active, last_login, created_at FROM users WHERE 1=1';
    const params = [];
    if (role) { query += ' AND role = ?'; params.push(role); }
    if (search) { query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const [countResult] = await pool.query(query.replace('SELECT id, uuid, email, role, first_name, last_name, phone, is_active, last_login, created_at', 'SELECT COUNT(*) as total'), params);
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ users: rows, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single user
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, email, role, first_name, last_name, phone, avatar, is_active, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user
router.put('/:id', authenticate, authorize('admin'), validateUserUpdate, async (req, res) => {
  try {
    const { first_name, last_name, phone, role, is_active } = req.body;
    const [old] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (old.length === 0) return res.status(404).json({ message: 'User not found' });

    // Prevent an admin deactivating themselves or changing their own role (lockout protection)
    if (String(req.params.id) === String(req.user.id)) {
      if (is_active === false || (role && role !== req.user.role)) {
        return res.status(400).json({ message: 'You cannot deactivate yourself or change your own role' });
      }
    }
    // Prevent deactivating the last active admin
    if (is_active === false && old[0].role === 'admin') {
      const [adminCount] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = TRUE");
      if (adminCount[0].count <= 1) {
        return res.status(400).json({ message: 'Cannot deactivate the last active admin' });
      }
    }

    await pool.query(
      'UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?',
      [first_name, last_name, phone, role, is_active, req.params.id]
    );
    await audit.update(req.user.id, 'users', req.params.id, old[0], { first_name, last_name, phone, role, is_active }, req.ip);
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete user
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }
    const [old] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (old.length === 0) return res.status(404).json({ message: 'User not found' });
    if (old[0].role === 'admin') {
      const [adminCount] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = TRUE");
      if (adminCount[0].count <= 1) {
        return res.status(400).json({ message: 'Cannot deactivate the last active admin' });
      }
    }
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [req.params.id]);
    await audit.delete(req.user.id, 'users', req.params.id, old[0], req.ip);
    res.json({ message: 'User deactivated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;