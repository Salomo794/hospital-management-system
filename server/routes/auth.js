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
const { recordAudit, pick } = require('../utils/audit');
const { appTimezone } = require('../config/time');
const { validatePassword } = require('../utils/passwordPolicy');
const {
  generateSecret,
  encryptSecret,
  decryptSecret,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
  otpauthUrl,
} = require('../utils/mfa');
const { phoneDigitsOnly, phoneProblem, normalisePhone, PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } = require('../utils/phone');
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
const mfaByIp = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const mfaByChallenge = new FixedWindowRateLimiter({ windowMs: 5 * 60 * 1000, max: 6 });

function assertMfaConfigured() {
  if (typeof process.env.MFA_ENCRYPTION_KEY !== 'string'
      || process.env.MFA_ENCRYPTION_KEY.length < 32
      || process.env.MFA_ENCRYPTION_KEY === 'REPLACE_ME') {
    throw new ApiError(503, 'Multi-factor authentication is not configured on this server.');
  }
}

function createStaffToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, pwd: user.password_changed_at || '0', jti: randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
}

function publicStaffUser(user) {
  return {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone,
    mfa_enabled: Boolean(user.mfa_enabled),
    timezone: appTimezone(),
  };
}

async function issueStaffSession(req, res, user) {
  await pool.query("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);
  await recordAudit({
    req,
    action: 'auth.login.succeeded',
    table: 'users',
    recordId: user.id,
    summary: `${user.email} signed in`,
    actor: { userId: user.id, type: 'staff', label: user.email },
  });
  res.json({ token: createStaffToken(user), user: publicStaffUser(user) });
}
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

  if (user.mfa_enabled) {
    assertMfaConfigured();
    const challengeToken = jwt.sign(
      { id: user.id, pwd: user.password_changed_at || '0', purpose: 'mfa-challenge', jti: randomUUID() },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    await recordAudit({
      req,
      action: 'auth.mfa.challenge_issued',
      table: 'users',
      recordId: user.id,
      summary: `MFA challenge issued for ${user.email}`,
      actor: { userId: user.id, type: 'staff', label: user.email },
    });
    return res.json({ mfa_required: true, challenge_token: challengeToken, expires_in_seconds: 300 });
  }

  return issueStaffSession(req, res, user);
}));

router.post('/login/mfa', asyncHandler(async (req, res) => {
  const challengeToken = typeof req.body?.challenge_token === 'string' ? req.body.challenge_token : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!challengeToken || !code) throw new ApiError(400, 'A challenge token and authenticator code are required.');

  const ipLimit = mfaByIp.consume(`ip:${req.ip}`);
  let challenge;
  try {
    challenge = jwt.verify(challengeToken, process.env.JWT_SECRET);
  } catch (_) {
    throw new ApiError(401, 'The sign-in challenge is invalid or expired. Please sign in again.');
  }
  if (challenge.purpose !== 'mfa-challenge' || !challenge.id || !challenge.jti) {
    throw new ApiError(401, 'The sign-in challenge is invalid or expired. Please sign in again.');
  }
  const challengeLimit = mfaByChallenge.consume(`challenge:${challenge.jti}`);
  if (!ipLimit.allowed || !challengeLimit.allowed) {
    res.setHeader('Retry-After', Math.max(ipLimit.retryAfterSeconds, challengeLimit.retryAfterSeconds));
    throw new ApiError(429, 'Too many verification attempts. Please sign in again later.');
  }

  assertMfaConfigured();
  const [rows] = await pool.query(
    'SELECT id, uuid, email, role, first_name, last_name, phone, password_changed_at, is_active, mfa_enabled, mfa_secret, mfa_recovery_codes FROM users WHERE id = ?',
    [challenge.id]
  );
  const user = rows[0];
  if (!user || !user.is_active || !user.mfa_enabled || (user.password_changed_at || '0') !== (challenge.pwd || '0')) {
    throw new ApiError(401, 'The sign-in challenge is no longer valid. Please sign in again.');
  }

  let valid = false;
  let updatedRecoveryCodes = null;
  try {
    valid = verifyTotp(decryptSecret(user.mfa_secret), code);
  } catch (_) {
    throw new ApiError(503, 'Multi-factor authentication could not be verified. Contact your administrator.');
  }

  if (!valid) {
    let recoveryCodes = [];
    try {
      recoveryCodes = JSON.parse(user.mfa_recovery_codes || '[]');
    } catch (_) {
      recoveryCodes = [];
    }
    const consumed = consumeRecoveryCode(code, recoveryCodes);
    valid = consumed.valid;
    if (valid) updatedRecoveryCodes = JSON.stringify(consumed.hashes);
  }

  if (!valid) {
    await recordAudit({
      req,
      action: 'auth.mfa.verification_failed',
      table: 'users',
      recordId: user.id,
      summary: `MFA verification failed for ${user.email}`,
      actor: { userId: user.id, type: 'staff', label: user.email },
    });
    throw new ApiError(401, 'Invalid authenticator or recovery code.');
  }

  if (updatedRecoveryCodes !== null) {
    await pool.query('UPDATE users SET mfa_recovery_codes = ? WHERE id = ?', [updatedRecoveryCodes, user.id]);
  }
  mfaByIp.reset(`ip:${req.ip}`);
  mfaByChallenge.reset(`challenge:${challenge.jti}`);
  return issueStaffSession(req, res, user);
}));

