#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadEnvironment, serverDirectory } = require('./environment');

// Loads a real drug-interaction dataset.
//
// The list that ships with this project exists so the demo flow works. It is a
// handful of well-known pairs and is not a clinical reference. This command is
// how a deployment replaces it with a maintained dataset, and it records what was
// loaded so nothing downstream has to guess.
//
// Format: a CSV with a header row, and these columns.
//   medicine_a,medicine_b,severity,description,clinical_management
// Names are matched case-insensitively against medicines.name and
// medicines.generic_name. Severity must be one of
// mild, moderate, severe, contraindicated.
//
// Rows naming a medicine that is not in the catalogue are reported rather than
// silently dropped: a dataset full of unmatched names means a naming mismatch,
// and importing it as "loaded" would be a false reassurance.

const SEVERITIES = ['mild', 'moderate', 'severe', 'contraindicated'];

const USAGE = `Usage: npm run db:interactions -- --file <path.csv> [options]

Options:
  --file <path>       CSV to import (required)
  --name <text>       Name of the reference, e.g. "BNF Interaction Data"
  --version <text>    Version of the reference, e.g. "2026-03"
  --replace           Clear existing interactions first (default)
  --append            Keep existing rows and add these
  --description <t>   Free-text description of the source

Examples:
  npm run db:interactions -- --file data/interactions.csv --name "BNF" --version 2026.03
`;

function parseArgs(argv) {
  const options = { replace: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) {
        console.error(`Error: ${arg} needs a value.`);
        process.exit(1);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case '--file': options.file = next(); break;
      case '--name': options.name = next(); break;
      case '--version': options.version = next(); break;
      case '--description': options.description = next(); break;
      case '--replace': options.replace = true; break;
      case '--append': options.replace = false; break;
      case '--help':
      case '-h': console.log(USAGE); process.exit(0); break;
      default:
        console.error(`Unknown option "${arg}".\n\n${USAGE}`);
        process.exit(1);
    }
  }
  if (!options.file) {
    console.error(`--file is required.\n\n${USAGE}`);
    process.exit(1);
  }
  return options;
}

// A CSV field may be quoted, and a quoted field may contain a comma. Splitting
// on commas alone silently shifts every later column in the row, which for a
// clinical file means a severity ends up in the description field.
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function run() {
  loadEnvironment();
  const options = parseArgs(process.argv.slice(2));
  const file = path.resolve(options.file);
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  const pool = require('./database');
  const source = options.name || `imported:${path.basename(file)}`;

  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) {
    console.error('The file needs a header row and at least one data row.');
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]).map(column => column.toLowerCase().replace(/\s+/g, '_'));
  const required = ['medicine_a', 'medicine_b', 'severity'];
  for (const column of required) {
    if (!header.includes(column)) {
      console.error(`The header is missing "${column}". Found: ${header.join(', ')}`);
      process.exit(1);
    }
  }
  const index = Object.fromEntries(header.map((column, position) => [column, position]));
  const at = (row, column) => (row[index[column]] || '').trim();

  const [medicines] = await pool.query('SELECT id, name, generic_name FROM medicines');
  const byName = new Map();
  for (const medicine of medicines) {
    for (const value of [medicine.name, medicine.generic_name]) {
      if (value) byName.set(String(value).toLowerCase().trim(), medicine.id);
    }
  }
  const resolve = value => byName.get(String(value || '').toLowerCase().trim());

  const valid = [];
  const unmatchedNames = new Set();
  const badSeverity = new Set();
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const a = resolve(at(row, 'medicine_a'));
    const b = resolve(at(row, 'medicine_b'));
    const severity = at(row, 'severity').toLowerCase();

    if (!a || !b) {
      unmatchedNames.add(at(row, 'medicine_a'));
      unmatchedNames.add(at(row, 'medicine_b'));
      skipped += 1;
      continue;
    }
    if (a === b) { skipped += 1; continue; }
    if (!SEVERITIES.includes(severity)) {
      badSeverity.add(at(row, 'severity'));
      skipped += 1;
      continue;
    }
    valid.push({
      a, b, severity,
      description: at(row, 'description') || null,
      management: at(row, 'clinical_management') || null
    });
  }

  console.log(`Parsed ${lines.length - 1} rows.`);
  console.log(`  usable:  ${valid.length}`);
  if (skipped) console.log(`  skipped: ${skipped}`);
  if (badSeverity.size > 0) {
    console.error(`  unrecognised severity values: ${[...badSeverity].join(', ')}`);
    console.error('  Valid values: ' + SEVERITIES.join(', '));
    pool.close();
    process.exit(1);
  }
  if (unmatchedNames.size > 0) {
    const shown = [...unmatchedNames].slice(0, 10);
    console.warn(`  medicines not in the catalogue (${unmatchedNames.size}): ${shown.join(', ')}`);
    if (unmatchedNames.size > shown.length) console.warn(`    ...and ${unmatchedNames.size - shown.length} more`);
    console.warn('  These rows were not imported. Check the naming against medicines.name or');
    console.warn('  medicines.generic_name before treating this dataset as loaded.');
  }

  if (valid.length === 0) {
    console.error('Nothing usable in that file, so the reference was left unchanged.');
    pool.close();
    process.exit(1);
  }

  // Import is transactional: a half-loaded reference would be worse than none,
  // because it would look authoritative while being incomplete.
  await pool.runTransaction(async connection => {
    if (options.replace) {
      await connection.query('DELETE FROM drug_interactions');
    }
    const sourceLabel = source;
    for (const row of valid) {
      await connection.query(
        `INSERT INTO drug_interactions
           (medicine_a_id, medicine_b_id, severity, description, clinical_management, source)
         VALUES (?,?,?,?,?,?)`,
        [row.a, row.b, row.severity, row.description, row.management, sourceLabel]
      );
    }
    await connection.query(
      `INSERT INTO safety_reference
         (id, source, description, reference_name, reference_version, loaded_at, interaction_count)
       VALUES (1,?,?,?,?,datetime('now'),?)
       ON CONFLICT(id) DO UPDATE SET
         source = excluded.source,
         description = excluded.description,
         reference_name = excluded.reference_name,
         reference_version = excluded.reference_version,
         loaded_at = excluded.loaded_at,
         interaction_count = excluded.interaction_count`,
      [source, options.description || null, options.name || null, options.version || null, valid.length]
    );
  });

  const [total] = await pool.query('SELECT COUNT(*) AS c FROM drug_interactions');
  console.log('');
  console.log(`Loaded ${valid.length} interactions from ${options.name || path.basename(file)}.`);
  console.log(`The reference now holds ${total[0].c} interactions and is marked authoritative.`);
  pool.close();
}

run().catch(error => {
  console.error(`Import failed: ${error.message}`);
  process.exit(1);
});
