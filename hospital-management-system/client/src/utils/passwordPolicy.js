// Password rules for the client.
//
// This mirrors server/utils/passwordPolicy.js so the form can explain a problem
// before the request is sent. The server remains the authority and re-checks
// everything; this is about telling the person what is wrong while they type
// rather than after they submit.
//
// The two are kept honest by a parity test in server/test/password-policy.test.js
// that runs a corpus through both implementations and requires identical results,
// so a rule changed on one side cannot quietly drift from the other.

export const MIN_LENGTH = 8
export const MAX_LENGTH = 200

// A floor rather than a target. See the note in server/utils/passwordPolicy.js:
// the blocked list, the repeated-character and run checks, and the name rules
// are what carry the weight from here up.

const BANNED = [
  'password', 'passw0rd', 'password1', 'password123', 'password1234',
  '12345678', '123456789', '1234567890', '12345678901', '123456789012',
  'qwertyuiop', 'qwerty12345', 'letmein123', 'welcome1234', 'admin12345',
  'administrator', 'hospital123', 'iloveyou123', 'monkey12345', 'sunshine123',
  'changeme123', 'default1234', 'temp123456', 'test123456', 'secret12345',
]

const SELF_REFERENCE = ['hospital', 'medicare', 'admin', 'doctor', 'nurse', 'reception']

function hasSequentialRun(lower, size = 4) {
  let ascending = 1
  let descending = 1
  for (let index = 1; index < lower.length; index += 1) {
    const delta = lower.charCodeAt(index) - lower.charCodeAt(index - 1)
    ascending = delta === 1 ? ascending + 1 : 1
    descending = delta === -1 ? descending + 1 : 1
    if (ascending >= size || descending >= size) return true
  }
  return false
}

function repeatedCharacterRun(lower, size = 4) {
  let run = 1
  for (let index = 1; index < lower.length; index += 1) {
    run = lower[index] === lower[index - 1] ? run + 1 : 1
    if (run >= size) return true
  }
  return false
}

export function validatePassword(password, { email = '', firstName = '', lastName = '' } = {}) {
  const value = String(password || '')
  const problems = []

  if (value.length < MIN_LENGTH) problems.push(`Password must be at least ${MIN_LENGTH} characters`)
  if (value.length > MAX_LENGTH) problems.push(`Password must be at most ${MAX_LENGTH} characters`)

  const lower = value.toLowerCase()
  const banned = BANNED.filter(entry => (entry.length >= 6 ? lower.includes(entry) : lower === entry))
  if (banned.length > 0) problems.push('This password is too common. Choose something that is not on a list of known passwords.')
  if (value.length >= MIN_LENGTH && hasSequentialRun(lower)) {
    problems.push('Avoid sequences of consecutive characters, such as "1234" or "abcd".')
  }
  if (value.length >= MIN_LENGTH && repeatedCharacterRun(lower)) {
    problems.push('Avoid repeating the same character several times in a row.')
  }

  const withoutSeparators = lower.replace(/[^a-z0-9]/g, '')
  const localPart = String(email).split('@')[0].toLowerCase()
  for (const candidate of [localPart, firstName, lastName]) {
    const token = String(candidate || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (token.length >= 4 && withoutSeparators.includes(token)) {
      problems.push('Password must not contain your name or email address.')
      break
    }
  }
  if (!problems.includes('Password must not contain your name or email address.')) {
    for (const token of SELF_REFERENCE) {
      if (withoutSeparators.includes(token)) {
        problems.push('Password must not contain words related to this system.')
        break
      }
    }
  }

  return [...new Set(problems)]
}

export function isAcceptable(password, context) {
  return validatePassword(password, context).length === 0
}

// A rough score for the strength meter. This is a nudge towards a longer
// passphrase, not a security control: length is what actually matters, so the
// meter leans on it rather than on character-class rules. The bands start at
// the policy's own minimum so the meter never reads "Empty" for a password the
// policy would already accept.
export function passwordStrength(password) {
  const value = String(password || '')
  if (!value) return { score: 0, label: 'Empty' }
  let score = 0
  if (value.length >= MIN_LENGTH) score += 1
  if (value.length >= 12) score += 1
  if (value.length >= 16) score += 1
  if (value.length >= 20) score += 1
  if (/[^a-zA-Z0-9]/.test(value)) score += 1
  if (new Set(value.toLowerCase()).size >= 10) score += 1
  if (isAcceptable(value)) score = Math.max(score, 2)
  const bounded = Math.min(score, 4)
  return { score: bounded, label: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][bounded] }
}
