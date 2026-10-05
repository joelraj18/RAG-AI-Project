import { estimateTokens, tokenize, splitSentences } from './text.js';
import { FALLBACK_ANSWER } from './prompts.js';
import { browserGenerate } from './workers.js';

// LLM providers. All of them are free to use:
//  - "hf":         Hugging Face Inference Providers (OpenAI-compatible router) with a free HF token
//  - "openai":     any OpenAI-compatible endpoint (Ollama on localhost, Groq free tier, OpenRouter, LM Studio…)
//  - "browser":    a small instruct model running fully in the browser via transformers.js (WebGPU/WASM)
//  - "extractive": no LLM at all – builds a cited answer from the best retrieved sentences (instant)

export const PROVIDERS = {
  hf: { label: 'Hugging Face (free token)', needsKey: true },
  openai: { label: 'OpenAI-compatible (Ollama, Groq, OpenRouter…)', needsKey: false },
  browser: { label: 'In-browser model (private, no key)', needsKey: false },
  extractive: { label: 'Extractive (no LLM, instant)', needsKey: false },
};

export const HF_MODELS = [
  'meta-llama/Llama-3.1-8B-Instruct',
  'Qwen/Qwen2.5-7B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.2',
  'google/gemma-2-9b-it',
  'Qwen/Qwen2.5-72B-Instruct',
  'meta-llama/Llama-3.3-70B-Instruct',
];

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

async function chatCompletions({ url, key, model, messages, maxTokens, temperature, topP, onToken, signal }) {
  const t0 = performance.now();
  const headers = { 'Content-Type': 'application/json' };
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
  let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (res.status === 400) {
    // some servers reject stream_options – retry without it
    delete body.stream_options;
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.error?.message || j.error || j.message || JSON.stringify(j);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`${res.status} ${res.statusText}: ${String(detail).slice(0, 300)}`);
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
export async function generate(settings, { messages, maxTokens, temperature, topP, onToken, signal }) {
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
    if (!settings.hfToken) throw new Error('Add your free Hugging Face token in Settings (huggingface.co/settings/tokens).');
    return chatCompletions({
      ...common,
      url: 'https://router.huggingface.co/v1/chat/completions',
      key: settings.hfToken,
      model: settings.hfModel,
    });
  }
  if (p === 'openai') {
    return chatCompletions({
      ...common,
      url: settings.openaiBaseUrl.replace(/\/$/, '') + '/chat/completions',
      key: settings.openaiKey,
      model: settings.openaiModel,
    });
  }
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
  sources.forEach((s, rank) => {
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
      cands.push({ text: clean, page: s.page, score, set, rank, pos });
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
  const pages = [...new Set(chosen.map((c) => c.page))].sort((a, b) => a - b);
  const text = chosen.length
    ? `**Key passages from the manual**\n${chosen.map((c) => `- ${c.text} [PDF p. ${c.page}]`).join('\n')}\n\nSources: [PDF p. ${pages.join(', ')}]`
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
