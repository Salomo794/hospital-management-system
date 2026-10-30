const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateAssistantReply, isAssistantConfigured } = require('../services/aiAssistant');

const environmentKeys = [
  'AI_PROVIDER_ENABLED',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_CHAT_COMPLETIONS_URL',
  'AI_TIMEOUT_MS'
];

function saveEnvironment() {
  return Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('general AI is disabled unless explicitly enabled with a provider key', () => {
  const previous = saveEnvironment();
  try {
    delete process.env.AI_PROVIDER_ENABLED;
    delete process.env.AI_API_KEY;
    assert.equal(isAssistantConfigured(), false);

    process.env.AI_PROVIDER_ENABLED = 'true';
    assert.equal(isAssistantConfigured(), false);

    process.env.AI_API_KEY = 'test-key';
    assert.equal(isAssistantConfigured(), true);
  } finally {
    restoreEnvironment(previous);
  }
});

test('general replies send only the typed prompt and parse the provider response', async () => {
  const previous = saveEnvironment();
  const previousFetch = global.fetch;
  process.env.AI_PROVIDER_ENABLED = 'true';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_MODEL = 'test-model';
  process.env.AI_CHAT_COMPLETIONS_URL = 'https://provider.test/v1/chat/completions';

  global.fetch = async (url, options) => {
    assert.equal(url, process.env.AI_CHAT_COMPLETIONS_URL);
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.model, 'test-model');
    assert.deepEqual(requestBody.messages.map(item => item.role), ['system', 'user']);
    assert.equal(requestBody.messages[1].content, 'Help me draft a staff meeting agenda.');
    assert.match(requestBody.messages[0].content, /Do not diagnose/);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Here is a concise agenda.' } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const reply = await generateAssistantReply('Help me draft a staff meeting agenda.');
    assert.equal(reply, 'Here is a concise agenda.');
  } finally {
    global.fetch = previousFetch;
    restoreEnvironment(previous);
  }
});