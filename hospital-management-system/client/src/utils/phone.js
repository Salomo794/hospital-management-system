// Phone number rules for the client.
//
// Mirrors server/utils/phone.js so a form can explain a problem while it is
// being typed instead of after a round trip. The server remains the authority
// and re-checks every value.
//
// Digits only. A phone number is dialled, not formatted, and allowing "+250 788
// 123 456" alongside "0788123456" means the same person exists as two rows that
// never match.

export const PHONE_MIN_DIGITS = 4
export const PHONE_MAX_DIGITS = 20

const DIGITS_ONLY = /^[0-9]+$/

/**
 * Returns the problem with a phone number, or an empty string when it is
 * acceptable. Blank is acceptable: the field is optional everywhere it appears.
 */
export function phoneProblem(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed === '') return ''
  if (!DIGITS_ONLY.test(trimmed)) {
    return 'Phone must contain digits only, with no spaces, letters or symbols.'
  }
  if (trimmed.length < PHONE_MIN_DIGITS || trimmed.length > PHONE_MAX_DIGITS) {
    return `Phone must be between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS} digits.`
  }
  return ''
}
