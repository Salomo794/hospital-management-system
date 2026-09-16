// HMS API Smoke Tests
// Boots the Express server and exercises the core API surface end-to-end.
// Usage:   cd server && npm test   (or:  node tests/smoke.test.js)

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_DIR = path.join(__dirname, '..');

// Fresh clones / CI have no .env; fall back to the example so JWT auth works.
const envFile = path.join(SERVER_DIR, '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(SERVER_DIR, '.env.example'), envFile);
}

const server = spawn(process.execPath, ['index.js'], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: '5001', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', d => { serverLog += d.toString(); });
server.stderr.on('data', d => { serverLog += d.toString(); });

const BASE = 'http://127.0.0.1:5001/api';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitUp(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* keep waiting */ }
    await sleep(500);
  }
  return false;
}

let token = null;
async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

// [method, url, body, expectedStatus=2xx]. expectedStatus can be a number or range.
const POSITIVE = [
  ['POST', '/auth/login', { email: 'admin@hospital.com', password: 'password123' }],
  ['GET', '/auth/me', null],
  ['GET', '/users', null],
  ['GET', '/patients', null],
  ['GET', '/patients/1', null],
  ['GET', '/patients/1/history', null],
  ['GET', '/doctors', null],
  ['GET', '/doctors/specialties/all', null],
  ['GET', '/doctors/2', null],
  ['GET', '/doctors/1/schedule', null],
  ['GET', '/appointments', null],
  ['GET', '/appointments/1', null],
  ['GET', '/appointments/slots/1?date=2026-09-20', null],
  ['GET', '/emr/patient/1', null],
  ['GET', '/emr/1', null],
  ['GET', '/prescriptions/pending-items', null],
  ['GET', '/pharmacy/medicines', null],
  ['GET', '/pharmacy/alerts', null],
  ['GET', '/pharmacy/transactions', null],
  ['GET', '/laboratory/tests', null],
  ['GET', '/laboratory/orders', null],
  ['GET', '/laboratory/orders/1', null],
  ['GET', '/billing', null],
  ['GET', '/billing/1', null],
  ['GET', '/reports/dashboard', null],
  ['GET', '/reports/financial', null],
  ['GET', '/reports/financial?period=daily', null],
  ['GET', '/reports/financial?period=weekly', null],
  ['GET', '/reports/patients', null],
  ['GET', '/notifications', null],
  ['POST', '/ai/chat', { message: 'find patient James' }],
  ['POST', '/ai/chat', { message: 'find doctor cardiologist' }],
  ['POST', '/ai/chat', { message: "today's appointments" }],
  ['POST', '/ai/chat', { message: 'patient record 1' }],
  ['POST', '/ai/chat', { message: 'revenue this month' }]
];

// Negative checks prove validation + error handling actually protect the API.
const NEGATIVE = [
  ['POST', '/auth/login', { email: 'admin@hospital.com' }, 400],                      // missing password -> validation blocks
  ['POST', '/auth/login', { email: 'not-an-email', password: 'password123' }, 400],    // bad email -> validation blocks
  ['POST', '/ai/chat', {}, 400],                                                       // missing message -> no more 500
  ['POST', '/patients', { first_name: '' }, 400],                                      // missing required fields -> validation
  ['POST', '/appointments', { patient_id: 'x' }, 400],                                 // bad patient id -> validation
  ['POST', '/billing', { patient_id: 1 }, 400],                                        // missing items -> validation
  ['POST', '/laboratory/orders', { patient_id: 1 }, 400],                              // missing test_ids -> validation
  ['GET', '/patients/not-a-number', null, 400]                                         // invalid id param -> validation
];

async function run(checks, getToken) {
  let passed = 0, failed = 0;
  for (const [method, url, body, expected] of checks) {
    try {
      const r = await req(method, url, body);
      const ok = expected !== undefined
        ? r.status === expected
        : r.status >= 200 && r.status < 300;
      if (ok) passed++;
      else {
        failed++;
        console.log(`FAIL ${method} ${url} -> ${r.status} (expected ${expected || '2xx'})`);
      }
      if (getToken && url === '/auth/login' && r.status >= 200 && r.status < 300) token = r.json.token;
    } catch (e) {
      failed++;
      console.log(`ERR  ${method} ${url} -> ${e.message}`);
    }
  }
  return { passed, failed };
}

async function main() {
  if (!(await waitUp())) {
    console.error('FATAL: API server did not start.');
    console.error(serverLog.slice(0, 2000));
    server.kill();
    process.exit(1);
  }

  const pos = await run(POSITIVE, true);
  const neg = await run(NEGATIVE, false);

  const passed = pos.passed + neg.passed;
  const failed = pos.failed + neg.failed;
  console.log(`\nSmoke test complete: ${passed} passed, ${failed} failed.`);
  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main();