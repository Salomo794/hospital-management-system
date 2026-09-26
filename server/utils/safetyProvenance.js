// Provenance of the clinical safety data.
//
// The bundled interaction list is a small, hand-written set of well-known pairs
// so the demo flow works. It is not a clinical reference: a maintained
// drug-interaction dataset covers thousands of medicines and tens of thousands
// of pairs, and this one covers neither.
//
// That distinction is the whole point of this module. A screening check that
// quietly reports "no interactions found" from sixteen rows of demo data reads
// as a clean result, and a clinician who trusts it is worse off than one who
// knows no real check is running. So the provenance travels with every safety
// evaluation, the API can be asked what it is actually checking against, and a
// production start says so out loud.
const pool = require('../config/database');

const DEMO_SOURCE = 'demo';

// Wording chosen to be unmissable in a UI and unambiguous over the API.
const DEMO_NOTICE = {
  authoritative: false,
  source: DEMO_SOURCE,
  label: 'Demo interaction data',
  warning:
    'Drug-interaction screening is running against a small demonstration dataset, not a '
    + 'maintained clinical reference. Absence of a warning does not mean an interaction is '
    + 'absent. Load a real interaction dataset before relying on this check.',
};

function describeProvenance(source, meta) {
  if (!source || source === DEMO_SOURCE) {
    return { ...DEMO_NOTICE, ...(meta || {}) };
  }
  return {
    authoritative: true,
    source,
    label: meta?.reference_name || 'Imported clinical reference',
    description: meta?.description || null,
    reference_name: meta?.reference_name || null,
    reference_version: meta?.reference_version || null,
    loaded_at: meta?.loaded_at || null,
    warning: null,
  };
}

// This project's query API returns a [rows, fields] tuple, whether the executor
// is the shared pool, a transaction connection, or a plain function. Reading
// result[0] as if it were a row yields the rows array itself, which spreads into
// the response as a stray "0" key and makes every downstream field undefined -
// the kind of bug that reports demo data as authoritative, or the reverse.
async function queryRows(queryExecutor, sql) {
  const result = typeof queryExecutor === 'function'
    ? await queryExecutor(sql, [])
    : await queryExecutor.query(sql);
  return Array.isArray(result) && result.length === 2 && Array.isArray(result[0])
    ? result[0]
    : (Array.isArray(result) ? result : []);
}

async function readProvenance(queryExecutor = pool) {
  const rows = await queryRows(queryExecutor, 'SELECT * FROM safety_reference WHERE id = 1');
  const meta = rows.find(row => row && row.source) || null;

  // Fall back to inspecting the interactions themselves, so a database that was
  // migrated rather than seeded still reports honestly.
  let source = meta?.source;
  if (!source) {
    const counts = await queryRows(
      queryExecutor,
      'SELECT source, COUNT(*) AS c FROM drug_interactions GROUP BY source'
    );
    source = counts.length > 0 ? counts[0].source : DEMO_SOURCE;
  }

  return describeProvenance(source, meta);
}

// Printed once at start-up. A hospital that never sees this message has no way
// to know the check it relies on is a demonstration.
function startupWarning(provenance) {
  if (provenance.authoritative) return;
  const line = '='.repeat(72);
  console.warn(`\n${line}`);
  console.warn('  DRUG-INTERACTION DATA IS NOT CLINICAL');
  console.warn(`  Source: ${provenance.source}`);
  console.warn(`  ${provenance.warning}`);
  console.warn('  Load a real dataset with: npm run db:interactions -- --file <path>');
  console.warn(`${line}\n`);
}

module.exports = {
  DEMO_SOURCE,
  DEMO_NOTICE,
  describeProvenance,
  readProvenance,
  startupWarning,
};