router.post('/mfa/setup', authenticate, asyncHandler(async (req, res) => {
  assertMfaConfigured();
  const [rows] = await pool.query('SELECT email, mfa_enabled FROM users WHERE id = ?', [req.user.id]);
  if (!rows[0]) throw new ApiError(404, 'User not found.');
  if (rows[0].mfa_enabled) throw new ApiError(409, 'Multi-factor authentication is already enabled.');
  const secret = generateSecret();
  await pool.query('UPDATE users SET mfa_pending_secret = ? WHERE id = ?', [encryptSecret(secret), req.user.id]);
  await recordAudit({
    req,
    action: 'auth.mfa.setup_started',
    table: 'users',
    recordId: req.user.id,
    summary: 'Authenticator enrollment started',
  });
  res.json({
    secret,
    otpauth_url: otpauthUrl(secret, rows[0].email),
    message: 'Add this account to an authenticator app, then submit its current six-digit code to /api/auth/mfa/enable.',
  });
}));

router.post('/mfa/enable', authenticate, asyncHandler(async (req, res) => {
  assertMfaConfigured();
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code) throw new ApiError(400, 'An authenticator code is required.');
  const [rows] = await pool.query('SELECT email, mfa_pending_secret, mfa_enabled FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found.');
  if (user.mfa_enabled) throw new ApiError(409, 'Multi-factor authentication is already enabled.');
  if (!user.mfa_pending_secret) throw new ApiError(400, 'Start MFA setup before enabling it.');

  let valid = false;
  try {
    valid = verifyTotp(decryptSecret(user.mfa_pending_secret), code);
  } catch (_) {
    throw new ApiError(503, 'Multi-factor authentication could not be verified. Contact your administrator.');
  }
  if (!valid) throw new ApiError(400, 'The authenticator code is invalid. Check your device time and try again.');

  const secret = user.mfa_pending_secret;
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = recoveryCodes.map(hashRecoveryCode);
  const stamp = new Date().toISOString();
  await pool.query(
    `UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_pending_secret = NULL,
      mfa_recovery_codes = ?, password_changed_at = ?, updated_at = datetime('now') WHERE id = ?`,
    [secret, JSON.stringify(recoveryHashes), stamp, req.user.id]
  );
  const [updatedRows] = await pool.query(
    'SELECT id, uuid, email, role, first_name, last_name, phone, password_changed_at, mfa_enabled FROM users WHERE id = ?',
    [req.user.id]
  );
  await recordAudit({
    req,
    action: 'auth.mfa.enabled',
    table: 'users',
    recordId: req.user.id,
    summary: 'Authenticator MFA enabled; existing sessions invalidated',
    after: { mfa_enabled: true, sessions_invalidated: true, recovery_codes_issued: recoveryCodes.length },
  });
  res.json({
    message: 'MFA is enabled. Save these recovery codes somewhere safe; each can be used only once.',
    recovery_codes: recoveryCodes,
    // Replace the current session with a token issued after the invalidation
    // stamp, while every other device is forced to authenticate with MFA.
    token: createStaffToken(updatedRows[0]),
    user: publicStaffUser(updatedRows[0]),
  });
}));

router.post('/mfa/disable', authenticate, asyncHandler(async (req, res) => {
  assertMfaConfigured();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!password || !code) throw new ApiError(400, 'Your password and current authenticator code are required.');
  const [rows] = await pool.query('SELECT password, mfa_enabled, mfa_secret FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found.');
  if (!user.mfa_enabled) throw new ApiError(409, 'Multi-factor authentication is not enabled.');
  if (!(await bcrypt.compare(password, user.password))) throw new ApiError(401, 'Password is incorrect.');

  let valid = false;
  try {
    valid = verifyTotp(decryptSecret(user.mfa_secret), code);
  } catch (_) {
    throw new ApiError(503, 'Multi-factor authentication could not be verified. Contact your administrator.');
  }
  if (!valid) throw new ApiError(401, 'The authenticator code is invalid.');

  await pool.query(
    `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL,
      mfa_recovery_codes = NULL, password_changed_at = ?, updated_at = datetime('now') WHERE id = ?`,
    [new Date().toISOString(), req.user.id]
  );
  await recordAudit({
    req,
    action: 'auth.mfa.disabled',
    table: 'users',
    recordId: req.user.id,
    summary: 'Authenticator MFA disabled; existing sessions invalidated',
    after: { mfa_enabled: false, sessions_invalidated: true },
  });
  res.json({ message: 'MFA has been disabled. Please sign in again.' });
}));

