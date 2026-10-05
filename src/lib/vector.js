import { topK } from './topk.js';
import { dotQ, dotQQ } from './quant.js';

// Dense retrieval over an int8-quantised index ({ q, scales, dim, count }),
// equivalent to the notebook's ChromaDB cosine search, plus MMR and RRF fusion.

export function searchVectors(index, query, k = 10) {
  const { q, scales, dim, count } = index;
  return topK(count, k, (r) => dotQ(q, scales, dim, r, query));
}

/** Maximal Marginal Relevance (LangChain semantics: lambda 1 = pure relevance). */
export function mmr(index, candidates, k, lambda = 0.5) {
  const { q, scales, dim } = index;
  const chosen = [];
  const pool = [...candidates];
  while (chosen.length < k && pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((c, pi) => {
      let red = 0;
      for (const s of chosen) red = Math.max(red, dotQQ(q, scales, dim, c.idx, s.idx));
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

/** Reciprocal Rank Fusion. Items are matched by `key` (default: idx). */
export function rrf(lists, k = 60, key = (x) => x.idx) {
  const fused = new Map();
  lists.forEach((list, li) =>
    list.forEach((item, rank) => {
      const id = key(item);
      const e = fused.get(id) || { ...item, score: 0, parts: {}, ranks: {} };
      e.score += 1 / (k + rank + 1);
      e.parts[li] = item.score;
      e.ranks[li] = rank + 1;
      fused.set(id, e);
    })
  );
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
