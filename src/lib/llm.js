import { estimateTokens, tokenize, splitSentences } from './text.js';
import { FALLBACK_ANSWER } from './prompts.js';
import { sourceLabel } from './retrieve.js';
import { browserGenerate } from './workers.js';
import { ROUTER_URL, HF_MODELS as HF_CATALOGUE, friendlyError } from './hf.js';
import { recordUsage } from './usage.js';
import { PROVIDERS, apiKeyOf, keyModelOf, dataClass, dataHost } from './providers.js';

// Provider registry (labels, privacy class, key links) lives in providers.js.
export { PROVIDERS } from './providers.js';

export const HF_MODELS = HF_CATALOGUE.map((m) => m.id);

export const BROWSER_MODELS = [
  { id: 'onnx-community/Qwen2.5-0.5B-Instruct', label: 'Qwen2.5 0.5B Instruct (~400 MB, fastest)' },
  { id: 'onnx-community/Llama-3.2-1B-Instruct', label: 'Llama 3.2 1B Instruct (~1 GB)' },
  { id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', label: 'SmolLM2 1.7B Instruct (~1.1 GB, WebGPU)' },
];

export function providerLabel(s) {
  const p = PROVIDERS[s.provider];
  if (s.provider === 'hf') return `HF · ${s.hfModel}`;
  if (s.provider === 'custom') return `${s.openaiModel} @ ${s.openaiBaseUrl.replace(/^https?:\/\//, '')}`;
  if (s.provider === 'browser') return `Browser · ${s.browserModel.split('/').pop()}`;
  if (p?.group === 'key') return `${p.label} · ${keyModelOf(s)}`;
  return 'Extractive (no LLM)';
}

/** Error with an HTTP status and an actionable hint for the UI. */
export class LLMError extends Error {
  constructor(status, detail, ctx) {
    const f = friendlyError(status, detail, ctx);
    super(`${f.title}: ${f.hint}`);
    Object.assign(this, { status, detail, title: f.title, hint: f.hint, billing: !!f.billing });
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const sleepAbortable = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Aborted', 'AbortError'))), { once: true });
  });

async function chatCompletions({ url, key, model, messages, maxTokens, temperature, topP, onToken, signal, extraHeaders, provider, retries = 2 }) {
  const t0 = performance.now();
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (key) headers.Authorization = `Bearer ${key}`;
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
    stream: true,
    stream_options: { include_usage: true },
  };
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      // TypeError "Failed to fetch": offline, or the provider does not allow calls from web pages (CORS)
      if (e.name === 'AbortError') throw e;
      throw new LLMError(0, String(e.message || e), { model, provider });
    }
    if (res.ok) break;
    const errText = await res.text().catch(() => '');
    // some OpenAI-compatible servers reject stream_options: retry once without it (only for that error)
    if (res.status === 400 && body.stream_options && /stream_options|include_usage/i.test(errText)) {
      delete body.stream_options;
      continue;
    }
    // rate limits and provider outages: back off and retry (never for auth/credit errors)
    if (RETRYABLE.has(res.status) && attempt < retries) {
      const after = Number(res.headers.get('retry-after'));
      await sleepAbortable(Number.isFinite(after) && after > 0 ? Math.min(after, 20) * 1000 : 1500 * 2 ** attempt, signal);
      continue;
    }
    let detail = errText;
    try {
      const j = JSON.parse(errText);
      detail = j.error?.message || (typeof j.error === 'string' ? j.error : '') || j.message || errText;
    } catch {
      /* not JSON, keep the raw text */
    }
    throw new LLMError(res.status, detail, { model, provider });
  }
  let text = '';
  let ttft = null;
  let finishReason = null;
  let usage = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.usage) usage = j.usage;
      const choice = j.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta?.content ?? choice.text ?? '';
      if (delta) {
        if (ttft == null) ttft = performance.now() - t0;
        text += delta;
        onToken?.(text);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  const promptText = messages.map((m) => m.content).join('\n');
  return {
    text: text.trim(),
    finishReason: finishReason || 'stop',
    promptTokens: usage?.prompt_tokens ?? estimateTokens(promptText),
    completionTokens: usage?.completion_tokens ?? estimateTokens(text),
    tokensEstimated: !usage,
    latencyMs: performance.now() - t0,
    ttftMs: ttft,
  };
}

/**
 * Generate a chat completion with the configured provider.
 * `settings._meter`, when present, counts what left the device for this question.
 */
export async function generate(settings, { messages, maxTokens, temperature, topP, onToken, signal, purpose = 'answer' }) {
  const cloud = dataClass(settings) === 'cloud';
  // Confidential mode: refuse before anything is sent off this device
  if (settings.confidential && cloud) throw new LLMError('confidential', '', { provider: settings.provider });
  if (settings.provider === 'browser' || settings.provider === 'extractive') return localGenerate(settings, { messages, maxTokens, temperature, topP, onToken, signal });
  try {
    const r = await remoteGenerate(settings, { messages, maxTokens, temperature, topP, onToken, signal, purpose });
    recordUsage({ purpose, promptTokens: r.promptTokens, completionTokens: r.completionTokens });
    const m = settings._meter;
    if (m && cloud) {
      m.host = dataHost(settings);
      m.calls++;
      m.promptTokens += r.promptTokens;
    }
    return r;
  } catch (e) {
    if (e.name !== 'AbortError') recordUsage({ purpose, failed: true });
    throw e;
  }
}

/** Model id sent to the router: an optional provider policy (":fastest" / ":cheapest") is appended. */
export function hfModelId(settings) {
  const m = (settings.hfModel || '').trim();
  return settings.hfPolicy && !m.includes(':') ? `${m}:${settings.hfPolicy}` : m;
}

