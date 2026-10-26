const crypto = require('crypto');

/**
 * Check-in (kiosk) tokens.
 *
 * A patient number, MRN, phone number or printed QR code is a *public
 * identifier*: it appears on wristbands, letters and reception screens and is
 * widely known. It must never be accepted as proof of identity at a public
 * kiosk, because knowing an MRN would let anyone check a patient in, or probe
 * for which MRNs exist.
 *
 * Instead, staff issue a short-lived bearer token for one patient. The token is
 * high entropy (256 bits), stored only as a SHA-256 hash so a database leak does
 * not yield usable tokens, expires after a bounded window, and can be redeemed
 * exactly once.
 */

const TOKEN_BYTES = 32; // 256 bits -> 43 base64url characters
const DEFAULT_TTL_MINUTES = 60;
const MIN_TTL_MINUTES = 1;
const MAX_TTL_MINUTES = 24 * 60; // a token must never outlive a single clinic day

function hashCheckinToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateCheckinToken() {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashCheckinToken(token) };
}

/**
 * Clamps a caller supplied TTL into the supported window and rejects anything
 * that is not a whole number of minutes.
 */
function normalizeTtlMinutes(value, fallback = DEFAULT_TTL_MINUTES) {
  if (value === undefined || value === null || value === '') return fallback;
  const minutes = Number(value);
  if (!Number.isInteger(minutes)) {
    throw new Error('ttl_minutes must be a whole number of minutes');
  }
  if (minutes < MIN_TTL_MINUTES || minutes > MAX_TTL_MINUTES) {
    throw new Error(`ttl_minutes must be between ${MIN_TTL_MINUTES} and ${MAX_TTL_MINUTES}`);
  }
  return minutes;
}

function expiryFor(ttlMinutes, now = Date.now()) {
  return new Date(now + ttlMinutes * 60 * 1000).toISOString();
}

function isTokenExpired(expiresAt, now = Date.now()) {
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return true; // fail closed on malformed timestamps
  return parsed <= now;
}

/**
 * Accepts the token either on its own or in the `HMS:CHECKIN:` QR envelope so a
 * scanner can post the payload it read without extra parsing.
 */
function normalizeCheckinTokenInput(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^HMS:CHECKIN:/i, '').trim();
}

module.exports = {
  TOKEN_BYTES,
  DEFAULT_TTL_MINUTES,
  MIN_TTL_MINUTES,
  MAX_TTL_MINUTES,
  hashCheckinToken,
  generateCheckinToken,
  normalizeTtlMinutes,
  normalizeCheckinTokenInput,
  expiryFor,
  isTokenExpired,
};
