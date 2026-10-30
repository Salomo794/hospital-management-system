const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const SYSTEM_PROMPT = [
  'You are a general-purpose assistant inside a hospital management system.',
  'Help with general writing, explanations, and non-clinical administrative questions only.',
  'Do not diagnose, interpret test results, recommend treatments, medicines, doses, or triage.',
  'Do not claim to access or change hospital records; no records are provided to you.',
  'Do not ask for patient identifiers or sensitive health information.',
  'For individual medical questions, direct the user to a licensed clinician. For emergencies, advise contacting local emergency services.'
].join(' ');

function isAssistantConfigured() {
  return process.env.AI_PROVIDER_ENABLED === 'true' && Boolean(process.env.AI_API_KEY?.trim());
}

async function generateAssistantReply(message) {
  if (!isAssistantConfigured()) return null;

  const endpoint = process.env.AI_CHAT_COMPLETIONS_URL || DEFAULT_ENDPOINT;
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const timeoutMs = Math.max(1000, Math.min(Number(process.env.AI_TIMEOUT_MS) || 15000, 60000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message }
        ],
        temperature: 0.3,
        max_tokens: 500
      }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);

    const result = await response.json();
    const reply = result.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      throw new Error('AI provider returned an empty response');
    }
    return reply.trim();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI provider request timed out');
    if (error.message.startsWith('AI provider')) throw error;
    throw new Error('AI provider request failed');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { generateAssistantReply, isAssistantConfigured };