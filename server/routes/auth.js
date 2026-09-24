const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validateRegistration } = require('../middleware/validation');
const { ApiError, asyncHandler } = require('../utils/http');
const { randomUUID } = require('../utils/ids');
const { FixedWindowRateLimiter } = require('../utils/rateLimiter');

const loginByIdentifier = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const loginByIp = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

router.post('/register', authenticate, authorize('admin'), validateRegistration, asyncHandler(async (req, res) => {
  const { email, password, first_name, last_name, role, phone } = req.body;
  const normalizedEmail = String(email).trim().toLowerCase();
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing.length > 0) {
    throw new ApiError(409, 'Email already registered');
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const uuid = randomUUID();
  const [result] = await pool.query(
    'INSERT INTO users (uuid, email, password, role, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuid, normalizedEmail, hashedPassword, role, first_name.trim(), last_name.trim(), phone || null]
  );

  res.status(201).json({
    user: { id: result.insertId, uuid, email: normalizedEmail, role, first_name, last_name },
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required');
  }

  const identifierKey = `identifier:${email}`;
  const ipKey = `ip:${req.ip}`;
  const identifierLimit = loginByIdentifier.consume(identifierKey);
  const ipLimit = loginByIp.consume(ipKey);
  if (!identifierLimit.allowed || !ipLimit.allowed) {
    res.setHeader('Retry-After', Math.max(identifierLimit.retryAfterSeconds, ipLimit.retryAfterSeconds));
    throw new ApiError(429, 'Too many login attempts. Please try again later.');
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;
  if (!user || !passwordMatches || !user.is_active) {
    throw new ApiError(user && !user.is_active ? 403 : 401, user && !user.is_active ? 'Account deactivated' : 'Invalid credentials');
  }

  loginByIdentifier.reset(identifierKey);
  loginByIp.reset(ipKey);
  await pool.query("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);
  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
  res.json({
    token,
    user: {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
    },
  });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, uuid, email, role, first_name, last_name, phone, avatar, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  res.json(rows[0]);
}));

router.put('/change-password', authenticate, asyncHandler(async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPassword || newPassword.length < 8) {
    throw new ApiError(400, 'Current password is required and new password must be at least 8 characters');
  }

  const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
  if (rows.length === 0 || !(await bcrypt.compare(currentPassword, rows[0].password))) {
    throw new ApiError(400, 'Current password is incorrect');
  }
  if (await bcrypt.compare(newPassword, rows[0].password)) {
    throw new ApiError(400, 'New password must be different from the current password');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
  res.json({ message: 'Password updated successfully' });
}));

module.exports = router;
