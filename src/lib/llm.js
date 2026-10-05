import { estimateTokens, tokenize, splitSentences } from './text.js';
import { FALLBACK_ANSWER } from './prompts.js';
import { sourceLabel } from './retrieve.js';
import { browserGenerate } from './workers.js';
import { ROUTER_URL, HF_MODELS as HF_CATALOGUE, friendlyError } from './hf.js';
import { recordUsage } from './usage.js';

// LLM providers. All of them are free to use:
//  - "hf":         Hugging Face Inference Providers (OpenAI-compatible router) with a free HF token
//  - "openai":     any OpenAI-compatible endpoint (Ollama on localhost, Groq free tier, OpenRouter, LM Studio…)
//  - "browser":    a small instruct model running fully in the browser via transformers.js (WebGPU/WASM)
//  - "extractive": no LLM at all – builds a cited answer from the best retrieved sentences (instant)

export const PROVIDERS = {
  hf: {
    label: 'Hugging Face Inference',
    tags: ['recommended', 'quality'],
    cost: 'free token · ~2–8 s per answer',
    why: 'Best answer quality for free: 8B–70B models on HF servers, plus the LLM judge.',
  },
  openai: {
    label: 'OpenAI-compatible (Ollama, Groq…)',
    tags: ['private'],
    cost: 'local GPU or free tier',
    why: 'Run Mistral-7B (the notebook model) on your own machine with Ollama, or use Groq for very fast replies.',
  },
  browser: {
    label: 'In-browser model',
    tags: ['private'],
    cost: '0.4–1.1 GB download once · slow without WebGPU',
    why: 'Nothing leaves the device. Small models (0.5–1.7B) give shorter, simpler answers.',
  },
  extractive: {
    label: 'Extractive (no LLM)',
    tags: ['fastest', 'lightest'],
    cost: 'instant · no setup',
    why: 'Quotes the most relevant sentences with citations. Always grounded, but no synthesis and no LLM judge.',
  },
};

export const HF_MODELS = HF_CATALOGUE.map((m) => m.id);

export const BROWSER_MODELS = [
  { id: 'onnx-community/Qwen2.5-0.5B-Instruct', label: 'Qwen2.5 0.5B Instruct (~400 MB, fastest)' },
  { id: 'onnx-community/Llama-3.2-1B-Instruct', label: 'Llama 3.2 1B Instruct (~1 GB)' },
  { id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', label: 'SmolLM2 1.7B Instruct (~1.1 GB, WebGPU)' },
];

export function providerLabel(s) {
  if (s.provider === 'hf') return `HF · ${s.hfModel}`;
  if (s.provider === 'openai') return `${s.openaiModel} @ ${s.openaiBaseUrl.replace(/^https?:\/\//, '')}`;
  if (s.provider === 'browser') return `Browser · ${s.browserModel.split('/').pop()}`;
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
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
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
      /* not JSON – keep the raw text */
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

/** Generate a chat completion with the configured provider. */
export async function generate(settings, { messages, maxTokens, temperature, topP, onToken, signal, purpose = 'answer' }) {
  const p = settings.provider;
  if (p === 'hf' || p === 'openai') {
    try {
      const r = await remoteGenerate(settings, { messages, maxTokens, temperature, topP, onToken, signal });
      recordUsage({ purpose, promptTokens: r.promptTokens, completionTokens: r.completionTokens });
      return r;
    } catch (e) {
      if (e.name !== 'AbortError') recordUsage({ purpose, failed: true });
      throw e;
    }
  }
  return localGenerate(settings, { messages, maxTokens, temperature, topP, onToken, signal });
}

/** Model id sent to the router: an optional provider policy (":fastest" / ":cheapest") is appended. */
export function hfModelId(settings) {
  const m = (settings.hfModel || '').trim();
  return settings.hfPolicy && !m.includes(':') ? `${m}:${settings.hfPolicy}` : m;
}

async function remoteGenerate(settings, { messages, maxTokens, temperature, topP, onToken, signal }) {
  const p = settings.provider;
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
  return chatCompletions({
    ...common,
    url: settings.openaiBaseUrl.replace(/\/$/, '') + '/chat/completions',
    key: settings.openaiKey,
    model: settings.openaiModel,
    provider: 'openai',
  });
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
