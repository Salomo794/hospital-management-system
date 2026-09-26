// Phone number rules, shared by every route and form that accepts one.
//
// Digits only, at the owner's request. The previous rule allowed "+", spaces,
// brackets, dots and dashes, which is fine for a human reading a contact list
// and bad for a database column: the same number stored as "0788123456",
// "+250788123456" and "0788 123 456" is three rows that never match, and a
// search or an SMS integration has to guess which spelling the caller meant.
//
// Lower and upper bounds are generous on purpose. A four-digit extension and a
// full fifteen-digit international number both have to fit, and a hospital
// should not be the thing standing between a staff member and their own phone
// number over a leading zero.
const PHONE_MIN_DIGITS = 4;
const PHONE_MAX_DIGITS = 20;

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * True when the value is digits only. Exported separately from the express-validator
 * chain so the routes that validate by hand, rather than by middleware, apply exactly
 * the same rule.
 */
function phoneDigitsOnly(value) {
  if (value === undefined || value === null || String(value).trim() === '') return true;
  return DIGITS_ONLY.test(String(value).trim());
}

const phoneProblem = `Phone must contain digits only, no spaces or symbols (${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} digits)`;

/**
 * Normalises a phone number for storage: trimmed, or null when blank, so a
 * cleared field is stored as NULL rather than as an empty string that will not
 * match a lookup.
 */
function normalisePhone(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

module.exports = {
  PHONE_MIN_DIGITS,
  PHONE_MAX_DIGITS,
  phoneDigitsOnly,
  phoneProblem,
  normalisePhone,
};
