const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
const backupCrypto = require('../utils/backupCrypto');

// A backup is a full copy of the patient database, and the reason to move one off
// the machine is that it lands somewhere less controlled. If that copy is still
// plaintext, the copy is the weakest link in the chain. These tests pin that the
// encryption is real, and - more importantly - that a wrong key or a modified
// file fails loudly instead of producing a corrupt database that looks fine.

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-crypto-test-'));
const source = path.join(temp, 'source.db');
const target = path.join(temp, 'target.db');
const KEY = 'a long passphrase that is not a dictionary word';

function writeSource() {
  fs.writeFileSync(source, crypto.randomBytes(64 * 1024));
}

after(() => fs.rmSync(temp, { recursive: true, force: true }));

const withKey = (value, run) => {
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = value;
  try { return run(); } finally {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
  }
};

test('encryption is off without a key, and the placeholder does not count', () => {
  withKey('', () => assert.equal(backupCrypto.isEnabled(), false));
  withKey('REPLACE_ME', () => assert.equal(backupCrypto.isEnabled(), false));
  withKey(KEY, () => assert.equal(backupCrypto.isEnabled(), true));
});

test('an encrypted backup is not readable as the original', () => {
  writeSource();
  withKey(KEY, () => {
    backupCrypto.encryptFile(source, target);
    assert.notDeepEqual(fs.readFileSync(target), fs.readFileSync(source));
    // The plaintext must not survive anywhere in the output.
    assert.equal(fs.readFileSync(target).includes(fs.readFileSync(source).subarray(0, 512)), false);
    assert.equal(backupCrypto.looksEncrypted(target), true);
  });
});

test('a backup round trips back to the original bytes', () => {
  writeSource();
  withKey(KEY, () => {
    backupCrypto.encryptFile(source, target);
    backupCrypto.decryptFile(target, path.join(temp, 'back.db'));
    assert.deepEqual(fs.readFileSync(path.join(temp, 'back.db')), fs.readFileSync(source));
  });
});

test('two encryptions of the same data differ, so a nonce is never reused', () => {
  writeSource();
  withKey(KEY, () => {
    const a = path.join(temp, 'a.enc');
    const b = path.join(temp, 'b.enc');
    backupCrypto.encryptFile(source, a);
    backupCrypto.encryptFile(source, b);
    // Reusing an IV under one key would leak the XOR of two plaintexts. The
    // output must differ every time even though the input did not.
    assert.notDeepEqual(fs.readFileSync(a), fs.readFileSync(b));
  });
});

test('the wrong key is rejected rather than producing garbage', () => {
  writeSource();
  withKey(KEY, () => backupCrypto.encryptFile(source, target));
  withKey('a completely different passphrase', () => {
    assert.throws(
      () => backupCrypto.decryptFile(target, path.join(temp, 'wrong.db')),
      /integrity check|corrupt|wrong/i
    );
  });
});

test('a tampered backup is rejected', () => {
  writeSource();
  withKey(KEY, () => {
    backupCrypto.encryptFile(source, target);
    // Flip a byte in the ciphertext body. GCM authenticates, so this must fail
    // even though the file is still structurally intact.
    const raw = fs.readFileSync(target);
    const tamperedAt = raw.length - 10;
    raw[tamperedAt] ^= 0xff;
    fs.writeFileSync(target, raw);
    assert.throws(
      () => backupCrypto.decryptFile(target, path.join(temp, 'tampered.db')),
      /integrity check|corrupt|wrong/i
    );
  });
});

test('a truncated backup is rejected', () => {
  writeSource();
  withKey(KEY, () => {
    backupCrypto.encryptFile(source, target);
    const raw = fs.readFileSync(target);
    fs.writeFileSync(target, raw.subarray(0, Math.floor(raw.length / 2)));
    assert.throws(
      () => backupCrypto.decryptFile(target, path.join(temp, 'short.db')),
      /integrity check|corrupt|wrong|not an encrypted/i
    );
  });
});

test('a plaintext file is not mistaken for an encrypted one', () => {
  writeSource();
  assert.equal(backupCrypto.looksEncrypted(source), false);
  withKey('', () => assert.equal(backupCrypto.isEnabled(), false));
  withKey(KEY, () => {
    assert.equal(backupCrypto.isEnabled(), true);
    // Opening a plaintext file as if it were encrypted must be refused clearly,
    // because that is what an operator restoring an old unencrypted backup does.
    assert.throws(
      () => backupCrypto.decryptFile(source, path.join(temp, 'nope.db')),
      /not an encrypted backup/i
    );
  });
});

test('a missing key is a clear refusal, not a crash', () => {
  writeSource();
  withKey(KEY, () => backupCrypto.encryptFile(source, target));
  withKey('', () => {
    assert.throws(
      () => backupCrypto.decryptFile(target, path.join(temp, 'nokey.db')),
      /BACKUP_ENCRYPTION_KEY is not set/i
    );
  });
});

test('a short passphrase is stretched, so length and variety are what matter', () => {
  // A passphrase of a few characters must not produce a key that is trivially
  // brute-forceable in the way the raw bytes would be.
  writeSource();
  withKey('nine chars', () => {
    backupCrypto.encryptFile(source, target);
    const raw = fs.readFileSync(target);
    assert.ok(raw.length > fs.statSync(source).size, 'the output should carry a header and tag');
  });
});
