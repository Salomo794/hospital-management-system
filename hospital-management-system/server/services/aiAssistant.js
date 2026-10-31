const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:1.5b';
const SYSTEM_PROMPT = [
  'You are a helpful general-purpose assistant inside a hospital management system.',
  'Help with general questions, writing, explanations, and non-clinical administrative work. Keep answers concise.',
  'Use the conversation history to understand references and follow-up questions. Answer directly and naturally.',
  'Do not diagnose, interpret test results, recommend treatments, medicines, doses, or triage.',
  'Do not claim to access or change hospital records; no records are provided to you.',
  'Do not ask for patient identifiers or sensitive health information.',
  'For individual medical questions, direct the user to a licensed clinician. For emergencies, advise contacting local emergency services.'
].join(' ');

function isAssistantConfigured() {
  return process.env.AI_PROVIDER_ENABLED === 'true';
}

async function generateAssistantReply(message, history = []) {
  if (!isAssistantConfigured()) return null;

  const baseUrl = (process.env.AI_OLLAMA_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const timeoutMs = Math.max(1000, Math.min(Number(process.env.AI_TIMEOUT_MS) || 60000, 120000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.map(({ role, content }) => ({ role, content })),
          { role: 'user', content: message }
        ],
        stream: false,
        options: { temperature: 0.3, num_predict: 96 }
      }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);

    const result = await response.json();
    const reply = result.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      throw new Error('Ollama returned an empty response');
    }
    return reply.trim();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Local AI request timed out');
    if (error.message.startsWith('Ollama returned')) throw error;
    throw new Error('Could not reach the local Ollama service');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { generateAssistantReply, isAssistantConfigured };
