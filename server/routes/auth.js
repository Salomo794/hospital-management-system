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
const { recordAudit } = require('../utils/audit');
const { appTimezone } = require('../config/time');
const { validatePassword } = require('../utils/passwordPolicy');
const { withTransaction } = require('../utils/http');
const mailer = require('../services/mailer');
const {
  EXPIRY_MINUTES: RESET_EXPIRY_MINUTES,
  issueToken,
  resolveToken,
  markUsed,
} = require('../services/passwordReset');

const loginByIdentifier = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const loginByIp = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
// Deliberately tighter than login. A forgotten-password link is sent to a real
// inbox, so an unbounded endpoint is a mail-bombing target as well as a way to
// enumerate which staff addresses exist.
//
// The per-address limit is the one that actually stops mail bombing, and it is
// the tight one. The per-IP limit is looser on purpose: a hospital's staff
// share a single egress address behind NAT, so a limit tight enough to stop
// abuse would also lock out the whole building. Both are overridable because the
// right value depends on the deployment's network.
const resetByIdentifier = new FixedWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PASSWORD_RESET_MAX_PER_EMAIL || 3),
});
const resetByIp = new FixedWindowRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.PASSWORD_RESET_MAX_PER_IP || 60),
});

// The one message every outcome returns. Whether the address is unknown,
// inactive, or genuinely reset is never revealed: a different reply for a
// missing account turns this endpoint into a staff directory for anyone who
// cares to ask.
const RESET_REQUESTED_MESSAGE =
  'If an account exists for that address, a password reset link is on its way.';

// bcrypt is deliberately slow, and this runs only when the account exists. The
// same work is done for an unknown address so the two take comparable time.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1sJ4wvnD5tL1lPqQ0kqXq0hZ9Z9Z9Z9Z';
async function equalizeTiming(user) {
  await bcrypt.compare('not-a-real-password', user ? user.password : DUMMY_HASH);
}

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'A valid email address is required');
  }

  const identifierLimit = resetByIdentifier.consume(`identifier:${email}`);
  const ipLimit = resetByIp.consume(`ip:${req.ip}`);
  if (!identifierLimit.allowed || !ipLimit.allowed) {
    res.setHeader('Retry-After', Math.max(identifierLimit.retryAfterSeconds, ipLimit.retryAfterSeconds));
    throw new ApiError(429, 'Too many password reset requests. Please try again later.');
  }

  const [rows] = await pool.query(
    'SELECT id, email, first_name, password, is_active FROM users WHERE email = ?',
    [email]
  );
  const user = rows[0];
  await equalizeTiming(user);

  // An inactive account gets no link. Sending one would let a locked-out
  // account discover it exists and then have no way to unlock it.
  if (user && user.is_active) {
    const pending = await withTransaction(pool, async connection => issueToken(connection, {
      userId: user.id,
      ipAddress: req.ip || null,
    }));
    const resetUrl = `${mailer.publicUrl()}/reset-password?token=${pending.token}`;
    const message = mailer.passwordResetEmail({
      to: user.email,
      firstName: user.first_name,
      resetUrl,
      expiresInMinutes: RESET_EXPIRY_MINUTES,
    });
    try {
      await mailer.send(message);
      await recordAudit({
        req,
        action: 'auth.password_reset.requested',
        table: 'users',
        recordId: user.id,
        summary: `Password reset link sent to ${user.email}`,
        after: { email: user.email, expires_in_minutes: RESET_EXPIRY_MINUTES },
        actor: { userId: user.id, type: 'staff', label: user.email },
      });
    } catch (error) {
      // The token is already committed, so a mail failure leaves a dead link
      // rather than a live one. That is the safe direction to fail in.
      await withTransaction(pool, async connection => markUsed(connection, pending.tokenId));
      await recordAudit({
        req,
        action: 'auth.password_reset.failed',
        table: 'users',
        recordId: user.id,
        summary: `Password reset email could not be sent to ${user.email}`,
        after: { reason: error.message },
        actor: { userId: user.id, type: 'staff', label: user.email },
      });
      // Surfaced rather than swallowed: a silent failure here leaves an admin
      // believing password reset works when no mail is ever sent.
      throw new ApiError(503, 'Password reset is not available on this server. Please contact your administrator.');
    }
  } else {
    // Recorded so repeated requests against real but inactive accounts are
    // visible, without acknowledging them in the response.
    await recordAudit({
      req,
      action: 'auth.password_reset.requested',
      table: 'users',
      recordId: null,
      summary: `Password reset requested for ${email}`,
      after: { email, known_account: Boolean(user), account_active: user ? Boolean(user.is_active) : null },
    });
  }

  res.json({ message: RESET_REQUESTED_MESSAGE });
}));

