// Optional LLM integration. Everything works fully offline with the
// rule-based engines; if the user configures an OpenAI-compatible endpoint +
// API key here, the tone and arrangement features upgrade to LLM reasoning.
//
// Config is stored in localStorage (client-side only — the key never leaves the
// browser except to the endpoint the user chose). Works with OpenAI, Groq,
// OpenRouter, Together, or a local server (LM Studio / Ollama's OpenAI shim).

const STORAGE_KEY = 'thallforge.llm';

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  enabled: false,
};

export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LLM_CONFIG };
    return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

export function saveLLMConfig(cfg: LLMConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function isLLMConfigured(): boolean {
  const cfg = loadLLMConfig();
  return cfg.enabled && cfg.apiKey.trim().length > 0 && cfg.endpoint.trim().length > 0;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Call the configured chat endpoint and parse a JSON object out of the reply.
 * Throws on network/parse error so callers can fall back to the rule engine.
 */
export async function chatJSON<T>(messages: ChatMessage[]): Promise<T> {
  const cfg = loadLLMConfig();
  if (!isLLMConfigured()) throw new Error('LLM not configured');

  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  return extractJSON<T>(content);
}

/** Pull the first JSON object out of a model reply (handles code fences). */
export function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in LLM reply');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
