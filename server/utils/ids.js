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

function generateAccessCode(mrn) {
  const mrnPart = String(mrn || '').replace(/^MRN-/i, '').slice(0, 4).toUpperCase();
  return `HMS-${mrnPart}-${randomToken(5)}`;
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
