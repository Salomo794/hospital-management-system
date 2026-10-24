const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, getPagination, parseInteger } = require('../utils/http');
const { recordAudit, pick } = require('../utils/audit');
const { readPatientDataInBulk, writePatientData } = require('../middleware/rateLimit');
const { phoneDigitsOnly, phoneProblem, normalisePhone } = require('../utils/phone');

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_technician'];
const AUDITED_FIELDS = ['email', 'role', 'first_name', 'last_name', 'phone', 'is_active'];

router.get('/', authenticate, authorize('admin'), readPatientDataInBulk, asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { role, search, status } = req.query;
  if (role && !ROLES.includes(role)) throw new ApiError(400, 'Invalid role filter');
  if (status && !['active', 'inactive'].includes(status)) throw new ApiError(400, 'Invalid status filter');

  let where = 'WHERE 1=1';
  const params = [];
  if (role) {
    where += ' AND role = ?';
    params.push(role);
  }
  if (status) {
    where += ' AND is_active = ?';
    params.push(status === 'active' ? 1 : 0);
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

router.put('/:id', authenticate, authorize('admin'), writePatientData, asyncHandler(async (req, res) => {
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
  // The admin edit path had no phone rule at all, which is how a staff account
  // ended up holding a formatted number that the registration form would now
  // refuse. Same helper as everywhere else.
  if (phone !== undefined && !phoneDigitsOnly(phone)) {
    throw new ApiError(400, phoneProblem);
  }

  const updates = [];
  const values = [];
  for (const [field, value] of Object.entries({ first_name, last_name, phone, role, is_active })) {
    if (value !== undefined) {
      updates.push(`${field} = ?`);
      // A cleared phone is stored as NULL rather than "", so clearing it and
      // looking it up behave the same way everywhere else in the database.
      if (field === 'phone') values.push(normalisePhone(value));
      else values.push(typeof value === 'string' && value.trim() ? value.trim() : value);
    }
  }
  if (updates.length === 0) throw new ApiError(400, 'No fields to update');
  values.push(id);
  const changed = await pool.runTransaction(async connection => {
    const [existing] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
    if (existing.length === 0) throw new ApiError(404, 'User not found');
    // Count and update within the same transaction so concurrent admin actions
    // cannot remove the final active administrator.
    const wouldLoseActiveAdmin = existing[0].role === 'admin' && Boolean(existing[0].is_active)
      && ((role !== undefined && role !== 'admin') || is_active === false);
    if (wouldLoseActiveAdmin) {
      const [admins] = await connection.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1");
      if (Number(admins[0]?.count || 0) <= 1) {
        throw new ApiError(409, 'The last active administrator cannot be demoted or deactivated.');
      }
    }
    const [result] = await connection.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    if (result.affectedRows === 0) throw new ApiError(404, 'User not found');
    const [updated] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
    return { before: existing[0], after: updated[0] };
  });
  const before = pick(changed.before, AUDITED_FIELDS);
  const after = pick(changed.after, AUDITED_FIELDS);
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

router.delete('/:id', authenticate, authorize('admin'), writePatientData, asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  if (id === req.user.id) throw new ApiError(400, 'You cannot deactivate your own account');
  const existing = await pool.runTransaction(async connection => {
    const [rows] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) throw new ApiError(404, 'User not found');
    if (rows[0].role === 'admin' && rows[0].is_active) {
      const [admins] = await connection.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1");
      if (Number(admins[0]?.count || 0) <= 1) {
        throw new ApiError(409, 'The last active administrator cannot be deactivated.');
      }
    }
    const [result] = await connection.query('UPDATE users SET is_active = FALSE WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw new ApiError(404, 'User not found');
    return rows[0];
  });
  await recordAudit({
    req,
    action: 'user.deactivated',
    table: 'users',
    recordId: id,
    summary: `Deactivated ${existing[0].email}`,
    before: pick(existing, AUDITED_FIELDS),
    after: pick({ ...existing, is_active: 0 }, AUDITED_FIELDS),
  });
  res.json({ message: 'User deactivated' });
}));

module.exports = router;
