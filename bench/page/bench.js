// Runs inside the app tree under test (copied to <tree>/bench-page/ by bench/lib/browser.mjs),
// so every number comes from that tree's own workers, ingestion, retrieval and pipeline code.
import * as W from '../src/lib/workers.js';
import * as KB from '../src/lib/kb.js';
import * as P from '../src/lib/pipeline.js';
import * as S from '../src/lib/settings.js';
import { buildBM25 } from '../src/lib/bm25.js';

const statuses = {};
for (const [name, client] of [
  ['embed', W.embedClient],
  ['rerank', W.rerankClient],
  ['gen', W.genClient],
]) {
  client.onStatus((m) => {
    if (m.type === 'ready') statuses[name] = { device: m.device, threads: m.threads ?? null, build: m.build ?? null, dtype: m.dtype ?? null };
  });
}

const toB64 = (typed) => {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64, Type) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
};

let sets = [];

window.bench = {
  info: () => ({
    crossOriginIsolated: self.crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    webgpu: 'gpu' in navigator,
    userAgent: navigator.userAgent,
    statuses,
    hasProviderDefaults: typeof S.settingsForProvider === 'function',
  }),

  async embed(model, texts) {
    const t0 = performance.now();
    const { dim, data } = await W.embedTexts(model, texts);
    return { dim, ms: performance.now() - t0, b64: toB64(data) };
  },

  async rerank(query, passages) {
    const t0 = performance.now();
    const scores = await W.rerank(query, passages);
    return { scores, ms: performance.now() - t0 };
  },

  /** Latency of single query embeddings (unique texts, so the query cache never hits). */
  async timeQueries(model, texts) {
    const ms = [];
    for (const t of texts) {
      const t0 = performance.now();
      await W.embedQuery(model, t);
      ms.push(performance.now() - t0);
    }
    return ms;
  },

  /** Real ingestion: ingestFile (ingest worker + IndexedDB) then the background EmbedJob. */
  async indexDocs(files, opts) {
    const out = [];
    for (const f of files) {
      const t0 = performance.now();
      const doc = await KB.ingestFile(new File([f.text], f.name, { type: 'text/plain' }), opts, () => {});
      const t1 = performance.now();
      await new Promise((resolve, reject) => {
        const job = new KB.EmbedJob(doc, { onDone: resolve, onError: reject });
        job.start();
      });
      out.push({ name: f.name, chunks: doc.chunkStats.count, ingestMs: t1 - t0, embedMs: performance.now() - t1, stages: doc.timings });
    }
    return out;
  },

  /** Load prepared knowledge (chunks + int8 vectors) without re-embedding. */
  loadSets(packs) {
    sets = packs.map((p) => {
      const kb = {
        chunks: p.chunks,
        bm25: buildBM25(p.chunks),
        vectors: p.q ? { q: fromB64(p.q, Int8Array), scales: fromB64(p.scales, Float32Array), dim: p.dim, count: p.chunks.length, model: p.model } : null,
      };
      return { doc: { id: p.id, name: p.name, embedModel: p.model }, kb };
    });
    return sets.length;
  },

  /** One full answer with the in-browser model, using this tree's defaults for that provider. */
  async answer(question, overrides = {}) {
    const base = { ...S.DEFAULT_SETTINGS, provider: 'browser' };
    const settings = { ...(typeof S.settingsForProvider === 'function' ? S.settingsForProvider(base, 'browser') : base), ...overrides };
    const rec = await P.runQuestion({ question, sets, settings });
    return {
      answer: rec.answer,
      error: rec.error || null,
      timings: rec.timings,
      gen: rec.gen,
      judged: !!rec.eval?.judge,
      support: rec.eval?.heuristic?.support?.share ?? null,
      sources: rec.sources.filter((s) => !s.neighbor).map((s) => ({ docName: s.docName, page: s.page })),
      contextTokens: rec.trace?.contextTokens ?? null,
      config: rec.config,
    };
  },

  /** Raw generation, for prefill/decode speed with fixed prompts. */
  async generate(model, messages, maxTokens) {
    const t0 = performance.now();
    let first = null;
    const r = await W.browserGenerate(model, {
      messages,
      maxTokens,
      temperature: 0,
      topP: 1,
      onToken: () => {
        if (first == null) first = performance.now() - t0;
      },
    });
    return { text: r.text, promptTokens: r.promptTokens, completionTokens: r.completionTokens, wallMs: performance.now() - t0, firstTokenMs: first, device: r.device };
  },

  /** Time to load a model into a worker (cold or from the browser cache). */
  async load(kind, model) {
    const client = { embed: W.embedClient, rerank: W.rerankClient, gen: W.genClient }[kind];
    const t0 = performance.now();
    if (kind === 'rerank') await W.rerank('warm up', ['warm up']);
    else if (kind === 'embed') await W.embedTexts(model, ['warm up']);
    else await client.call({ type: 'load', model });
    return performance.now() - t0;
  },
};

document.getElementById('status').textContent = 'ready';
window.benchReady = true;
