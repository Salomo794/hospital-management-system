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
  env: { ...process.env, PORT: '5001' },
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

const CHECKS = [
  ['GET', '/health', null],
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

async function main() {
  let passed = 0, failed = 0;

  if (!(await waitUp())) {
    console.error('FATAL: API server did not start.');
    console.error(serverLog.slice(0, 2000));
    server.kill();
    process.exit(1);
  }

  for (const [method, url, body] of CHECKS) {
    if (url === '/health') continue; // already validated by waitUp
    try {
      const r = await req(method, url, body);
      const ok = r.status >= 200 && r.status < 300;
      if (ok) passed++;
      else {
        failed++;
        console.log(`FAIL ${method} ${url} -> ${r.status}`);
      }
      if (url === '/auth/login' && ok) token = r.json.token;
    } catch (e) {
      failed++;
      console.log(`ERR  ${method} ${url} -> ${e.message}`);
    }
  }

  console.log(`\nSmoke test complete: ${passed} passed, ${failed} failed.`);
  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main();