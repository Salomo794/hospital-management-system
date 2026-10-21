const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isHttpsOrigin,
  originOf,
  parseOrigins,
  resolveAllowedOrigins,
} = require('../config/corsOrigins');

test('the application\'s own public origin is allowed in production', () => {
  const allowed = resolveAllowedOrigins({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://hms.example.org',
    CORS_ORIGINS: '',
  });

  // A single-service deployment serves the client and the API from one
  // address. The browser sends that origin on every non-GET request, so
  // refusing it would break the deployment rather than protect it.
  assert.ok(allowed.has('https://hms.example.org'));
  assert.deepEqual([...allowed], ['https://hms.example.org']);
});

test('a separately hosted client has to be allowed explicitly', () => {
  const allowed = resolveAllowedOrigins({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://hms.example.org',
    CORS_ORIGINS: 'https://portal.example.org',
  });

  assert.ok(allowed.has('https://hms.example.org'));
  assert.ok(allowed.has('https://portal.example.org'));
  assert.ok(!allowed.has('https://elsewhere.example.net'));
});

test('production does not fall back to the development origins', () => {
  const allowed = resolveAllowedOrigins({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://hms.example.org',
    CORS_ORIGINS: '',
  });

  assert.ok(!allowed.has('http://localhost:3000'));
  assert.ok(!allowed.has('http://127.0.0.1:3000'));
});

test('development allows the local client origins as well as any configured ones', () => {
  const allowed = resolveAllowedOrigins({
    NODE_ENV: 'development',
    PUBLIC_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'https://portal.example.org',
  });

  assert.ok(allowed.has('http://localhost:3000'));
  assert.ok(allowed.has('http://127.0.0.1:3000'));
  assert.ok(allowed.has('https://portal.example.org'));
});

test('an unusable public URL contributes no origin rather than a broken one', () => {
  const allowed = resolveAllowedOrigins({
    NODE_ENV: 'production',
    PUBLIC_URL: 'not-a-url',
    CORS_ORIGINS: 'https://portal.example.org',
  });

  assert.deepEqual([...allowed], ['https://portal.example.org']);
});

test('a public URL with a port keeps the port in its origin', () => {
  const allowed = resolveAllowedOrigins({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://hms.example.org:8443',
    CORS_ORIGINS: '',
  });

  assert.ok(allowed.has('https://hms.example.org:8443'));
  assert.ok(!allowed.has('https://hms.example.org'));
});

test('origin lists are split and trimmed', () => {
  assert.deepEqual(
    parseOrigins(' https://a.example.org , https://b.example.org ,, '),
    ['https://a.example.org', 'https://b.example.org']
  );
  assert.deepEqual(parseOrigins(''), []);
  assert.deepEqual(parseOrigins(undefined), []);
});

test('an origin is read from an address without its path', () => {
  assert.equal(originOf('https://hms.example.org'), 'https://hms.example.org');
  assert.equal(originOf('https://hms.example.org:8443/app'), 'https://hms.example.org:8443');
  assert.equal(originOf('not-a-url'), null);
  assert.equal(originOf(''), null);
});

test('only exact browser origins pass the HTTPS origin check', () => {
  for (const origin of [
    'https://hms.example.org',
    'https://hms.example.org:8443',
  ]) {
    assert.ok(isHttpsOrigin(origin), `Expected origin to be accepted: ${origin}`);
  }

  for (const origin of [
    'http://hms.example.org',
    'https://hms.example.org/',
    'https://hms.example.org/app',
    'https://user:pass@hms.example.org',
    'not-a-url',
  ]) {
    assert.ok(!isHttpsOrigin(origin), `Expected origin to be rejected: ${origin}`);
  }
});
