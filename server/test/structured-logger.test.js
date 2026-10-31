const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { structuredLogger } = require('../middleware/structuredLogger');

// Production logs are read by a log aggregator, and the request id is what ties a
// line to the response a user saw. It is assigned by a middleware that runs after
// this logger, so the logger has to read it when the response finishes.

function runRequest({ env = 'production', assignIdAfterLogger }) {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  const lines = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = chunk => { lines.push(String(chunk)); return true; };

  try {
    const headers = {};
    const req = {
      method: 'GET',
      path: '/api/health',
      ip: '10.0.0.1',
      header: () => undefined,
      get: () => 'test-agent',
    };
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      getHeader: name => headers[name],
      setHeader: (name, value) => { headers[name] = value; },
    });

    let nextCalls = 0;
    structuredLogger(req, res, () => { nextCalls += 1; });
    // What the request-id middleware does, after the logger has already run.
    assignIdAfterLogger(req, res);
    res.emit('finish');
    return { lines, nextCalls };
  } finally {
    process.stdout.write = originalWrite;
    process.env.NODE_ENV = previousEnv;
  }
}

test('the logged request id is the one assigned after the logger ran', () => {
  const { lines, nextCalls } = runRequest({
    assignIdAfterLogger: (req, res) => {
      req.requestId = 'abc-123';
      res.setHeader('X-Request-ID', 'abc-123');
    },
  });
  assert.equal(nextCalls, 1);
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.request_id, 'abc-123');
  assert.equal(entry.path, '/api/health');
  assert.equal(entry.status, 200);
});

test('nothing is logged outside production', () => {
  const { lines, nextCalls } = runRequest({ env: 'development', assignIdAfterLogger: () => {} });
  assert.equal(nextCalls, 1);
  assert.equal(lines.length, 0);
});
