const crypto = require('crypto');
const fs = require('fs');

// Backup encryption.
//
// A plaintext backup is a complete copy of every patient record, and the whole
// point of taking one off the machine is that it ends up somewhere less
// controlled - a network share, an object store, an engineer's laptop. At that
// point the file is the weakest link in the chain, not the database it came from.
//
// The database itself is not encrypted here. That would mean SQLCipher and a
// native rebuild, which is a deployment decision rather than something to slip in
// silently. Encrypting the backup is the reachable half of the problem: it is what
// makes a copy safe to move, and it is where the data actually leaves the building.
//
// AES-256-GCM, because an unauthenticated cipher on a clinical archive is not
// meaningfully better than no encryption - a backup that has been silently
// tampered with is worse than one you know is missing. GCM's tag is checked on
// restore, so a wrong key or a modified file fails loudly instead of producing a
// corrupt database.

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const TAG_BYTES = 16;
const VERSION = 'v1';
const MAGIC = Buffer.from('HMSENC1');

// A passphrase is stretched into a key rather than used directly, so a memorable
// operator phrase does not become a 32-byte key that is exactly as weak as the
// phrase. The salt is fixed and stored in the header, which keeps writing and
// reading on one path; uniqueness across backups comes from the random IV, which
// is what a GCM IV is for.
function derivationSalt() {
  return crypto.createHash('sha256').update('hms-backup-key-derivation-salt').digest().subarray(0, SALT_BYTES);
}

function passphraseFromEnv() {
  const raw = String(process.env.BACKUP_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  if (raw === 'REPLACE_ME') return null;
  return raw;
}

function deriveKey(passphrase) {
  return crypto.scryptSync(passphrase, derivationSalt(), KEY_BYTES);
}

function isEnabled() {
  return passphraseFromEnv() !== null;
}

function headerSize() {
  return MAGIC.length + Buffer.byteLength(VERSION) + SALT_BYTES + IV_BYTES + TAG_BYTES;
}

function encryptFile(sourcePath, targetPath) {
  const passphrase = passphraseFromEnv();
  if (!passphrase) throw new Error('BACKUP_ENCRYPTION_KEY is not set');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(passphrase), iv);
  const ciphertext = Buffer.concat([
    cipher.update(fs.readFileSync(sourcePath)),
    cipher.final()
  ]);

  const header = Buffer.concat([
    MAGIC,
    Buffer.from(VERSION, 'utf8'),
    derivationSalt(),
    iv,
    cipher.getAuthTag()
  ]);

  fs.writeFileSync(targetPath, Buffer.concat([header, ciphertext]));
  return fs.statSync(targetPath).size;
}

function decryptFile(sourcePath, targetPath) {
  const passphrase = passphraseFromEnv();
  if (!passphrase) {
    throw new Error('BACKUP_ENCRYPTION_KEY is not set, so this backup cannot be opened');
  }

  const raw = fs.readFileSync(sourcePath);
  if (raw.length < headerSize() || !raw.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('This is not an encrypted backup produced by this tool');
  }

  let offset = MAGIC.length;
  const versionLength = Buffer.byteLength(VERSION);
  const version = raw.subarray(offset, offset + versionLength).toString('utf8');
  if (version !== VERSION) throw new Error(`Unsupported backup version: ${version}`);

  offset += versionLength;
  const salt = raw.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = raw.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = raw.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;

  const key = crypto.scryptSync(passphrase, salt, KEY_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(raw.subarray(offset)), decipher.final()]);
  } catch {
    throw new Error('The backup failed its integrity check. It is corrupt, truncated, or the key is wrong.');
  }

  fs.writeFileSync(targetPath, plaintext);
  return fs.statSync(targetPath).size;
}

function looksEncrypted(file) {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(MAGIC.length);
    fs.readSync(handle, buffer, 0, MAGIC.length, 0);
    return buffer.equals(MAGIC);
  } catch {
    return false;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

module.exports = {
  isEnabled,
  encryptFile,
  decryptFile,
  looksEncrypted,
  ALGORITHM
};
