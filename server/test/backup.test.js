const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

// A backup is only worth having if it can be restored, and a safety net that has
// never been exercised is indistinguishable from no safety net at all. These
// tests run the real command end to end rather than mocking it.

const serverDirectory = path.join(__dirname, '..');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-backup-test-'));
const script = path.join(serverDirectory, 'config', 'backup.js');

after(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

function run(args, { dbPath, expect } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      DB_PATH: dbPath || '',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      NODE_ENV: 'test',
    },
    encoding: 'utf8',
  });
  if (expect !== undefined) {
    assert.equal(
      result.status,
      expect,
      `expected exit ${expect}, got ${result.status}\n${result.stdout}\n${result.stderr}`
    );
  }
  return result;
}

// Newest first, matching how the command itself orders and rotates them. A raw
// readdir makes no ordering promise, so the sort has to be explicit.
function backupsIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.db'))
    .sort()
    .reverse();
}

// Builds a small but real database, with the tables the command reports on.
function createDatabase(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE patients (id INTEGER PRIMARY KEY, mrn TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, amount REAL);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, bill_id INTEGER, amount REAL);
    CREATE TABLE medical_records (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_orders (id INTEGER PRIMARY KEY);
  `);
  for (let index = 1; index <= 12; index += 1) {
    db.prepare('INSERT INTO patients (id, mrn, first_name, last_name) VALUES (?, ?, ?, ?)')
      .run(index, `MRN-TEST-${index}`, `Test`, `Patient${index}`);
  }
  db.prepare('INSERT INTO users (id, email) VALUES (1, ?)')
    .run('admin@hospital.com');
  db.prepare('INSERT INTO bills (id, amount) VALUES (1, 100)').run();
  db.prepare('INSERT INTO payments (id, bill_id, amount) VALUES (1, 1, 100)').run();
  db.close();
}

test('a backup is written, verified, and carries a manifest', () => {
  const dbPath = path.join(tempDirectory, 'source.db');
  const dir = path.join(tempDirectory, 'out-1');
  createDatabase(dbPath);

  const result = run(['--dir', dir, '--label', 'unit test'], { dbPath, expect: 0 });
  // Success is only reported after the copy has been read back.
  assert.match(result.stdout, /Backup written/);
  assert.match(result.stdout, /Backup is valid/);
  assert.match(result.stdout, /integrity_check {2}ok/);

  const files = backupsIn(dir);
  assert.equal(files.length, 1);

  const manifestPath = path.join(dir, `${files[0]}.json`);
  assert.equal(fs.existsSync(manifestPath), true, 'a manifest should be written alongside the backup');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.label, 'unit test');
  assert.equal(manifest.file, files[0]);
  assert.ok(manifest.size_bytes > 0);
  assert.ok(Number.isFinite(Date.parse(manifest.created_at)));
});

test('the backup contains the data, not just an empty schema', () => {
  const dbPath = path.join(tempDirectory, 'source2.db');
  const dir = path.join(tempDirectory, 'out-2');
  createDatabase(dbPath);
  run(['--dir', dir], { dbPath, expect: 0 });

  const [file] = backupsIn(dir);
  const db = new Database(path.join(dir, file), { readonly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM patients').get().c, 12);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM payments').get().c, 1);
    assert.equal(db.prepare('SELECT email FROM users WHERE id = 1').get().email, 'admin@hospital.com');
  } finally {
    db.close();
  }
});

test('backing up does not modify the source database', () => {
  const dbPath = path.join(tempDirectory, 'source3.db');
  const dir = path.join(tempDirectory, 'out-3');
  createDatabase(dbPath);
  const before = fs.statSync(dbPath).size;
  run(['--dir', dir], { dbPath, expect: 0 });
  assert.equal(fs.statSync(dbPath).size, before, 'the source database should be untouched');
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM patients').get().c, 12);
  db.close();
});

test('a first run with no database is not treated as a failure', () => {
  // The launcher backs up before migrating, so a fresh install has nothing to
  // copy yet and must not be blocked by it.
  const missing = path.join(tempDirectory, 'does-not-exist.db');
  const result = run(['--dir', path.join(tempDirectory, 'out-4')], { dbPath: missing, expect: 0 });
  assert.match(result.stdout, /nothing to back up/i);
});

test('an unattended job can insist that a database exists', () => {
  const missing = path.join(tempDirectory, 'still-missing.db');
  run(['--require', '--dir', path.join(tempDirectory, 'out-5')], { dbPath: missing, expect: 1 });
});

test('a truncated backup is rejected rather than reported as good', () => {
  // The point of verifying is that a corrupt copy is caught. Slicing a good
  // backup produces exactly the kind of damage that would otherwise be
  // discovered during a restore.
  const dbPath = path.join(tempDirectory, 'source4.db');
  const dir = path.join(tempDirectory, 'out-6');
  createDatabase(dbPath);
  run(['--dir', dir], { dbPath, expect: 0 });
  const [file] = backupsIn(dir);
  const target = path.join(dir, file);

  const intact = fs.readFileSync(target);
  fs.writeFileSync(target, intact.subarray(0, Math.floor(intact.length / 2)));

  const verified = run(['--verify', target], { dbPath, expect: 1 });
  assert.match(`${verified.stdout}${verified.stderr}`, /[Ii]ntegrity check failed|not a database|database disk image is malformed/);
});

test('a restore round trip returns identical data', () => {
  const dbPath = path.join(tempDirectory, 'source5.db');
  const dir = path.join(tempDirectory, 'out-7');
  createDatabase(dbPath);
  run(['--dir', dir], { dbPath, expect: 0 });
  const [file] = backupsIn(dir);

  // Change the live database after the backup, so the restore is observable.
  const live = new Database(dbPath);
  live.prepare('DELETE FROM patients').run();
  live.prepare('INSERT INTO patients (id, mrn, first_name, last_name) VALUES (99, ?, ?, ?)')
    .run('MRN-AFTER', 'After', 'Backup');
  live.close();

  run(['--restore', path.join(dir, file)], { dbPath, expect: 0 });

  const restored = new Database(dbPath, { readonly: true });
  try {
    const [integrity] = restored.pragma('integrity_check');
    assert.equal(integrity.integrity_check, 'ok');
    assert.equal(restored.prepare('SELECT COUNT(*) AS c FROM patients').get().c, 12, 'the backup should have come back');
    assert.equal(
      restored.prepare("SELECT COUNT(*) AS c FROM patients WHERE mrn = 'MRN-AFTER'").get().c,
      0,
      'the change made after the backup should be gone'
    );
  } finally {
    restored.close();
  }
});

test('a restore keeps a copy of the database it replaced', () => {
  const dbPath = path.join(tempDirectory, 'source6.db');
  const dir = path.join(tempDirectory, 'out-8');
  createDatabase(dbPath);
  run(['--dir', dir], { dbPath, expect: 0 });
  const [file] = backupsIn(dir);
  const result = run(['--restore', path.join(dir, file)], { dbPath, expect: 0 });
  assert.match(result.stdout, /pre-restore-/, 'a restore should not be a one-way operation');
  const safety = fs.readdirSync(path.dirname(dbPath)).filter(name => name.startsWith('pre-restore-'));
  assert.ok(safety.length > 0, 'the replaced database should be kept');
});

test('old backups are rotated out and the newest kept', () => {
  const dbPath = path.join(tempDirectory, 'source7.db');
  const dir = path.join(tempDirectory, 'out-9');
  createDatabase(dbPath);
  for (let index = 0; index < 4; index += 1) {
    run(['--dir', dir, '--keep', '2'], { dbPath, expect: 0 });
  }
  const remaining = backupsIn(dir);
  assert.equal(remaining.length, 2, `--keep 2 should leave two backups, found ${remaining.length}`);
  // Newest first.
  assert.ok(remaining[0] > remaining[1]);
});

test('two backups in the same second do not collide', () => {
  // The launcher backs up on every start, so a crash loop can produce two
  // backups within one second. Names must stay distinct, and the earlier one
  // must not be overwritten.
  const dbPath = path.join(tempDirectory, 'source9.db');
  const dir = path.join(tempDirectory, 'out-11');
  createDatabase(dbPath);
  for (let index = 0; index < 5; index += 1) {
    run(['--dir', dir, '--keep', '10'], { dbPath, expect: 0 });
  }
  const files = backupsIn(dir);
  assert.equal(files.length, 5, 'every backup should have been kept, none overwritten');
  assert.equal(new Set(files).size, 5, 'filenames must be unique');
});

test('listing reports the retained backups', () => {
  const dbPath = path.join(tempDirectory, 'source8.db');
  const dir = path.join(tempDirectory, 'out-10');
  createDatabase(dbPath);
  run(['--dir', dir], { dbPath, expect: 0 });
  const listed = run(['--dir', dir, '--list'], { dbPath, expect: 0 });
  assert.match(listed.stdout, /Backups in/);
  assert.match(listed.stdout, /hospital-/);
});

test('an unknown option is refused instead of being ignored', () => {
  const result = run(['--nonsense'], { expect: 1 });
  assert.match(result.stderr, /Unknown option/);
});
