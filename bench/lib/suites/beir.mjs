// BEIR retrieval (SciFact, NFCorpus): each abstract is one chunk (section = title), so the numbers
// compare with published BEIR / MTEB results. Retrieval goes through the tree's own retrieve().
import { ndcg, mrr, recall, mean } from '../metrics.mjs';
import { mapLimit } from '../engine.mjs';

export const BEIR_CONFIGS = [
  { id: 'bm25', label: 'BM25 keyword search', mode: 'bm25', r100: true },
  { id: 'sem-minilm', label: 'Semantic, all-MiniLM-L6-v2', mode: 'semantic', model: 'Xenova/all-MiniLM-L6-v2', r100: true },
  { id: 'sem-gte', label: 'Semantic, gte-small', mode: 'semantic', model: 'Xenova/gte-small', r100: true },
  { id: 'sem-bge', label: 'Semantic, bge-small-en-v1.5', mode: 'semantic', model: 'Xenova/bge-small-en-v1.5', r100: true },
  { id: 'hybrid-gte', label: 'Hybrid (BM25 + gte-small), app default', mode: 'hybrid', model: 'Xenova/gte-small', r100: true },
  { id: 'hybrid-gte-rerank', label: 'Hybrid + cross-encoder rerank', mode: 'hybrid', model: 'Xenova/gte-small', rerank: true },
];

export async function beirSuite(E, provider, { name, data, split, configs = BEIR_CONFIGS, log = () => {} }) {
  const { corpus, queries } = data;
  const qrels = data.qrels[split];
  const qids = Object.keys(qrels).filter((q) => queries[q]);
  const chunks = corpus.map((d, i) => ({ id: i, page: i + 1, section: d.title, text: d.text, tokens: E.text.estimateTokens(d.text) }));
  const t0 = performance.now();
  const bm25 = E.bm25.buildBM25(chunks);
  const bm25Ms = performance.now() - t0;
  const defaults = E.settings.DEFAULT_SETTINGS;

  const sets = { none: { doc: { id: name, name: '', embedModel: 'none' }, kb: { chunks, bm25, vectors: null } } };
  for (const model of [...new Set(configs.map((c) => c.model).filter(Boolean))]) {
    log(`${name}: embedding ${chunks.length} documents with ${model}`);
    const { dim, data: f32 } = await provider.embed(model, chunks.map((c) => E.chunk.embeddingText('', c)));
    const { q, scales } = E.quant.quantize(f32, dim);
    sets[model] = { doc: { id: name, name: '', embedModel: model }, kb: { chunks, bm25, vectors: { q, scales, dim, count: chunks.length, model } } };
    const prefix = E.workers.embedModelInfo(model).queryPrefix || '';
    await provider.embed(model, qids.map((id) => prefix + queries[id]));
  }

  const results = {};
  for (const c of configs) {
    const set = sets[c.model || 'none'];
    const opts = (k) => ({ mode: c.mode, k, fetchK: c.fetchK ?? defaults.fetchK, lambda: defaults.mmrLambda, useRerank: !!c.rerank, neighbors: false });
    const t1 = performance.now();
    const per = await mapLimit(qids, c.rerank ? 2 : 4, async (qid) => {
      const rel = qrels[qid];
      const r = await E.retrieve.retrieve([set], queries[qid], opts(10));
      const ranked = [...new Set(r.sources.filter((s) => !s.neighbor).map((s) => corpus[s.idx].id))];
      const row = { ndcg10: ndcg(ranked, rel, 10), mrr10: mrr(ranked, rel, 10), r10: recall(ranked, rel, 10) };
      if (c.r100) {
        const r2 = await E.retrieve.retrieve([set], queries[qid], opts(100));
        row.r100 = recall([...new Set(r2.sources.map((s) => corpus[s.idx].id))], rel, 100);
      }
      return row;
    });
    const col = (k) => per.map((p) => p[k]);
    results[c.id] = {
      label: c.label,
      ndcg10: mean(col('ndcg10')),
      mrr10: mean(col('mrr10')),
      r10: mean(col('r10')),
      r100: c.r100 ? mean(col('r100')) : null,
      msPerQuery: (performance.now() - t1) / qids.length / (c.r100 ? 2 : 1),
      per: { ndcg10: col('ndcg10').map((x) => +x.toFixed(4)), mrr10: col('mrr10').map((x) => +x.toFixed(4)) },
    };
    log(`${name}/${split} ${c.id}: nDCG@10 ${results[c.id].ndcg10.toFixed(4)}  R@10 ${results[c.id].r10.toFixed(4)}${c.r100 ? `  R@100 ${results[c.id].r100.toFixed(4)}` : ''}  MRR@10 ${results[c.id].mrr10.toFixed(4)}`);
  }
  return { name, split, docs: corpus.length, queries: qids.length, qids, bm25BuildMs: bm25Ms, configs: results };
}
