const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validateRegistration, validateLogin, validateChangePassword } = require('../middleware/validation');
const { rateLimit } = require('../utils/rateLimiter');
const audit = require('../utils/audit');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many login attempts. Please try again later.' });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many registration attempts. Please try again later.' });

// Register
router.post('/register', registerLimiter, validateRegistration, async (req, res) => {
  try {
    const { email, password, first_name, last_name, role, phone } = req.body;
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const uuid = uuidv4();
    const [result] = await pool.query(
      'INSERT INTO users (uuid, email, password, role, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid, email, hashedPassword, role, first_name, last_name, phone]
    );
    const token = jwt.sign({ id: result.insertId, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
    await audit.create(req.user?.id, 'users', result.insertId, { email, role, first_name, last_name }, req.ip);
    res.status(201).json({
      token,
      user: { id: result.insertId, uuid, email, role, first_name, last_name }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', loginLimiter, validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      await audit.loginFailed(email, req.ip);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ message: 'Account deactivated' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await audit.loginFailed(email, req.ip);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    await pool.query("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);
    await audit.login(user.id, req.ip);
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
    res.json({
      token,
      user: {
        id: user.id, uuid: user.uuid, email: user.email, role: user.role,
        first_name: user.first_name, last_name: user.last_name, phone: user.phone
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, email, role, first_name, last_name, phone, avatar, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Change password
router.put('/change-password', authenticate, validateChangePassword, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const isMatch = await bcrypt.compare(currentPassword, rows[0].password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
    await audit.custom(req.user.id, 'CHANGE_PASSWORD', 'users', req.user.id, null, req.ip);
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;