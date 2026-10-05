// Claude through the official Anthropic SDK, called straight from the browser with the
// user's own key (kept in memory only). The SDK is loaded on first use so it costs
// nothing for people who never pick Claude.

import { estimateTokens } from './text.js';

// Models that reject temperature / top_p and take an effort level instead.
const isModern = (model) => /^claude-(opus|sonnet|fable)-[5-9]/.test(model) || /^claude-(opus|sonnet)-4-[6-9]/.test(model);
// Models that ship with server-side refusal fallbacks switched on.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Thinking counts toward max_tokens on these models, so leave room for it on top of the answer.
const THINKING_HEADROOM = { low: 2048, medium: 4096, high: 8192 };

let sdk;
async function client(apiKey) {
  sdk ||= (await import('@anthropic-ai/sdk')).default;
  return new sdk({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** The request body for a chat in OpenAI-style messages. Pure, so it can be unit tested. */
export function buildClaudeRequest({ model, messages, maxTokens = 512, temperature = 0, effort = 'medium' }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last?.role === role) last.content += `\n\n${m.content}`;
    else turns.push({ role, content: m.content });
  }
  // the conversation must start with the user and end with the user (no assistant prefill)
  if (turns[0]?.role !== 'user') turns.unshift({ role: 'user', content: '(conversation continues)' });
  if (turns[turns.length - 1]?.role !== 'user') turns.push({ role: 'user', content: 'Continue.' });

  const req = { model, max_tokens: maxTokens, messages: turns };
  if (system) req.system = system;
  if (isModern(model)) {
    const level = THINKING_HEADROOM[effort] ? effort : 'medium';
    req.output_config = { effort: level };
    req.max_tokens = maxTokens + THINKING_HEADROOM[level];
  } else {
    req.temperature = temperature;
  }
  if (FALLBACK_MODELS.has(model)) {
    req.betas = [FALLBACK_BETA];
    req.fallbacks = 'default';
  }
  return req;
}

/** Convert SDK errors to { status, detail } so the caller can show a friendly message. */
function toFailure(e, signal) {
  if (signal?.aborted || e?.name === 'AbortError' || e?.constructor?.name === 'APIUserAbortError') return new DOMException('Aborted', 'AbortError');
  const status = typeof e?.status === 'number' ? e.status : 0;
  const detail = e?.error?.error?.message || e?.message || String(e);
  return Object.assign(new Error(detail), { status, detail });
}

/**
 * Stream one answer. Returns the same shape as the OpenAI-compatible client.
 * Throws { status, detail } errors (status 0 = network or browser block).
 */
export async function claudeGenerate({ apiKey, model, messages, maxTokens, temperature, effort, onToken, signal }) {
  const t0 = performance.now();
  const req = buildClaudeRequest({ model, messages, maxTokens, temperature, effort });
  let text = '';
  let ttft = null;
  let msg;
  try {
    const c = await client(apiKey);
    const stream = c.beta.messages.stream(req, { signal });
    stream.on('text', (delta) => {
      if (ttft == null) ttft = performance.now() - t0;
      text += delta;
      onToken?.(text);
    });
    msg = await stream.finalMessage();
  } catch (e) {
    throw toFailure(e, signal);
  }
  if (msg.stop_reason === 'refusal') {
    throw Object.assign(new Error('refusal'), { status: 'refusal', detail: msg.stop_details?.category || '' });
  }
  const finalText = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('') || text;
  const fellBack = (msg.usage?.iterations || []).some((it) => it.type === 'fallback_message');
  return {
    text: finalText.trim(),
    finishReason: msg.stop_reason === 'max_tokens' ? 'length' : 'stop',
    promptTokens: msg.usage?.input_tokens ?? estimateTokens(messages.map((m) => m.content).join('\n')),
    completionTokens: msg.usage?.output_tokens ?? estimateTokens(finalText),
    tokensEstimated: !msg.usage,
    latencyMs: performance.now() - t0,
    ttftMs: ttft,
    servedBy: fellBack ? msg.model : undefined,
  };
}

/** Model ids this key can use (free call, no tokens billed). */
export async function claudeModels(apiKey) {
  try {
    const c = await client(apiKey);
    const ids = [];
    for await (const m of c.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  } catch (e) {
    throw toFailure(e);
  }
}
