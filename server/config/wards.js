// Shared ward configuration used by admissions, reports, ai, and smart routes.
// Keys are ward names, values are total bed capacity.
const WARDS = {
  'General Medicine': 20,
  'Surgery': 12,
  'ICU': 10,
  'Pediatrics': 10,
  'Maternity': 14,
  'Ward A': 20,
  'Ward B': 20,
};

/** Returns the capacity for a known ward, or undefined for an unknown one. */
const wardCapacity = (ward) => WARDS[ward];

/** Returns the capacity for a known ward, falling back to 20 for unknown wards found in live data. */
const wardCapacityOrDefault = (ward) => WARDS[ward] ?? 20;

module.exports = { WARDS, wardCapacity, wardCapacityOrDefault };