// Lets the reset form show a real message instead of a dead end, without
// revealing anything about an account.
router.get('/reset-password/:token', asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) throw new ApiError(400, 'This password reset link is not valid.');
  await resolveToken(pool, token);
  res.json({ valid: true, expires_in_minutes: RESET_EXPIRY_MINUTES });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!token) throw new ApiError(400, 'This password reset link is not valid.');
  if (!newPassword) throw new ApiError(400, 'A new password is required');

  const result = await withTransaction(pool, async connection => {
    const row = await resolveToken(connection, token);
    const [rows] = await connection.query(
      'SELECT id, uuid, email, role, first_name, last_name, password, password_changed_at, is_active FROM users WHERE id = ?',
      [row.user_id]
    );
    if (rows.length === 0) throw new ApiError(400, 'This password reset link is not valid.');
    const user = rows[0];
    if (!user.is_active) {
      throw new ApiError(403, 'This account has been deactivated. Please contact your administrator.');
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      throw new ApiError(400, 'New password must be different from the current password');
    }

    const problems = validatePassword(newPassword, {
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    });
    if (problems.length > 0) throw new ApiError(400, problems[0], problems);

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    // Stamping password_changed_at is what actually ends the attacker's
    // session: the stamp goes into every newly issued token, and the
    // authenticate middleware rejects any token carrying an older one.
    const stamp = new Date().toISOString();
    await connection.query(
      "UPDATE users SET password = ?, password_changed_at = ?, updated_at = datetime('now') WHERE id = ?",
      [hashedPassword, stamp, user.id]
    );
    await markUsed(connection, row.id);
    // Every other outstanding link for the account dies with this one.
    await connection.query(
      "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL",
      [user.id]
    );
    await recordAudit({
      req,
      connection,
      action: 'auth.password_reset.completed',
      table: 'users',
      recordId: user.id,
      summary: `${user.email} reset their password; all previous sessions ended`,
      after: { email: user.email, role: user.role, sessions_invalidated: true },
      actor: { userId: user.id, type: 'staff', label: user.email },
    });
    return { email: user.email };
  });

  res.json({ message: 'Your password has been reset. You can now sign in.', email: result.email });
}));

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

  await recordAudit({
    req,
    action: 'user.registered',
    table: 'users',
    recordId: result.insertId,
    summary: `Registered ${normalizedEmail} as ${role}`,
    after: { email: normalizedEmail, role, first_name: first_name.trim(), last_name: last_name.trim() },
  });

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
    // Recorded so repeated attempts against a valid account are visible, even
    // though the response is deliberately identical for unknown and wrong
    // credentials. No password is stored.
    await recordAudit({
      req,
      action: 'auth.login.failed',
      table: 'users',
      recordId: user ? user.id : null,
      summary: `Failed login for ${email}`,
      after: { email, known_account: Boolean(user), account_active: user ? Boolean(user.is_active) : null },
      // Attributed only when the account actually exists; an unknown email
      // leaves the actor anonymous so the entry does not imply a real user.
      actor: user ? { userId: user.id, type: 'staff', label: user.email } : undefined,
    });
    throw new ApiError(user && !user.is_active ? 403 : 401, user && !user.is_active ? 'Account deactivated' : 'Invalid credentials');
  }

  loginByIdentifier.reset(identifierKey);
  loginByIp.reset(ipKey);
  await pool.query("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);
  await recordAudit({
    req,
    action: 'auth.login.succeeded',
    table: 'users',
    recordId: user.id,
    summary: `${user.email} signed in`,
    // The authenticate middleware has not run on this route, so name the actor
    // explicitly rather than leaving the entry unattributed.
    actor: { userId: user.id, type: 'staff', label: user.email },
  });
  const token = jwt.sign(
    // Carried so the middleware can tell a session issued before the current
    // password from one issued after it. `0` for an account that has never
    // changed its password, which is every account predating this field.
    { id: user.id, role: user.role, pwd: user.password_changed_at || '0' },
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
      // Sent on sign-in so the client can render times correctly straight away.
      timezone: appTimezone(),
    },
  });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, uuid, email, role, first_name, last_name, phone, avatar, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  // The client renders every timestamp in the hospital's timezone so two staff
  // members never disagree about when something happened.
  res.json({ ...rows[0], timezone: appTimezone() });
}));

router.put('/change-password', authenticate, asyncHandler(async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPassword) {
    throw new ApiError(400, 'Current password is required');
  }

  const [rows] = await pool.query(
    'SELECT password, email, first_name, last_name FROM users WHERE id = ?',
    [req.user.id]
  );
  if (rows.length === 0 || !(await bcrypt.compare(currentPassword, rows[0].password))) {
    throw new ApiError(400, 'Current password is incorrect');
  }
  if (await bcrypt.compare(newPassword, rows[0].password)) {
    throw new ApiError(400, 'New password must be different from the current password');
  }

  const problems = validatePassword(newPassword, rows[0]);
  if (problems.length > 0) throw new ApiError(400, problems[0], problems);

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  // Stamping ends every other session for this account, including any on a
  // device that is not this one. A user changing a password they believe was
  // exposed needs that guarantee, not just a working new password.
  await pool.query(
    "UPDATE users SET password = ?, password_changed_at = ?, updated_at = datetime('now') WHERE id = ?",
    [hashedPassword, new Date().toISOString(), req.user.id]
  );
  await recordAudit({
    req,
    action: 'auth.password.changed',
    table: 'users',
    recordId: req.user.id,
    summary: `${req.user.email} changed their password; all previous sessions ended`,
    after: { sessions_invalidated: true },
  });
  res.json({ message: 'Password updated successfully' });
}));

module.exports = router;
