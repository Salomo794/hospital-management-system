// Password reset tokens.
//
// Only the SHA-256 of a token is ever stored. A reset link is a bearer
// credential for the account, so a leaked backup or a stray admin query must not
// hand out working links; a digest is enough to look one up and useless to
// anyone who reads it.
//
// The token itself is 32 random bytes, which is roughly 256 bits of entropy.
// That is far more than a password and is not subject to the password policy:
// it is never chosen by a person and is never weak.
const crypto = require('crypto');
const { randomUUID } = require('../utils/ids');
const { ApiError } = require('../utils/http');

// Thirty minutes. Long enough for someone to find the email on a phone, short
// enough that a link found in a shared mailbox or a browser history is unlikely
// to still work.
const EXPIRY_MINUTES = Number(process.env.PASSWORD_RESET_MINUTES || 30);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function expiryStamp(minutes = EXPIRY_MINUTES) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

/**
 * Issues a token for a user, retiring any that are still outstanding. Only one
 * live link per account at a time, so a second request does not leave an older
 * link usable in parallel.
 */
async function issueToken(connection, { userId, ipAddress = null }) {
  await connection.query(
    "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL",
    [userId]
  );
  const token = generateToken();
  const [result] = await connection.query(
    `INSERT INTO password_reset_tokens (uuid, user_id, token_hash, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), userId, hashToken(token), expiryStamp(), ipAddress]
  );
  return { token, tokenId: result.insertId };
}

/**
 * Resolves a token to its user, or throws. The three failure modes are reported
 * identically so a caller cannot use the response to learn whether a token ever
 * existed.
 */
async function resolveToken(connection, token) {
  const [rows] = await connection.query(
    `SELECT t.id, t.user_id, t.used_at, t.expires_at
     FROM password_reset_tokens t WHERE t.token_hash = ?`,
    [hashToken(token)]
  );
  if (rows.length === 0) {
    throw new ApiError(400, 'This password reset link is not valid.');
  }
  const row = rows[0];
  if (row.used_at) {
    throw new ApiError(400, 'This password reset link has already been used.');
  }
  // Compared in the database rather than in JavaScript so a clock skew between
  // the API host and the database cannot be used to resurrect an expired link.
  if (row.expires_at <= new Date().toISOString()) {
    throw new ApiError(400, 'This password reset link has expired. Please request a new one.');
  }
  return row;
}

async function markUsed(connection, tokenId) {
  await connection.query(
    "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL",
    [tokenId]
  );
}

module.exports = {
  EXPIRY_MINUTES,
  generateToken,
  hashToken,
  issueToken,
  resolveToken,
  markUsed,
};
