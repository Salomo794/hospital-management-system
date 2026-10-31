// Creates the first administrator account.
//
// Why this exists: a fresh production database has no users. Demo seeding is
// refused in production, and POST /api/auth/register needs a signed-in
// administrator, so without this command a new deployment cannot be signed in to.
//
// Usage (the password is never taken from the command line, so it does not end up
// in shell history or process listings):
//
//   ADMIN_PASSWORD='...' npm run admin:create -- --email you@hospital.org \
//     --first-name Ada --last-name Mugisha
//
//   npm run admin:create          # interactive: prompts for anything missing
//
// Environment alternatives: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME,
// ADMIN_LAST_NAME, ADMIN_PHONE.
//
// By default it refuses to run when an active administrator already exists, so a
// forgotten deployment step cannot quietly add another privileged account. Pass
// --allow-additional to add one on purpose.

const readline = require('readline');
const { Writable } = require('stream');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');

const { validatePassword } = require('../utils/passwordPolicy');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_COST = 12;

class AdminSetupError extends Error {}

function normaliseInput({ email, password, firstName, lastName, phone }) {
  const cleaned = {
    email: String(email || '').trim().toLowerCase(),
    password: String(password || ''),
    firstName: String(firstName || '').trim(),
    lastName: String(lastName || '').trim(),
    phone: String(phone || '').trim() || null,
  };

  const problems = [];
  if (!EMAIL_PATTERN.test(cleaned.email) || cleaned.email.length > 255) {
    problems.push('Enter a valid email address.');
  }
  if (!cleaned.firstName) problems.push('First name is required.');
  if (!cleaned.lastName) problems.push('Last name is required.');
  if (!cleaned.password) {
    problems.push('A password is required.');
  } else {
    problems.push(...validatePassword(cleaned.password, {
      email: cleaned.email,
      firstName: cleaned.firstName,
      lastName: cleaned.lastName,
    }));
  }

  if (problems.length > 0) throw new AdminSetupError(problems.join('\n'));
  return cleaned;
}

async function createAdmin(pool, input, { allowAdditional = false } = {}) {
  const admin = normaliseInput(input);

  if (!allowAdditional) {
    const [existingAdmins] = await pool.query(
      "SELECT email FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1"
    );
    if (existingAdmins.length > 0) {
      throw new AdminSetupError(
        `An active administrator already exists (${existingAdmins[0].email}). `
        + 'Add further staff from the Users screen, or pass --allow-additional to create another administrator here.'
      );
    }
  }

  const [sameEmail] = await pool.query('SELECT id FROM users WHERE email = ?', [admin.email]);
  if (sameEmail.length > 0) {
    throw new AdminSetupError(`The email ${admin.email} is already registered.`);
  }

  const hashed = await bcrypt.hash(admin.password, BCRYPT_COST);
  const uuid = randomUUID();
  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO users (uuid, email, password, role, first_name, last_name, phone)
       VALUES (?, ?, ?, 'admin', ?, ?, ?)`,
      [uuid, admin.email, hashed, admin.firstName, admin.lastName, admin.phone]
    );
  } catch (error) {
    // Two runs racing each other lose on the unique email index, not silently.
    if (error && error.code === 'ER_DUP_ENTRY') {
      throw new AdminSetupError(`The email ${admin.email} is already registered.`);
    }
    throw error;
  }

  // Best-effort and awaited from here, not from a route, so there is no request
  // to attribute it to: the actor is the command-line tool itself.
  const { recordAudit } = require('../utils/audit');
  await recordAudit({
    action: 'user.admin_bootstrapped',
    table: 'users',
    recordId: result.insertId,
    summary: `Administrator ${admin.email} created from the command line`,
    after: { email: admin.email, role: 'admin' },
    actor: { type: 'system', label: 'admin:create' },
  });

  return { id: result.insertId, uuid, email: admin.email };
}

function parseArguments(argv) {
  const parsed = { allowAdditional: false, help: false };
  const valueFlags = {
    '--email': 'email',
    '--first-name': 'firstName',
    '--last-name': 'lastName',
    '--phone': 'phone',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inlineValue] = argv[index].split(/=(.*)/s, 2);
    if (flag === '--allow-additional') {
      parsed.allowAdditional = true;
    } else if (flag === '--help' || flag === '-h') {
      parsed.help = true;
    } else if (flag === '--password') {
      throw new AdminSetupError(
        'Do not pass the password on the command line. Set ADMIN_PASSWORD, or leave it out to be prompted.'
      );
    } else if (valueFlags[flag]) {
      const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith('--'))) {
        throw new AdminSetupError(`${flag} needs a value.`);
      }
      if (inlineValue === undefined) index += 1;
      parsed[valueFlags[flag]] = value;
    } else {
      throw new AdminSetupError(`Unknown option ${argv[index]}. Use --help to see what is supported.`);
    }
  }
  return parsed;
}

function ask(question, { hidden = false } = {}) {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

async function collectInput(args, env) {
  const input = {
    email: args.email || env.ADMIN_EMAIL,
    firstName: args.firstName || env.ADMIN_FIRST_NAME,
    lastName: args.lastName || env.ADMIN_LAST_NAME,
    phone: args.phone || env.ADMIN_PHONE,
    password: env.ADMIN_PASSWORD,
  };

  const missing = ['email', 'firstName', 'lastName', 'password'].filter(key => !input[key]);
  if (missing.length > 0 && !process.stdin.isTTY) {
    throw new AdminSetupError(
      `Missing ${missing.join(', ')}. Provide them as options or environment variables, `
      + 'or run this command in an interactive terminal to be prompted.'
    );
  }

  if (!input.email) input.email = await ask('Admin email: ');
  if (!input.firstName) input.firstName = await ask('First name: ');
  if (!input.lastName) input.lastName = await ask('Last name: ');
  if (!input.password) {
    input.password = await ask('Password (hidden): ', { hidden: true });
    const confirmation = await ask('Repeat password: ', { hidden: true });
    if (confirmation !== input.password) throw new AdminSetupError('The two passwords do not match.');
  }
  return input;
}

const USAGE = `Create the first administrator account.

  npm run admin:create -- --email <email> --first-name <name> --last-name <name> [--phone <number>]

The password is read from ADMIN_PASSWORD, or prompted for (hidden) in a terminal.
Also accepted from the environment: ADMIN_EMAIL, ADMIN_FIRST_NAME, ADMIN_LAST_NAME, ADMIN_PHONE.

  --allow-additional   create another administrator even though one already exists
`;

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const input = await collectInput(args, env);
  // Loaded only now so --help and argument errors work without a database.
  const pool = require('./database');
  try {
    const created = await createAdmin(pool, input, { allowAdditional: args.allowAdditional });
    console.log(`Administrator created: ${created.email}`);
    console.log('Sign in, then turn on multi-factor authentication from the profile menu before using the system.');
  } finally {
    await pool.close();
  }
}

if (require.main === module) {
  const { loadEnvironment } = require('./environment');
  loadEnvironment();
  main().catch(error => {
    console.error(error instanceof AdminSetupError ? error.message : `[admin:create] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { AdminSetupError, createAdmin, normaliseInput, parseArguments };
