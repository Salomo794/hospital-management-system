const { randomBytes, randomInt, randomUUID } = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomToken(length) {
  const bytes = randomBytes(length);
  let token = '';
  for (let index = 0; index < length; index += 1) {
    token += ALPHABET[bytes[index] % ALPHABET.length];
  }
  return token;
}

function dateStamp(date = new Date()) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('');
}

function generateRecordNumber(prefix, date = new Date()) {
  return `${prefix}-${dateStamp(date)}-${randomToken(8)}`;
}

function generateMrn() {
  return `MRN-${randomToken(10)}`;
}

// A short, all-digit code (0000-9999) that a patient can read, remember and type
// at the front desk or portal. The space is small, so this function only draws a
// candidate: callers must persist it against the UNIQUE access_code column and
// retry on a collision rather than assume the value is free.
function generateAccessCode() {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

function generatePortalPin() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

module.exports = {
  randomUUID,
  randomToken,
  generateRecordNumber,
  generateMrn,
  generateAccessCode,
  generatePortalPin,
};