async function remoteGenerate(settings, { messages, maxTokens, temperature, topP, onToken, signal, purpose }) {
  const p = settings.provider;
  const info = PROVIDERS[p];
  const common = {
    messages,
    maxTokens: maxTokens ?? settings.maxTokens,
    temperature: temperature ?? settings.temperature,
    topP: topP ?? settings.topP,
    onToken,
    signal,
  };
  if (p === 'hf') {
    const token = (settings.hfToken || '').trim();
    if (!token) throw new Error('Enter your Hugging Face token (it is kept only in memory for this tab, so it is needed again after a reload).');
    if (!token.startsWith('hf_')) throw new LLMError(401, 'Token does not start with hf_', { provider: 'hf' });
    const billTo = (settings.hfBillTo || '').trim();
    return chatCompletions({
      ...common,
      url: ROUTER_URL,
      key: token,
      model: hfModelId(settings),
      provider: 'hf',
      // PRO / Team / Enterprise: charge an organisation instead of the personal account
      extraHeaders: billTo ? { 'X-HF-Bill-To': billTo } : undefined,
    });
  }
  if (info?.group === 'key') {
    const key = apiKeyOf(settings);
    if (!key) throw new Error(`Enter your ${info.label} API key in Settings (it is kept only in memory for this tab, so it is needed again after a reload).`);
    const model = keyModelOf(settings);
    if (info.kind === 'anthropic') {
      const { claudeGenerate } = await import('./anthropic.js');
      try {
        // short helper calls (judge, rewrite, suggestions) think less: faster and cheaper
        const effort = purpose === 'answer' || purpose === 'vanilla' ? settings.claudeEffort : 'low';
        return await claudeGenerate({ ...common, apiKey: key, model, effort });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new LLMError(e.status ?? 0, e.detail, { model, provider: p });
      }
    }
    return chatCompletions({
      ...common,
      url: `${info.baseUrl}/chat/completions`,
      key,
      model,
      provider: p,
      extraHeaders: p === 'openrouter' ? { 'X-Title': 'RAG AI Studio' } : undefined,
    });
  }
  return chatCompletions({
    ...common,
    url: settings.openaiBaseUrl.replace(/\/$/, '') + '/chat/completions',
    key: settings.openaiKey,
    model: settings.openaiModel,
    provider: 'custom',
  });
}

/** Model ids a key provider offers to this key (a free listing call, no tokens billed). */
export async function listModels(settings, id = settings.provider) {
  const info = PROVIDERS[id];
  const key = apiKeyOf(settings, id);
  if (!key) throw new Error('Enter the API key first.');
  if (info.kind === 'anthropic') {
    const { claudeModels } = await import('./anthropic.js');
    try {
      return await claudeModels(key);
    } catch (e) {
      throw new LLMError(e.status ?? 0, e.detail, { provider: id });
    }
  }
  let res;
  try {
    res = await fetch(`${info.baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } });
  } catch (e) {
    throw new LLMError(0, String(e.message || e), { provider: id });
  }
  if (!res.ok) throw new LLMError(res.status, await res.text().catch(() => ''), { provider: id });
  const j = await res.json();
  return (j.data || j.models || [])
    .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}

async function localGenerate(settings, { messages, maxTokens, temperature, topP, onToken, signal }) {
  const p = settings.provider;
  const common = { messages, maxTokens: maxTokens ?? settings.maxTokens, temperature: temperature ?? settings.temperature, topP: topP ?? settings.topP, onToken, signal };
  if (p === 'browser') {
    return browserGenerate(settings.browserModel, common);
  }
  throw new Error('The extractive provider does not generate free text.');
}

/**
 * Extractive answer: no LLM. Picks the sentences from the retrieved chunks that best
 * cover the question, removes near-duplicates and cites each one. 100% grounded by design.
 */
export function extractiveAnswer(question, sources, { maxSentences = 8 } = {}) {
  const t0 = performance.now();
  const q = new Set(tokenize(question));
  const cands = [];
  const top = Math.max(...sources.map((s) => s.score || 0), 1e-9);
  sources.filter((s) => !s.neighbor).forEach((s, rank) => {
    const rel = Math.sqrt(Math.max(0, s.score || 0) / top);
    splitSentences(s.text).forEach((sent, pos) => {
      const clean = sent.replace(/\s+/g, ' ').trim();
      if (clean.length < 40 || clean.length > 420) return;
      const toks = tokenize(clean);
      if (toks.length < 4) return;
      const set = new Set(toks);
      const hits = [...set].filter((t) => q.has(t)).length;
      if (!hits) return;
      const score = (hits / Math.sqrt(set.size)) * (0.3 + 0.7 * rel);
      cands.push({ text: clean, label: sourceLabel(s), score, set, rank, pos });
    });
  });
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0]?.score || 0;
  const chosen = [];
  for (const c of cands) {
    if (chosen.length >= maxSentences || c.score < best * 0.45) break;
    const dup = chosen.some((x) => [...c.set].filter((t) => x.set.has(t)).length / c.set.size > 0.7);
    if (!dup) chosen.push(c);
  }
  // keep the manual's reading order so the answer flows naturally
  chosen.sort((a, b) => a.rank - b.rank || a.pos - b.pos);
  const labels = [...new Set(chosen.map((c) => c.label))];
  const text = chosen.length
    ? `**Key passages from the documents**\n${chosen.map((c) => `- ${c.text} [${c.label}]`).join('\n')}\n\nSources: [${labels.join('; ')}]`
    : FALLBACK_ANSWER;
  return {
    text,
    finishReason: 'stop',
    promptTokens: 0,
    completionTokens: estimateTokens(text),
    latencyMs: performance.now() - t0,
    ttftMs: null,
    extractive: true,
  };
}
