const pool = require('../config/database');

// Allergy strings are free-text, comma/semicolon separated (e.g. "Penicillin, Morphine").
const IGNORED_ALLERGY_TOKENS = ['none', 'n/a', 'na', 'nil', 'nkda', 'no known allergies', 'no known drug allergies'];

const SEVERITY_RANK = { contraindicated: 0, severe: 1, moderate: 2, mild: 3 };

function parseAllergies(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !IGNORED_ALLERGY_TOKENS.includes(s));
}

function medicineMatchesAllergy(medicine, allergen) {
  const name = (medicine.name || '').toLowerCase();
  const generic = (medicine.generic_name || '').toLowerCase();
  return name.includes(allergen) || generic.includes(allergen);
}

// patient: row with first_name/last_name/allergies; medicines: rows with id/name/generic_name
function checkAllergies(patient, medicines) {
  const allergens = parseAllergies(patient && patient.allergies);
  if (!allergens.length) return [];
  const warnings = [];
  for (const med of medicines) {
    for (const allergen of allergens) {
      if (medicineMatchesAllergy(med, allergen)) {
        warnings.push({
          type: 'allergy',
          severity: 'contraindicated',
          medicine_id: med.id,
          medicine_name: med.name,
          allergen,
          message: `${med.name} conflicts with a recorded allergy (${allergen}).`,
        });
        break;
      }
    }
  }
  return warnings;
}

async function checkInteractions(medicineIds) {
  const ids = [...new Set((medicineIds || []).map(Number).filter(Boolean))];
  if (ids.length < 2) return [];
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT di.severity, di.description, di.clinical_management,
       ma.id as medicine_a_id, ma.name as medicine_a,
       mb.id as medicine_b_id, mb.name as medicine_b
     FROM drug_interactions di
     JOIN medicines ma ON di.medicine_a_id = ma.id
     JOIN medicines mb ON di.medicine_b_id = mb.id
     WHERE (di.medicine_a_id IN (${placeholders}) AND di.medicine_b_id IN (${placeholders}))
        OR (di.medicine_b_id IN (${placeholders}) AND di.medicine_a_id IN (${placeholders}))`,
    [...ids, ...ids, ...ids, ...ids]
  );
  return rows.map((r) => ({
    type: 'interaction',
    severity: r.severity,
    medicine_a_id: r.medicine_a_id,
    medicine_b_id: r.medicine_b_id,
    medicine_a: r.medicine_a,
    medicine_b: r.medicine_b,
    description: r.description,
    clinical_management: r.clinical_management,
    message: `${r.medicine_a} + ${r.medicine_b}: ${r.severity} interaction. ${r.description || ''}`.trim(),
  }));
}

async function evaluateSafety(patientId, medicineIds) {
  const requestedIds = (medicineIds || [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0);
  let patient = null;
  let existingMedicineIds = [];
  if (patientId) {
    const [p] = await pool.query(
      'SELECT id, first_name, last_name, allergies FROM patients WHERE id = ?',
      [patientId]
    );
    patient = p[0] || null;
    // Include medications the patient is already taking. Checking only the
    // newly submitted list can miss an interaction with an active prescription.
    const [activePrescriptions] = await pool.query(
      `SELECT DISTINCT pi.medicine_id
       FROM prescription_items pi
       JOIN prescriptions pr ON pr.id = pi.prescription_id
       WHERE pr.patient_id = ? AND pr.status = 'active'`,
      [patientId]
    );
    existingMedicineIds = activePrescriptions.map(row => Number(row.medicine_id)).filter(Number.isInteger);
  }
  const ids = [...new Set([...existingMedicineIds, ...requestedIds])];
  let medicines = [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const [m] = await pool.query(
      `SELECT id, name, generic_name FROM medicines WHERE id IN (${placeholders})`,
      ids
    );
    medicines = m;
  }
  const warnings = [...checkAllergies(patient, medicines), ...(await checkInteractions(ids))];
  warnings.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  const blocking = warnings.some((w) => w.type === 'allergy' || w.severity === 'contraindicated');
  return {
    patient: patient
      ? {
          id: patient.id,
          name: `${patient.first_name} ${patient.last_name}`,
          allergies: parseAllergies(patient.allergies),
        }
      : null,
    warnings,
    blocking,
  };
}

module.exports = {
  parseAllergies,
  checkAllergies,
  checkInteractions,
  evaluateSafety,
  SEVERITY_RANK,
};
