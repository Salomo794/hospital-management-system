const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, getPagination, parseInteger } = require('../utils/http');
const { recordAudit, pick } = require('../utils/audit');

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_technician'];
const AUDITED_FIELDS = ['email', 'role', 'first_name', 'last_name', 'phone', 'is_active'];

router.get('/', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { role, search } = req.query;
  if (role && !ROLES.includes(role)) throw new ApiError(400, 'Invalid role filter');

  let where = 'WHERE 1=1';
  const params = [];
  if (role) {
    where += ' AND role = ?';
    params.push(role);
  }
  if (search) {
    where += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
  }

  const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM users ${where}`, params);
  const [rows] = await pool.query(
    `SELECT id, uuid, email, role, first_name, last_name, phone, is_active, last_login, created_at, updated_at
     FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ users: rows, total: countRows[0].total, page, limit });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new ApiError(403, 'You may only view your own user profile.');
  }
  const [rows] = await pool.query(
    'SELECT id, uuid, email, role, first_name, last_name, phone, avatar, is_active, created_at FROM users WHERE id = ?',
    [id]
  );
  if (rows.length === 0) throw new ApiError(404, 'User not found');
  res.json(rows[0]);
}));

router.put('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const { first_name, last_name, phone, role, is_active } = req.body;
  if (role !== undefined && !ROLES.includes(role)) throw new ApiError(400, 'Invalid role');
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    throw new ApiError(400, 'is_active must be a boolean');
  }
  if (id === req.user.id && (is_active === false || (role && role !== 'admin'))) {
    throw new ApiError(400, 'You cannot deactivate or demote your own account');
  }
  if ((first_name !== undefined && !String(first_name).trim()) || (last_name !== undefined && !String(last_name).trim())) {
    throw new ApiError(400, 'first_name and last_name cannot be empty');
  }

  const updates = [];
  const values = [];
  for (const [field, value] of Object.entries({ first_name, last_name, phone, role, is_active })) {
    if (value !== undefined) {
      updates.push(`${field} = ?`);
      values.push(typeof value === 'string' && value.trim() ? value.trim() : value);
    }
  }
  if (updates.length === 0) throw new ApiError(400, 'No fields to update');
  const [existing] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  if (existing.length === 0) throw new ApiError(404, 'User not found');
  values.push(id);
  const [result] = await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  if (result.affectedRows === 0) throw new ApiError(404, 'User not found');
  const [updated] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  const before = pick(existing[0], AUDITED_FIELDS);
  const after = pick(updated[0], AUDITED_FIELDS);
  await recordAudit({
    req,
    action: 'user.updated',
    table: 'users',
    recordId: id,
    summary: `Changed ${Object.keys(after).filter(field => String(before?.[field]) !== String(after[field])).join(', ') || 'no fields'}`,
    before,
    after,
  });
  res.json({ message: 'User updated successfully' });
}));

router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  if (id === req.user.id) throw new ApiError(400, 'You cannot deactivate your own account');
  const [existing] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  if (existing.length === 0) throw new ApiError(404, 'User not found');
  const [result] = await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new ApiError(404, 'User not found');
  await recordAudit({
    req,
    action: 'user.deactivated',
    table: 'users',
    recordId: id,
    summary: `Deactivated ${existing[0].email}`,
    before: pick(existing[0], AUDITED_FIELDS),
    after: pick({ ...existing[0], is_active: 0 }, AUDITED_FIELDS),
  });
  res.json({ message: 'User deactivated' });
}));

module.exports = router;
