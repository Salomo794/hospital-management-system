const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.MFA_ENCRYPTION_KEY = 'unit-test-mfa-encryption-key-which-is-at-least-32-characters';
const {
  generateSecret,
  encryptSecret,
  decryptSecret,
  totpCode,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
  otpauthUrl,
} = require('../utils/mfa');

test('TOTP secrets encrypt at rest and decrypt only with the configured key', () => {
  const secret = generateSecret();
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.match(encrypted, /^v1:/);
  assert.equal(decryptSecret(encrypted), secret);
  assert.throws(() => decryptSecret('not-an-encrypted-secret'));
});

test('TOTP accepts a current code and rejects malformed or incorrect codes', () => {
  const secret = generateSecret();
  const now = Date.now();
  const code = totpCode(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, 'abc123', now), false);
  assert.equal(verifyTotp(secret, String((Number(code) + 1) % 1000000).padStart(6, '0'), now), false);
});

test('recovery codes are hashed and can only be consumed once', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  const hashes = codes.map(hashRecoveryCode);
  assert.ok(hashes.every(hash => /^[a-f0-9]{64}$/.test(hash)));
  const firstUse = consumeRecoveryCode(codes[0], hashes);
  assert.equal(firstUse.valid, true);
  assert.equal(firstUse.hashes.length, 9);
  const secondUse = consumeRecoveryCode(codes[0], firstUse.hashes);
  assert.equal(secondUse.valid, false);
  assert.equal(secondUse.hashes.length, 9);
});

test('authenticator URI identifies the HMS issuer and account', () => {
  const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'nurse@example.com');
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.match(url, /issuer=Hospital\+Management\+System/);
  assert.match(url, /secret=JBSWY3DPEHPK3PXP/);
});
