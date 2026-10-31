const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateAssistantReply, isAssistantConfigured } = require('../services/aiAssistant');

const environmentKeys = ['AI_PROVIDER_ENABLED', 'AI_OLLAMA_URL', 'AI_MODEL', 'AI_TIMEOUT_MS'];

function saveEnvironment() {
  return Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('general AI is disabled unless explicitly enabled', () => {
  const previous = saveEnvironment();
  try {
    delete process.env.AI_PROVIDER_ENABLED;
    assert.equal(isAssistantConfigured(), false);

    process.env.AI_PROVIDER_ENABLED = 'true';
    assert.equal(isAssistantConfigured(), true);
  } finally {
    restoreEnvironment(previous);
  }
});

test('general replies use local Ollama and include conversational history', async () => {
  const previous = saveEnvironment();
  const previousFetch = global.fetch;
  process.env.AI_PROVIDER_ENABLED = 'true';
  process.env.AI_MODEL = 'qwen2.5:1.5b';
  process.env.AI_OLLAMA_URL = 'http://127.0.0.1:11434/';

  global.fetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options.headers.Authorization, undefined);
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.model, 'qwen2.5:1.5b');
    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.options.num_predict, 96);
    assert.deepEqual(requestBody.messages.map(item => item.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(requestBody.messages[1].content, 'Help me draft a staff meeting agenda.');
    assert.equal(requestBody.messages[2].content, 'Here is an agenda.');
    assert.equal(requestBody.messages[3].content, 'Make it shorter.');
    assert.match(requestBody.messages[0].content, /Do not diagnose/);
    return new Response(JSON.stringify({
      message: { content: 'Here is a concise agenda.' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const reply = await generateAssistantReply('Make it shorter.', [
      { role: 'user', content: 'Help me draft a staff meeting agenda.' },
      { role: 'assistant', content: 'Here is an agenda.' }
    ]);
    assert.equal(reply, 'Here is a concise agenda.');
  } finally {
    global.fetch = previousFetch;
    restoreEnvironment(previous);
  }
});
