const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { MIN_LENGTH, validatePassword, isAcceptable } = require('../utils/passwordPolicy');
const { validateRegistration } = require('../middleware/validation');

// A hospital account sits in front of protected health information, so a weak
// staff password is the cheapest way in. These tests pin what the policy
// actually rejects, because a policy that quietly accepts "password123" is
// worse than no policy: it looks like a control and is not one.

test('short passwords are rejected', () => {
  assert.match(validatePassword('short').join(' '), new RegExp(`at least ${MIN_LENGTH} characters`, 'i'));
  assert.equal(validatePassword('').length > 0, true);
  // One character under the floor, and the character just below it.
  assert.equal(validatePassword('a'.repeat(MIN_LENGTH - 1)).length > 0, true);
});

test('the demo password that ships with the project is rejected', () => {
  // Every seeded account uses this, so it is the first thing an attacker tries.
  const problems = validatePassword('password123');
  assert.equal(problems.length > 0, true);
  assert.match(problems.join(' '), /common|\d+ characters/i);
});

test('other well-known passwords are rejected', () => {
  for (const weak of ['123456789012', 'qwertyuiop12', 'letmein12345', 'hospital123', 'welcome1234']) {
    assert.equal(validatePassword(weak).length > 0, true, `"${weak}" should be rejected`);
  }
});

test('length alone is not enough when the characters are predictable', () => {
  // These all satisfy the length floor, and are refused on predictability.
  for (const predictable of ['aaaaaaaaaaaa', '123456789012', 'abcdefghijkl']) {
    const problems = validatePassword(predictable).join(' ');
    assert.equal(problems.length > 0, true, `"${predictable}" should be rejected`);
  }
});

test('a password may not contain the person own name or email', () => {
  const context = { email: 'grace.mwangi@hospital.com', firstName: 'Grace', lastName: 'Mwangi' };
  const problems = validatePassword('Mwangi-2026-x', context).join(' ');
  assert.match(problems, /name or email/i);

  const local = validatePassword('gracemwangi99', context).join(' ');
  assert.match(local, /name or email/i);
});

test('a password may not be built from words related to this system', () => {
  const problems = validatePassword('MediCare2026x', {}).join(' ');
  assert.match(problems, /related to this system/i);
});

test('a reasonable passphrase is accepted', () => {
  const good = [
    'correct-horse-battery-7',
    'Thornbury!Ward2026',
    'vivid-marmoset-echo-42',
    'riverside-clinic-9917',
  ];
  for (const password of good) {
    assert.equal(isAcceptable(password, {}), true, `"${password}" should be accepted`);
  }
});

test('the policy reports every problem at once rather than one per attempt', () => {
  const problems = validatePassword('aaaaaaaaaaaa', { firstName: 'aaaaaaaaaa' });
  assert.ok(problems.length >= 2, `expected several problems, got ${JSON.stringify(problems)}`);
});

test('an over-long password is refused rather than silently truncated by bcrypt', () => {
  // bcrypt ignores everything past 72 bytes, so a longer password would mean
  // two different passwords could both open the account.
  assert.match(validatePassword('a'.repeat(300)).join(' '), /at most/i);
});

test('the minimum length is a floor, not the whole policy', () => {
  // Pinned deliberately: the owner lowered this from twelve to eight so that a
  // twelve-character floor was not blocking staff accounts from being created.
  // The compensating rules are what have to carry the weight, so they are the
  // ones asserted above.
  assert.equal(MIN_LENGTH, 8);
  assert.equal(
    isAcceptable('a'.repeat(MIN_LENGTH), {}),
    false,
    'a password of exactly the minimum length is still refused when it is all repeats'
  );
});

test('the client and server policies agree', async () => {
  // client/src/utils/passwordPolicy.js exists so the form can explain a problem
  // before the request is sent. If the two ever disagree, the form either
  // rejects a password the API would accept, or accepts one it will refuse, and
  // either way the person is told something untrue. This runs a corpus through
  // both implementations and requires identical answers.
  const client = await import(pathToFileURL(
    path.join(__dirname, '..', '..', 'client', 'src', 'utils', 'passwordPolicy.js')
  ).href);

  const cases = [
    ['', {}],
    ['short', {}],
    ['password123', {}],
    ['Password123', {}],
    ['qwertyuiop12', {}],
    ['aaaaaaaaaaaa', {}],
    ['123456789012', {}],
    ['hospital123', {}],
    ['Thornbury!Ward2026', {}],
    ['correct-horse-battery-7', {}],
    ['vivid-marmoset-echo-42', {}],
    ['MediCare2026x', {}],
    ['Thornbury-2026-x', { firstName: 'Thornbury' }],
    ['gracemwangi99', { email: 'grace.mwangi@hospital.com' }],
    ['gracemwangi2026', { email: 'grace.mwangi@hospital.com', firstName: 'Grace', lastName: 'Mwangi' }],
    ['a'.repeat(300), {}],
  ];

  for (const [password, context] of cases) {
    const serverProblems = validatePassword(password, context).join(' | ');
    const clientProblems = client.validatePassword(password, context).join(' | ');
    assert.equal(
      clientProblems,
      serverProblems,
      `policies disagree on ${JSON.stringify(password)}`
    );
  }

  assert.equal(client.MIN_LENGTH, MIN_LENGTH, 'minimum length must match');
  assert.equal(client.MAX_LENGTH, 200, 'maximum length must match');
});

test('registration enforces the same policy', async () => {
  const run = body => {
    const handlers = validateRegistration;
    return new Promise((resolve, reject) => {
      const req = { body };
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { resolve({ status: this.code || 200, payload }); return this; },
      };
      try {
        let index = 0;
        const next = () => {
          if (index >= handlers.length) return resolve({ status: 200, payload: null });
          handlers[index++](req, res, next);
        };
        next();
      } catch (error) {
        reject(error);
      }
    });
  };

  const good = { email: 'nurse@hospital.com', password: 'Thornbury!Ward2026', first_name: 'Ada', last_name: 'Nkemdi', role: 'nurse' };
  assert.equal((await run(good)).status, 200);

  // The demo password must not be accepted for a new account, even though every
  // seeded account still uses it.
  const weak = { ...good, password: 'password123' };
  const weakResult = await run(weak);
  assert.equal(weakResult.status, 400);
  assert.match(weakResult.payload.message, /common|\d+ characters/i);
  // Every problem is reported at once rather than one per attempt.
  assert.equal(Array.isArray(weakResult.payload.errors), true);
  assert.equal(weakResult.payload.errors[0].path, 'password');

  const short = await run({ ...good, password: 'short' });
  assert.equal(short.status, 400);
  assert.match(short.payload.message, /at least \d+ characters/i);

  // The policy also checks the account being created.
  const selfRef = await run({ ...good, email: 'grace.mwangi@hospital.com', password: 'gracemwangi2026' });
  assert.equal(selfRef.status, 400);
  assert.match(selfRef.payload.message, /name or email/i);
});
