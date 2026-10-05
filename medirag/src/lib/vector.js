// Dense-vector search over a flat Float32Array (row-major, L2-normalised rows),
// equivalent to the notebook's ChromaDB cosine collection, plus MMR re-ranking.

export function dot(a, aOff, b, bOff, dim) {
  let s = 0;
  for (let i = 0; i < dim; i++) s += a[aOff + i] * b[bOff + i];
  return s;
}

export function searchVectors(matrix, dim, queryVec, k = 10, count = matrix.length / dim) {
  const scores = new Float32Array(count);
  for (let r = 0; r < count; r++) scores[r] = dot(matrix, r * dim, queryVec, 0, dim);
  const idx = Array.from({ length: count }, (_, i) => i);
  // partial selection is fine: sort is fast enough for ~15k rows
  idx.sort((x, y) => scores[y] - scores[x]);
  return idx.slice(0, k).map((i) => ({ idx: i, score: scores[i] }));
}

/** Maximal Marginal Relevance (same semantics as LangChain: lambda_mult=1 -> pure relevance). */
export function mmr(matrix, dim, queryVec, candidates, k, lambda = 0.5) {
  const chosen = [];
  const pool = [...candidates];
  while (chosen.length < k && pool.length) {
    let best = -1;
    let bestScore = -Infinity;
    pool.forEach((c, pi) => {
      const rel = c.score;
      let red = 0;
      for (const s of chosen) red = Math.max(red, dot(matrix, c.idx * dim, matrix, s.idx * dim, dim));
      const v = lambda * rel - (1 - lambda) * red;
      if (v > bestScore) {
        bestScore = v;
        best = pi;
      }
    });
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

/** Reciprocal Rank Fusion of several ranked lists. */
export function rrf(lists, k = 60) {
  const fused = new Map();
  lists.forEach((list, li) =>
    list.forEach((item, rank) => {
      const e = fused.get(item.idx) || { idx: item.idx, score: 0, parts: {} };
      e.score += 1 / (k + rank + 1);
      e.parts[li] = item.score;
      fused.set(item.idx, e);
    })
  );
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
