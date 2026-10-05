import { searchBM25, globalStats } from './bm25.js';
import { searchVectors, rrf } from './vector.js';
import { dequantizeRow, cosine } from './quant.js';
import { embedQuery, rerank } from './workers.js';
import { vectorsReady } from './kb.js';
import { estimateTokens } from './text.js';

// Retrieval over one or many documents.
//  semantic – cosine similarity on embeddings (the notebook's Chroma "similarity")
//  mmr      – Maximal Marginal Relevance (notebook config C4)
//  bm25     – keyword search (instant, before embeddings exist)
//  hybrid   – BM25 + semantic fused with Reciprocal Rank Fusion (default)
// Optional stages: cross-encoder rerank of the top candidates, neighbour expansion.
// Documents whose embeddings are not ready fall back to BM25 transparently.

const keyOf = (docId, idx) => `${docId}:${idx}`;

export async function retrieve(sets, query, opts = {}) {
  const { mode = 'hybrid', k = 4, fetchK = 20, lambda = 0.5, useRerank = false, neighbors = false, contextBudget = 1800, semanticQuery } = opts;
  const t = { queryEmbed: 0, search: 0, rerank: 0, expand: 0 };
  const pool = Math.max(fetchK, k * 4);

  // 1. query embeddings, one per embedding model in use
  const sem = mode !== 'bm25' ? sets.filter((s) => vectorsReady(s.doc, s.kb)) : [];
  const qvec = new Map();
  const t0 = performance.now();
  for (const m of new Set(sem.map((s) => s.doc.embedModel))) qvec.set(m, await embedQuery(m, semanticQuery || query));
  t.queryEmbed = performance.now() - t0;

  // 2. candidate lists
  const t1 = performance.now();
  const meta = (s, h) => ({ key: keyOf(s.doc.id, h.idx), docId: s.doc.id, docName: s.doc.name, idx: h.idx, score: h.score });
  const semList = sem
    .flatMap((s) => searchVectors(s.kb.vectors, qvec.get(s.doc.embedModel), pool).map((h) => meta(s, h)))
    .sort((a, b) => b.score - a.score)
    .slice(0, pool);
  // corpus-wide IDF makes BM25 scores comparable across documents, so they merge by score
  const global = sets.length > 1 ? globalStats(sets.map((s) => s.kb.bm25), query) : null;
  const bm25PerDoc = sets.map((s) => searchBM25(s.kb.bm25, query, pool, global).map((h) => meta(s, h)));
  const bm25List = bm25PerDoc.flat().sort((a, b) => b.score - a.score).slice(0, pool);
  const raw = { cosine: new Map(semList.map((x) => [x.key, x.score])), bm25: new Map(bm25PerDoc.flat().map((x) => [x.key, x.score])) };
  const scoresOf = (x, extra = {}) => ({ cosine: raw.cosine.get(x.key), bm25: raw.bm25.get(x.key), ...extra });
  const semDocs = new Set(sem.map((s) => s.doc.id));
  const bm25Only = sets.length > sem.length; // some documents have no vectors yet

  let effective = mode;
  let fused;
  if (!sem.length) {
    effective = 'bm25';
    fused = bm25List.map((x) => ({ ...x, scores: scoresOf(x) }));
  } else if (mode === 'semantic' || mode === 'mmr') {
    let list = semList;
    if (bm25Only) {
      list = rrf([semList, bm25List.filter((b) => !semDocs.has(b.docId))], 60, (x) => x.key);
      effective = `${mode} + bm25`;
    }
    if (mode === 'mmr') {
      const bySet = new Map(sets.map((s) => [s.doc.id, s]));
      const rows = new Map();
      const vec = (c) => {
        if (!rows.has(c.key)) {
          const v = bySet.get(c.docId).kb.vectors;
          rows.set(c.key, semDocs.has(c.docId) ? dequantizeRow(v.q, v.scales, v.dim, c.idx) : null);
        }
        return rows.get(c.key);
      };
      list = mmrGeneric(list.slice(0, fetchK), k * 2, lambda, (a, b) => {
        const va = vec(a);
        const vb = vec(b);
        return va && vb && va.length === vb.length ? cosine(va, vb) : 0;
      });
    }
    fused = list.map((x) => ({ ...x, scores: scoresOf(x) }));
  } else {
    fused = rrf([semList, bm25List], 60, (x) => x.key).map((x) => ({ ...x, scores: scoresOf(x, { rrf: x.score }) }));
    if (bm25Only) effective = 'hybrid (partial)';
  }
  t.search = performance.now() - t1;

  const textOf = (c) => sets.find((s) => s.doc.id === c.docId).kb.chunks[c.idx];
  // 3. optional cross-encoder rerank of the top candidates
  let ranked = fused.slice(0, Math.max(k, useRerank ? fetchK : k));
  let rerankError = null;
  if (useRerank && ranked.length > 1) {
    const t2 = performance.now();
    try {
      const scores = await rerank(query, ranked.map((c) => textOf(c).text));
      ranked = ranked.map((c, i) => ({ ...c, scores: { ...c.scores, rerank: scores[i] } })).sort((a, b) => b.scores.rerank - a.scores.rerank);
    } catch (e) {
      rerankError = String(e.message || e);
    }
    t.rerank = performance.now() - t2;
  }
  const top = ranked.slice(0, k);

  // 4. optional neighbour expansion: add the adjacent chunk(s) of the same section within budget
  const t3 = performance.now();
  const chosen = top.map((c, i) => ({ ...c, rank: i + 1 }));
  if (neighbors) {
    let used = chosen.reduce((s, c) => s + textOf(c).tokens, 0);
    const have = new Set(chosen.map((c) => c.key));
    for (const c of [...chosen]) {
      const set = sets.find((s) => s.doc.id === c.docId);
      const base = set.kb.chunks[c.idx];
      for (const j of [c.idx + 1, c.idx - 1]) {
        const n = set.kb.chunks[j];
        const key = keyOf(c.docId, j);
        if (!n || have.has(key) || n.section !== base.section || Math.abs(n.page - base.page) > 1) continue;
        if (used + n.tokens > contextBudget) continue;
        used += n.tokens;
        have.add(key);
        chosen.push({ key, docId: c.docId, docName: c.docName, idx: j, neighbor: true, neighborOf: c.rank, scores: {} });
      }
    }
  }
  t.expand = performance.now() - t3;

  const sources = chosen.map((c) => {
    const ch = textOf(c);
    return { ...c, id: ch.id, page: ch.page, section: ch.section, text: ch.text, tokens: ch.tokens };
  });
  const slim = (l) => l.slice(0, 10).map((x) => ({ key: x.key, docName: x.docName, page: textOf(x).page, score: x.score }));
  return {
    sources,
    effectiveMode: effective,
    requestedMode: mode,
    timings: t,
    rerankError,
    trace: {
      semantic: slim(semList),
      bm25: slim(bm25List),
      fused: slim(fused),
      reranked: useRerank ? ranked.slice(0, 10).map((x) => ({ key: x.key, docName: x.docName, page: textOf(x).page, score: x.scores.rerank })) : null,
    },
  };
}

function mmrGeneric(candidates, k, lambda, sim) {
  const chosen = [];
  const pool = [...candidates];
  while (chosen.length < k && pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((c, pi) => {
      let red = 0;
      for (const s of chosen) red = Math.max(red, sim(c, s));
      const v = lambda * c.score - (1 - lambda) * red;
      if (v > bestScore) {
        bestScore = v;
        best = pi;
      }
    });
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

/** Context label used in the prompt and expected in citations: "[Doc name p. 12]". */
export const sourceLabel = (s) => `${s.docName} p. ${s.page}`;

export function formatContext(sources) {
  const order = [...sources].sort((a, b) => (a.neighbor ? a.neighborOf : a.rank) - (b.neighbor ? b.neighborOf : b.rank) || a.idx - b.idx);
  return order.map((s) => `[${sourceLabel(s)}]${s.section ? ` (section: ${s.section})` : ''}\n${s.text}`).join('\n\n');
}

export const contextTokens = (sources) => sources.reduce((s, c) => s + (c.tokens || estimateTokens(c.text || '')), 0);

