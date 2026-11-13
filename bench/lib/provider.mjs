// Model outputs for the accuracy suites, always computed by the tree's own workers in Chromium
// (native onnxruntime differs slightly in its int8 kernels, so it is not used). Outputs are cached
// on disk. A cache namespace is chosen from probe outputs, so a change in truncation, dtype or
// model file starts a fresh namespace instead of reusing stale vectors.
import { join } from 'node:path';
import { CACHE } from './data.mjs';
import { VectorStore, namespaceFor, sha1 } from './store.mjs';
import { startMirror } from './mirror.mjs';
import { buildTree, serve, launch, openBench, ortInfo, decodeF32 } from './browser.mjs';

const LONG = Array.from({ length: 60 }, (_, i) => `Sentence ${i} explains how hybrid retrieval mixes keyword scores with dense vectors before a cross-encoder reranks the best passages.`).join(' ');
export const PROBES = ['What is the treatment for appendicitis?', 'Septic shock is sepsis with persistent hypotension that requires vasopressors to keep the mean arterial pressure at 65 mm Hg or more despite adequate fluids.', LONG];
const RERANK_PROBES = [
  ['how is appendicitis treated', 'The standard treatment is surgical removal of the appendix (appendectomy), with IV fluids and antibiotics.'],
  ['how is appendicitis treated', LONG],
  ['what causes hair loss in patches', 'Hybrid search merges BM25 and semantic rankings with Reciprocal Rank Fusion.'],
];

const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb || 1);
};
const slug = (m) => m.replace(/[^\w.-]+/g, '_');
const rows = (data, dim) => Array.from({ length: data.length / dim }, (_, i) => data.subarray(i * dim, (i + 1) * dim));

export class Provider {
  /** `pages`: parallel browser pages (each worker uses the tree's own thread setting). */
  /** `readOnly`: use cached outputs only (never compute or write), so it can run next to a benchmark. */
  constructor(tree, { log = () => {}, pages = 2, readOnly = false } = {}) {
    this.tree = tree;
    this.log = log;
    this.nPages = pages;
    this.readOnly = readOnly;
    this.handles = new Map();
    this.info = { embed: {}, rerank: {} };
  }

  start() {
    this.starting ||= this.launchPages();
    return this.starting;
  }

  async launchPages() {
    const ort = ortInfo(this.tree);
    this.mirror = await startMirror({ cacheDir: CACHE, ortDir: ort.dir, ortVersion: ort.version });
    this.outDir = await buildTree(this.tree);
    this.server = await serve(this.outDir, true);
    this.chrome = await launch(this.mirror);
    this.pages = [];
    for (let i = 0; i < this.nPages; i++) this.pages.push(await openBench(this.chrome, this.server.url));
    this.browserInfo = await this.pages[0].info();
    return this.pages;
  }

  /** Run `jobs` (functions taking a page) spread over the page pool. */
  async pool(jobs) {
    const pages = await this.start();
    const results = new Array(jobs.length);
    let next = 0;
    await Promise.all(
      pages.map(async (pg) => {
        while (next < jobs.length) {
          const i = next++;
          results[i] = await jobs[i](pg);
        }
      })
    );
    return results;
  }

  embedHandle(model) {
    // the promise is cached, so concurrent first calls share one store (two stores on the same
    // files would each keep their own row count and corrupt the index)
    if (!this.handles.has(`e:${model}`)) this.handles.set(`e:${model}`, this.openEmbed(model));
    return this.handles.get(`e:${model}`);
  }

  async openEmbed(model) {
    const [pg] = await this.start();
    const r = await pg.call('embed', model, PROBES);
    const ns = namespaceFor(join(CACHE, 'vec', 'embed', slug(model)), rows(decodeF32(r.b64), r.dim), (a, x) => cos(a, x) > 0.99999);
    const h = { model, dim: r.dim, store: new VectorStore(ns.dir, r.dim, { readOnly: this.readOnly }), ns: ns.id };
    this.info.embed[model] = { namespace: ns.id, cached: h.store.rows };
    this.log(`embed ${model}: cache namespace ${ns.id} (${h.store.rows} vectors cached)`);
    return h;
  }

  /** Embeddings for `texts` (exact strings, prefixes already applied) as one Float32Array. */
  async embed(model, texts) {
    const h = await this.embedHandle(model);
    const keys = texts.map(sha1);
    const missing = [...new Map(texts.map((t, i) => [keys[i], t]).filter(([k]) => !h.store.get(k))).entries()];
    if (missing.length && this.readOnly) throw new Error(`${missing.length} of ${texts.length} inputs for ${model} are not cached (read-only provider)`);
    if (missing.length) {
      const batch = 32;
      const jobs = [];
      let done = 0;
      const t0 = performance.now();
      for (let i = 0; i < missing.length; i += batch) {
        const part = missing.slice(i, i + batch);
        jobs.push(async (pg) => {
          const data = decodeF32((await pg.call('embed', model, part.map(([, t]) => t))).b64);
          part.forEach(([k], j) => h.store.set(k, data.subarray(j * h.dim, (j + 1) * h.dim)));
          done += part.length;
          if (done % 640 < batch) {
            h.store.flush();
            if (missing.length > 300) this.log(`  ${model}: ${done}/${missing.length} embedded (${(done / ((performance.now() - t0) / 1000)).toFixed(1)}/s)`);
          }
        });
      }
      await this.pool(jobs);
      h.store.flush();
    }
    const out = new Float32Array(texts.length * h.dim);
    keys.forEach((k, i) => out.set(h.store.get(k), i * h.dim));
    return { dim: h.dim, data: out };
  }

  rerankHandle(model) {
    if (!this.handles.has(`r:${model}`)) this.handles.set(`r:${model}`, this.openRerank(model));
    return this.handles.get(`r:${model}`);
  }

  async openRerank(model) {
    const [pg] = await this.start();
    const ref = [];
    for (const [q, p] of RERANK_PROBES) ref.push((await pg.call('rerank', q, [p])).scores);
    const ns = namespaceFor(join(CACHE, 'vec', 'rerank', slug(model)), ref, (a, x) => Math.abs(a[0] - x[0]) < 1e-5);
    const h = { model, store: new VectorStore(ns.dir, 1, { readOnly: this.readOnly }), ns: ns.id };
    this.info.rerank[model] = { namespace: ns.id, cached: h.store.rows };
    this.log(`rerank ${model}: cache namespace ${ns.id} (${h.store.rows} scores cached)`);
    return h;
  }

  async rerank(model, query, passages, maxLength) {
    const h = await this.rerankHandle(model);
    const keys = passages.map((p) => sha1(`${query}\u0000${p}${maxLength ? `\u0000${maxLength}` : ''}`));
    const miss = passages.map((p, i) => [keys[i], p]).filter(([k]) => !h.store.get(k));
    if (miss.length) {
      const [scores] = await this.pool([(pg) => pg.call('rerank', query, miss.map(([, p]) => p), maxLength ? { maxLength } : {}).then((r) => r.scores)]);
      miss.forEach(([k], i) => h.store.set(k, [scores[i]]));
      h.store.flush();
    }
    return keys.map((k) => h.store.get(k)[0]);
  }

  async close() {
    for (const pg of this.pages || []) await pg.close();
    await this.chrome?.close();
    await this.server?.close();
    await this.mirror?.close();
  }
}
