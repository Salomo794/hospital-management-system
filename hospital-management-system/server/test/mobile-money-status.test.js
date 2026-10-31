const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretGatewayStatus } = require('../services/mobileMoney');

test('keeps non-terminal gateway states pending', () => {
  for (const status of ['pending', 'processing', 'queued', 'ongoing']) {
    assert.equal(interpretGatewayStatus({ status, reference: 'ref-1' }, 'ref-1').status, 'pending');
  }
});

test('treats a reversed gateway transaction as failed, not pending', () => {
  const result = interpretGatewayStatus({ status: 'reversed', reference: 'ref-2' }, 'ref-2');
  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'Payment reversed');
});

test('continues to treat successful gateway transactions as completed', () => {
  const result = interpretGatewayStatus({ status: 'success', reference: 'ref-3', amount: 12500, currency: 'RWF' }, 'ref-3');
  assert.equal(result.status, 'completed');
  assert.equal(result.amount, 125);
  assert.equal(result.currency, 'RWF');
});
