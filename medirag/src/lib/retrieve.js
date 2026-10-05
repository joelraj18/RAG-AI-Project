import { searchBM25 } from './bm25.js';
import { searchVectors, mmr, rrf } from './vector.js';
import { embedQuery } from './workers.js';

// Retrieval strategies:
//  semantic  – cosine similarity on embeddings (the notebook's Chroma "similarity")
//  mmr       – Maximal Marginal Relevance on embeddings (notebook config C4)
//  bm25      – keyword search (works instantly, before embeddings finish)
//  hybrid    – BM25 + semantic fused with Reciprocal Rank Fusion (recommended)
// If embeddings are not ready yet, semantic/mmr/hybrid transparently fall back to BM25.

export async function retrieve(kb, manual, query, { mode = 'hybrid', k = 3, fetchK = 20, lambda = 0.5 } = {}) {
  const t = { embedMs: 0, searchMs: 0 };
  const vectorsReady = kb.vectors && kb.vectors.count >= kb.chunks.length * 0.999;
  let effective = mode;
  if (mode !== 'bm25' && !vectorsReady) effective = 'bm25';

  let qv = null;
  if (effective !== 'bm25') {
    const t0 = performance.now();
    qv = await embedQuery(manual.embedModel, query);
    t.embedMs = performance.now() - t0;
  }
  const t1 = performance.now();
  let hits;
  const { dim, data } = kb.vectors || {};
  if (effective === 'bm25') {
    hits = searchBM25(kb.bm25, query, k).map((h) => ({ ...h, bm25: h.score }));
  } else if (effective === 'semantic') {
    hits = searchVectors(data, dim, qv, k, kb.chunks.length).map((h) => ({ ...h, cosine: h.score }));
  } else if (effective === 'mmr') {
    const cands = searchVectors(data, dim, qv, fetchK, kb.chunks.length);
    hits = mmr(data, dim, qv, cands, k, lambda).map((h) => ({ ...h, cosine: h.score }));
  } else {
    const sem = searchVectors(data, dim, qv, Math.max(fetchK, k * 4), kb.chunks.length);
    const lex = searchBM25(kb.bm25, query, Math.max(fetchK, k * 4));
    hits = rrf([sem, lex])
      .slice(0, k)
      .map((h) => ({ idx: h.idx, score: h.parts[0] ?? h.score, rrf: h.score, cosine: h.parts[0], bm25: h.parts[1] }));
  }
  t.searchMs = performance.now() - t1;
  const sources = hits.map((h, rank) => ({ ...kb.chunks[h.idx], ...h, rank: rank + 1 }));
  return { sources, effectiveMode: effective, requestedMode: mode, timings: t };
}

export function formatContext(sources) {
  return sources.map((s) => `[PDF p. ${s.page}]\n${s.text}`).join('\n\n');
}
