// SQuAD v1.1 dev as one 48-document collection, run through the tree's own pipeline:
// paginate -> clean -> chunk -> BM25 (+ embeddings) -> runQuestion with the default no-LLM
// (extractive) provider. Measures page retrieval, what reaches the prompt context, and the answer.
import { mean, normText } from '../metrics.mjs';
import { half } from '../data.mjs';
import { mapLimit } from '../engine.mjs';

const tokens = (s) => Math.round(String(s).length / 4); // engine-independent size estimate

/** Build the collection with the tree's own ingestion code. */
export async function buildCollection(E, provider, squad, { embedModel, log = () => {} } = {}) {
  const S = E.settings.DEFAULT_SETTINGS;
  const model = embedModel || S.embedModel;
  const t0 = performance.now();
  const docs = squad.map((a, ai) => {
    const pages = E.loaders.paginate(a.paragraphs.map((p) => p.context).join('\n\n'));
    const cleaned = E.clean.cleanPages(pages);
    const chunks = E.chunk.chunkPages(cleaned.pages, { chunkSize: S.chunkSize, chunkOverlap: S.chunkOverlap });
    const flat = (s) => s.replace(/\s+/g, ' ').trim();
    const pageText = cleaned.pages.map((p) => ({ page: p.page, text: flat(p.text) }));
    const pageOf = (ctx) => pageText.find((p) => p.text.includes(flat(ctx).slice(0, 60)))?.page ?? null;
    return { id: `sq${ai}`, name: a.title, pages: cleaned.pages.length, chunks, bm25: E.bm25.buildBM25(chunks), paragraphs: a.paragraphs.map((p) => ({ page: pageOf(p.context), context: p.context, qas: p.qas })) };
  });
  const ingestMs = performance.now() - t0;
  if (provider) {
    log(`squad: embedding ${docs.reduce((s, d) => s + d.chunks.length, 0)} chunks with ${model}`);
    const all = docs.flatMap((d) => d.chunks.map((c) => E.chunk.embeddingText(d.name, c)));
    const { dim, data } = await provider.embed(model, all);
    let row = 0;
    for (const d of docs) {
      const part = data.subarray(row * dim, (row + d.chunks.length) * dim);
      row += d.chunks.length;
      const { q, scales } = E.quant.quantize(part, dim);
      d.vectors = { q, scales, dim, count: d.chunks.length, model };
    }
  }
  return { docs, model, ingestMs, stats: { docs: docs.length, pages: docs.reduce((s, d) => s + d.pages, 0), chunks: docs.reduce((s, d) => s + d.chunks.length, 0) } };
}

/** Questions for a split, sampled deterministically (every `step`-th question of that half). */
export function questions(collection, split, step = 1) {
  const out = [];
  collection.docs.forEach((d) =>
    d.paragraphs.forEach((p) =>
      p.qas.forEach((q) => {
        if (half(q.id) === split && p.page) out.push({ id: q.id, question: q.question, answers: q.answers, docName: d.name, page: p.page, context: p.context });
      })
    )
  );
  return out.filter((_, i) => i % step === 0);
}

export async function squadSuite(E, provider, collection, { split = 'B', step = 2, configs, log = () => {} }) {
  const qs = questions(collection, split, step);
  const S = E.settings.DEFAULT_SETTINGS;
  const results = {};
  for (const c of configs) {
    const sets = collection.docs.map((d) => ({ doc: { id: d.id, name: d.name, embedModel: collection.model }, kb: { chunks: d.chunks, bm25: d.bm25, vectors: c.semantic === false ? null : d.vectors } }));
    if (c.semantic !== false && provider) {
      const prefix = E.workers.embedModelInfo(collection.model).queryPrefix || '';
      await provider.embed(collection.model, qs.map((q) => prefix + q.question));
    }
    const settings = { ...S, ...c.settings };
    const t0 = performance.now();
    const per = await mapLimit(qs, 4, async (q) => {
      const rec = await E.pipeline.runQuestion({ question: q.question, sets, settings });
      const primary = rec.sources.filter((s) => !s.neighbor);
      const rank = primary.findIndex((s) => s.docName === q.docName && s.page === q.page);
      const gold = q.answers.map(normText).filter(Boolean);
      const has = (t) => gold.some((g) => normText(t).includes(g));
      const bullets = String(rec.answer).split('\n').filter((l) => /^\s*[-*]\s/.test(l));
      return {
        hit1: rank === 0 ? 1 : 0,
        hitK: rank >= 0 ? 1 : 0,
        rr: rank >= 0 ? 1 / (rank + 1) : 0,
        ctx: has(E.retrieve.formatContext(rec.sources)) ? 1 : 0,
        ctxTokens: tokens(E.retrieve.formatContext(rec.sources)),
        first: bullets.length && has(bullets[0]) ? 1 : 0,
        top3: has(bullets.slice(0, 3).join(' ')) ? 1 : 0,
        any: has(rec.answer) ? 1 : 0,
        ansTokens: tokens(rec.answer),
        searchMs: (rec.timings.search || 0) + (rec.timings.queryEmbed || 0),
        totalMs: rec.timings.total,
        error: rec.error || null,
      };
    });
    const col = (k) => per.map((p) => p[k]);
    results[c.id] = {
      label: c.label,
      questions: qs.length,
      hit1: mean(col('hit1')),
      hitK: mean(col('hitK')),
      mrr: mean(col('rr')),
      goldInContext: mean(col('ctx')),
      contextTokens: mean(col('ctxTokens')),
      answerFirst: mean(col('first')),
      answerTop3: mean(col('top3')),
      answerAny: mean(col('any')),
      answerTokens: mean(col('ansTokens')),
      errors: per.filter((p) => p.error).length,
      wallMsPerQuestion: (performance.now() - t0) / qs.length,
      per: Object.fromEntries(['hit1', 'hitK', 'rr', 'ctx', 'first', 'top3', 'any', 'ansTokens', 'ctxTokens'].map((k) => [k, col(k).map((x) => +(+x).toFixed(4))])),
    };
    const r = results[c.id];
    log(`squad/${split} ${c.id}: hit@1 ${r.hit1.toFixed(3)} hit@${S.k} ${r.hitK.toFixed(3)} MRR ${r.mrr.toFixed(3)} | gold in context ${r.goldInContext.toFixed(3)} (${Math.round(r.contextTokens)} tok) | answer first ${r.answerFirst.toFixed(3)} top3 ${r.answerTop3.toFixed(3)} any ${r.answerAny.toFixed(3)} (${Math.round(r.answerTokens)} tok)`);
  }
  return { split, step, questions: qs.length, qids: qs.map((q) => q.id), configs: results };
}

export const SQUAD_CONFIGS = [
  { id: 'default', label: 'App defaults (hybrid gte-small, k=4, extractive answer)', settings: {} },
  { id: 'bm25', label: 'Keyword search only (before embeddings finish)', settings: { retrievalMode: 'bm25' }, semantic: false },
];