router.post('/mfa/recovery-codes/regenerate', authenticate, asyncHandler(async (req, res) => {
  assertMfaConfigured();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!password || !code) throw new ApiError(400, 'Your password and current authenticator code are required.');
  const [rows] = await pool.query('SELECT password, mfa_enabled, mfa_secret FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found.');
  if (!user.mfa_enabled) throw new ApiError(409, 'Enable MFA before generating recovery codes.');
  if (!(await bcrypt.compare(password, user.password))) throw new ApiError(401, 'Password is incorrect.');

  let valid = false;
  try {
    valid = verifyTotp(decryptSecret(user.mfa_secret), code);
  } catch (_) {
    throw new ApiError(503, 'Multi-factor authentication could not be verified. Contact your administrator.');
  }
  if (!valid) throw new ApiError(401, 'The authenticator code is invalid.');

  const recoveryCodes = generateRecoveryCodes();
  await pool.query('UPDATE users SET mfa_recovery_codes = ? WHERE id = ?', [
    JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
    req.user.id,
  ]);
  await recordAudit({
    req,
    action: 'auth.mfa.recovery_codes_regenerated',
    table: 'users',
    recordId: req.user.id,
    summary: 'MFA recovery codes regenerated; previous codes invalidated',
    after: { recovery_codes_issued: recoveryCodes.length },
  });
  res.json({
    message: 'Store these new recovery codes safely. All previous recovery codes are now invalid.',
    recovery_codes: recoveryCodes,
  });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, uuid, email, role, first_name, last_name, phone, avatar, created_at, mfa_enabled FROM users WHERE id = ?',
    [req.user.id]
  );
  // The client renders every timestamp in the hospital's timezone so two staff
  // members never disagree about when something happened.
  res.json({ ...rows[0], timezone: appTimezone() });
}));

// Lets a staff member correct their own display name without an administrator
// having to do it for them.
//
// Deliberately limited to first_name, last_name and phone. Role, is_active,
// email and password are all excluded: a self-service endpoint that accepted a
// role would be a privilege escalation, and email is the login identifier, so
// changing it needs the same care as a password change. Those stay with an
// administrator through PUT /api/users/:id.
router.put('/me', authenticate, asyncHandler(async (req, res) => {
  const { first_name, last_name, phone } = req.body || {};
  const updates = [];
  const values = [];

  for (const [field, value] of Object.entries({ first_name, last_name, phone })) {
    if (value === undefined) continue;
    if (field !== 'phone' && !String(value || '').trim()) {
      throw new ApiError(400, `${field.replace('_', ' ')} cannot be empty`);
    }
    if (field !== 'phone' && String(value).trim().length > 100) {
      throw new ApiError(400, `${field.replace('_', ' ')} is too long`);
    }
    if (field === 'phone') {
      const trimmed = String(value || '').trim();
      if (!phoneDigitsOnly(trimmed)) throw new ApiError(400, phoneProblem);
      if (trimmed.length < PHONE_MIN_DIGITS || trimmed.length > PHONE_MAX_DIGITS) {
        throw new ApiError(400, `Phone must be between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS} digits`);
      }
      updates.push('phone = ?');
      values.push(normalisePhone(trimmed));
      continue;
    }
    updates.push(`${field} = ?`);
    values.push(String(value).trim());
  }

  if (updates.length === 0) {
    throw new ApiError(400, 'Provide a first name, last name or phone number to update');
  }

  const [before] = await pool.query(
    'SELECT first_name, last_name, phone FROM users WHERE id = ?',
    [req.user.id]
  );
  await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...values, req.user.id]);
  const [after] = await pool.query(
    'SELECT id, uuid, email, role, first_name, last_name, phone, avatar, created_at FROM users WHERE id = ?',
    [req.user.id]
  );

  await recordAudit({
    req,
    action: 'auth.profile.updated',
    table: 'users',
    recordId: req.user.id,
    summary: `${req.user.email} updated their own name`,
    before: pick(before[0], ['first_name', 'last_name', 'phone']),
    after: pick(after[0], ['first_name', 'last_name', 'phone']),
  });

  res.json({ ...after[0], timezone: appTimezone() });
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
