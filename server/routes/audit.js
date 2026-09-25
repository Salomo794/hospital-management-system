const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, getPagination, isDateOnly, parseInteger } = require('../utils/http');

// The audit log is read-only and admin-only: it records who touched patient
// records and money, so it must not be writable or readable by the actors it
// describes.

router.get('/', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { user_id, actor_type, action, table_name, from_date, to_date } = req.query;

  for (const [name, value] of Object.entries({ from_date, to_date })) {
    if (value && !isDateOnly(value)) throw new ApiError(400, `${name} must use YYYY-MM-DD`);
  }
  if (from_date && to_date && from_date > to_date) {
    throw new ApiError(400, 'from_date cannot be after to_date');
  }
  if (actor_type && !['staff', 'patient', 'anonymous'].includes(actor_type)) {
    throw new ApiError(400, 'Invalid actor_type filter');
  }
  if (action && String(action).length > 100) throw new ApiError(400, 'action filter is too long');

  let where = 'WHERE 1=1';
  const params = [];
  if (user_id) {
    where += ' AND a.user_id = ?';
    params.push(parseInteger(user_id, 'user_id', { min: 1 }));
  }
  if (actor_type) {
    where += ' AND a.actor_type = ?';
    params.push(actor_type);
  }
  if (action) {
    // Exact match, so the action stays a clean filterable value.
    where += ' AND a.action = ?';
    params.push(String(action).trim());
  }
  if (table_name) {
    where += ' AND a.table_name = ?';
    params.push(String(table_name).trim());
  }
  if (from_date) {
    where += ' AND date(a.created_at) >= ?';
    params.push(from_date);
  }
  if (to_date) {
    where += ' AND date(a.created_at) <= ?';
    params.push(to_date);
  }

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM audit_log a ${where}`, params);
  const [rows] = await pool.query(
    `SELECT a.id, a.user_id, a.actor_type, a.actor_label, a.action, a.summary, a.table_name, a.record_id,
            a.old_values, a.new_values, a.ip_address, a.created_at,
            u.first_name AS actor_first_name, u.last_name AS actor_last_name, u.email AS actor_email
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ entries: rows, total: countRows[0].total, page, limit });
}));

// Distinct action names, so the UI can offer a filter list without hardcoding
// the set of things the application audits.
router.get('/actions', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT DISTINCT action FROM audit_log ORDER BY action'
  );
  res.json({ actions: rows.map(row => row.action) });
}));

module.exports = router;
