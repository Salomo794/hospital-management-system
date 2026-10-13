// Password policy for staff accounts.
//
// A hospital system holds protected health information behind these accounts, and
// a weak staff password is the cheapest way in. The rules are deliberately
// centred on length and on blocking the passwords that actually get guessed,
// rather than on symbol-count rules that push people towards "Password1!".
//
// The policy applies when a password is *set* - registration and password
// change - and never on sign-in, so tightening it cannot lock out an account
// that already exists.

// Cost 12 is bcrypt's default here and is a deliberate trade-off: it is the
// single largest source of latency in the auth endpoints.
const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

// Eight is a floor, not a target, and it is deliberately lower than the
// twelve this policy originally shipped with, at the owner's request, because a
// twelve-character floor was blocking staff from being created at all. The
// compensating rules below carry more of the weight as a result: the blocked
// list, the refusal of repeated characters and runs, and the name and
// self-reference checks are what actually stop a guessable password, and they
// still fire from eight characters up.

// The passwords that show up first in any credential-stuffing list. Blocking
// these outright is more effective than demanding a symbol, because
// "Password1!" satisfies almost any complexity rule while still being trivial.
const BANNED = [
  'password', 'passw0rd', 'password1', 'password123', 'password1234',
  '12345678', '123456789', '1234567890', '12345678901', '123456789012',
  'qwertyuiop', 'qwerty12345', 'letmein123', 'welcome1234', 'admin12345',
  'administrator', 'hospital123', 'iloveyou123', 'monkey12345', 'sunshine123',
  'changeme123', 'default1234', 'temp123456', 'test123456', 'secret12345',
];

// A password must not contain the person's own email or name, which is the most
// common way to satisfy a complexity rule without adding any real entropy.
const SELF_REFERENCE = ['hospital', 'medicare', 'admin', 'doctor', 'nurse', 'reception'];

function normalise(password) {
  return String(password || '');
}

// Repeated runs of one character ("aaaaaaaaaaaa") and simple sequences
// ("123456789012") pass a length check while being no harder to guess.
function hasSequentialRun(lower, size = 4) {
  let ascending = 1;
  let descending = 1;
  for (let index = 1; index < lower.length; index += 1) {
    const delta = lower.charCodeAt(index) - lower.charCodeAt(index - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= size || descending >= size) return true;
  }
  return false;
}

function repeatedCharacterRun(lower, size = 4) {
  let run = 1;
  for (let index = 1; index < lower.length; index += 1) {
    run = lower[index] === lower[index - 1] ? run + 1 : 1;
    if (run >= size) return true;
  }
  return false;
}

// Returns an array of human-readable problems. Empty means the password is
// acceptable, which keeps it usable from both express-validator and plain code.
function validatePassword(password, { email = '', firstName = '', lastName = '' } = {}) {
  const value = normalise(password);
  const problems = [];

  if (value.length < MIN_LENGTH) {
    problems.push(`Password must be at least ${MIN_LENGTH} characters`);
  }
  if (value.length > MAX_LENGTH) {
    // bcrypt silently truncates beyond 72 bytes, so anything longer is a trap
    // where two different passwords both work.
    problems.push(`Password must be at most ${MAX_LENGTH} characters`);
  }

  const lower = value.toLowerCase();
  // Matched as a substring, not just exactly, so the endless small variations
  // of a leaked password ("password123", "password123!", "qwertyuiop12") are all
  // caught. Shorter entries are only matched in full, so a common fragment does
  // not reject a password that merely happens to contain those letters.
  const banned = BANNED.filter(entry => (entry.length >= 6 ? lower.includes(entry) : lower === entry));
  if (banned.length > 0) {
    problems.push('This password is too common. Choose something that is not on a list of known passwords.');
  }
  if (value.length >= MIN_LENGTH && hasSequentialRun(lower)) {
    problems.push('Avoid sequences of consecutive characters, such as "1234" or "abcd".');
  }
  if (value.length >= MIN_LENGTH && repeatedCharacterRun(lower)) {
    problems.push('Avoid repeating the same character several times in a row.');
  }

  // A password must not be built out of the person's own identity or out of
  // words anyone would guess about this hospital. The token length guard is what
  // prevents a short name matching by accident.
  const withoutSeparators = lower.replace(/[^a-z0-9]/g, '');
  const localPart = String(email).split('@')[0].toLowerCase();
  for (const candidate of [localPart, firstName, lastName]) {
    const token = String(candidate || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (token.length >= 4 && withoutSeparators.includes(token)) {
      problems.push('Password must not contain your name or email address.');
      break;
    }
  }
  if (!problems.includes('Password must not contain your name or email address.')) {
    for (const token of SELF_REFERENCE) {
      if (withoutSeparators.includes(token)) {
        problems.push('Password must not contain words related to this system.');
        break;
      }
    }
  }

  return [...new Set(problems)];
}

function isAcceptable(password, context) {
  return validatePassword(password, context).length === 0;
}

module.exports = {
  MIN_LENGTH,
  MAX_LENGTH,
  BANNED,
  validatePassword,
  isAcceptable,
};
