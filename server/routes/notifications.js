const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { ApiError, asyncHandler, parseInteger } = require('../utils/http');

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  const [unread] = await pool.query(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
    [req.user.id]
  );
  res.json({ notifications: rows, unread_count: unread[0].count });
}));

router.put('/read-all', authenticate, asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ message: 'All notifications marked as read' });
}));

router.put('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [result] = await pool.query(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [id, req.user.id]
  );
  if (result.affectedRows === 0) throw new ApiError(404, 'Notification not found');
  res.json({ message: 'Marked as read' });
}));

module.exports = router;
