const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const CODE_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input) {
  const value = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let buffer = 0;
  const output = [];
  for (const character of value) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 secret');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function encryptionKey() {
  const passphrase = process.env.MFA_ENCRYPTION_KEY;
  if (typeof passphrase !== 'string' || passphrase.length < 32 || passphrase === 'REPLACE_ME') {
    const error = new Error('MFA_ENCRYPTION_KEY must be configured with a unique secret of at least 32 characters.');
    error.code = 'MFA_NOT_CONFIGURED';
    throw error;
  }
  return crypto.scryptSync(passphrase, 'hms-mfa-secret-v1', 32);
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}

function decryptSecret(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Stored MFA secret has an unsupported format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[1], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function hotp(secret, counter) {
  const key = decodeBase32(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

function totpCode(secret, timeMs = Date.now()) {
  return hotp(secret, Math.floor(timeMs / 1000 / STEP_SECONDS));
}

function verifyTotp(secret, candidate, timeMs = Date.now()) {
  const code = String(candidate || '').trim();
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  const candidateBuffer = Buffer.from(code);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = Buffer.from(hotp(secret, counter + offset));
    if (candidateBuffer.length === expected.length && crypto.timingSafeEqual(candidateBuffer, expected)) return true;
  }
  return false;
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => crypto.randomBytes(8).toString('hex').toUpperCase());
}

function hashRecoveryCode(code) {
  const normalized = String(code || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(normalized)) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function consumeRecoveryCode(code, storedHashes) {
  const wanted = hashRecoveryCode(code);
  if (!wanted || !Array.isArray(storedHashes)) return { valid: false, hashes: storedHashes || [] };
  const index = storedHashes.findIndex(hash => {
    const actual = Buffer.from(String(hash || ''), 'hex');
    const expected = Buffer.from(wanted, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
  if (index < 0) return { valid: false, hashes: storedHashes };
  return { valid: true, hashes: storedHashes.filter((_, itemIndex) => itemIndex !== index) };
}

function otpauthUrl(secret, email) {
  const label = encodeURIComponent(`Hospital Management System:${email}`);
  const query = new URLSearchParams({
    secret,
    issuer: 'Hospital Management System',
    algorithm: 'SHA1',
    digits: String(CODE_DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

module.exports = {
  generateSecret,
  encryptSecret,
  decryptSecret,
  totpCode,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
  otpauthUrl,
  RECOVERY_CODE_COUNT,
};
