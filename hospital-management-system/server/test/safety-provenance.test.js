const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-interactions-test-'));
const dbPath = path.join(tempDirectory, 'hospital.test.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const serverDirectory = path.join(__dirname, '..');
const script = path.join(serverDirectory, 'config', 'interactions.js');
const setupDatabase = require('../config/setup');
const seedDatabase = require('../config/seed');
const pool = require('../config/database');
const { readProvenance, startupWarning, describeProvenance, DEMO_SOURCE } = require('../utils/safetyProvenance');
const { evaluateSafety } = require('../utils/safety');

before(async () => {
  await setupDatabase();
  await seedDatabase();
});

after(async () => {
  pool.close();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

function importCsv(rows, args = []) {
  const file = path.join(tempDirectory, `import-${Math.random().toString(36).slice(2)}.csv`);
  fs.writeFileSync(file, rows.join('\n'));
  return spawnSync(process.execPath, [script, '--file', file, ...args], {
    cwd: serverDirectory,
    env: { ...process.env, DB_PATH: dbPath, JWT_SECRET: process.env.JWT_SECRET },
    encoding: 'utf8',
  });
}

async function medicines(count) {
  const [rows] = await pool.query('SELECT id, name, generic_name FROM medicines ORDER BY id LIMIT ?', [count]);
  return rows;
}

test('the bundled data is reported as a demonstration, not a clinical reference', async () => {
  const provenance = await readProvenance(pool);
  assert.equal(provenance.authoritative, false);
  assert.equal(provenance.source, DEMO_SOURCE);
  // The wording has to say the important thing: that silence is not safety.
  assert.match(provenance.warning, /not a maintained clinical reference|does not mean an interaction is absent/i);
});

test('a start-up warning names the command that fixes it', async () => {
  const provenance = await readProvenance(pool);
  const logged = [];
  const original = console.warn;
  console.warn = message => logged.push(message);
  try {
    startupWarning(provenance);
  } finally {
    console.warn = original;
  }
  const output = logged.join('\n');
  assert.match(output, /NOT CLINICAL/i);
  assert.match(output, /db:interactions/);
  assert.match(output, /--file/);
});

test('an authoritative reference produces no warning', () => {
  const logged = [];
  const original = console.warn;
  console.warn = message => logged.push(message);
  try {
    startupWarning({ ...describeProvenance('bnf', {}), authoritative: true });
  } finally {
    console.warn = original;
  }
  assert.equal(logged.length, 0, 'a properly loaded dataset should not warn at start-up');
});

test('a safety evaluation carries its provenance with the result', async () => {
  const [a, b] = await medicines(2);
  const result = await evaluateSafety(null, [a.id, b.id]);
  assert.ok(result.provenance, 'the result must state what it was checked against');
  assert.equal(result.provenance.authoritative, false);
  assert.ok(result.provenance.warning);
});

test('provenance is read through the tuple-returning query API', async () => {
  // Regression. This project's query API returns [rows, fields]. Reading
  // result[0] as if it were a row hands back the rows array, which spreads into
  // the result as a stray "0" key and leaves every real field undefined. It
  // happened to give the right answer for demo data and the wrong answer for
  // anything imported, which is the worst kind of bug in a safety claim.
  const provenance = await readProvenance(pool);
  assert.equal(provenance['0'], undefined, 'no array should be spread into the result');
  for (const key of ['authoritative', 'source', 'label']) {
    assert.ok(key in provenance, `expected ${key} on the provenance`);
  }
  assert.equal(typeof provenance.authoritative, 'boolean');
});

test('a function executor is supported as well as the pool', async () => {
  const [rows] = await pool.query('SELECT source FROM safety_reference WHERE id = 1');
  const asFunction = async () => rows;
  const provenance = await readProvenance(asFunction);
  assert.equal(provenance['0'], undefined);
  assert.equal(typeof provenance.authoritative, 'boolean');
});

test('a CSV import marks the reference authoritative and records what was loaded', async () => {
  const meds = await medicines(3);
  const result = importCsv([
    'medicine_a,medicine_b,severity,description,clinical_management',
    `${meds[0].name},${meds[1].name},severe,Reduce the dose,Monitor closely`,
    `${meds[1].name},${meds[2].name},contraindicated,Never combine,Stop`
  ], ['--name', 'Test Reference', '--version', '2026.03', '--description', 'Fixture dataset']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(`${result.stdout}${result.stderr}`, /Loaded 2 interactions/);

  const provenance = await readProvenance(pool);
  assert.equal(provenance.authoritative, true);
  assert.equal(provenance.source, 'Test Reference');
  assert.equal(provenance.reference_version, '2026.03');
  assert.equal(provenance.warning, null);
});

test('quoted CSV fields containing commas stay in one column', async () => {
  // Splitting on commas alone shifts every later column, which for a clinical
  // file means a severity ends up sitting in the description field.
  const meds = await medicines(2);
  const result = importCsv([
    'medicine_a,medicine_b,severity,description,clinical_management',
    `"${meds[0].name}","${meds[1].name}",moderate,"Risk rises with dose, and with renal impairment","Reduce, and monitor"`
  ], ['--name', 'Quoted Fixture']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [stored] = await pool.query(
    `SELECT di.severity, di.description, di.clinical_management
     FROM drug_interactions di JOIN medicines ma ON ma.id = di.medicine_a_id
     WHERE ma.name = ?`,
    [meds[0].name]
  );
  assert.equal(stored[0].severity, 'moderate');
  assert.match(stored[0].description, /Risk rises with dose, and with renal impairment/);
  assert.match(stored[0].clinical_management, /Reduce, and monitor/);
});

test('an unrecognised severity is refused and the reference is left alone', async () => {
  const before = await readProvenance(pool);
  const meds = await medicines(2);
  const result = importCsv([
    'medicine_a,medicine_b,severity,description,clinical_management',
    `${meds[0].name},${meds[1].name},extremely-badly,Wrong,Wrong`
  ], ['--name', 'Broken Fixture']);

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /severity/i);
  const after = await readProvenance(pool);
  assert.equal(after.reference_version, before.reference_version, 'a rejected import must not change the reference');
});

test('medicines missing from the catalogue are reported, not silently dropped', async () => {
  const meds = await medicines(2);
  const result = importCsv([
    'medicine_a,medicine_b,severity,description,clinical_management',
    `${meds[0].name},Someting Not In The Catalogue,severe,Unknown drug,Ignored`,
    'Also Unknown A,Also Unknown B,mild,Both unknown,Ignored'
  ], ['--name', 'Partial Fixture']);

  // The import still succeeds for the rows it can use, but the gap is stated.
  assert.match(`${result.stdout}${result.stderr}`, /not in the catalogue/i);
  assert.match(`${result.stdout}${result.stderr}`, /Someting Not In The Catalogue/);
  assert.match(`${result.stdout}${result.stderr}`, /Also Unknown A/);
});

test('a file with no usable rows leaves the reference unchanged', async () => {
  const before = await readProvenance(pool);
  const result = importCsv([
    'medicine_a,medicine_b,severity,description,clinical_management',
    'Drug A,Drug B,severe,Nothing matches,Ignored'
  ], ['--name', 'Useless Fixture']);

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /Nothing usable/i);
  const after = await readProvenance(pool);
  assert.equal(after.source, before.source);
  assert.equal(after.reference_version, before.reference_version);
});

test('a missing required column is refused up front', async () => {
  const result = importCsv([
    'medicine_a,medicine_b',
    'A,B'
  ], ['--name', 'No Severity']);

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /severity/i);
});

test('a missing file is refused rather than creating an empty reference', async () => {
  const result = spawnSync(process.execPath, [script, '--file', path.join(tempDirectory, 'nope.csv')], {
    cwd: serverDirectory,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No such file/i);
});
