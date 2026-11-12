// Retrieval and summary metrics, plus a paired bootstrap for before/after confidence intervals.

export const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** nDCG@k with linear gains (trec_eval / BEIR convention). `rel` maps id -> grade. */
export function ndcg(ranked, rel, k = 10) {
  let dcg = 0;
  ranked.slice(0, k).forEach((d, i) => {
    const g = rel[d] || 0;
    if (g > 0) dcg += g / Math.log2(i + 2);
  });
  const ideal = Object.values(rel)
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
  return ideal ? dcg / ideal : 0;
}

export function mrr(ranked, rel, k = 10) {
  const i = ranked.slice(0, k).findIndex((d) => (rel[d] || 0) > 0);
  return i < 0 ? 0 : 1 / (i + 1);
}

export function recall(ranked, rel, k) {
  const relevant = Object.keys(rel).filter((d) => rel[d] > 0);
  if (!relevant.length) return 0;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((d) => top.has(d)).length / relevant.length;
}

export function quantiles(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, mean: mean(v), median: q(0.5), p90: q(0.9), min: v[0], max: v[v.length - 1] };
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)), ((s ^= s >>> 16) >>> 0) / 4294967296);
}

/**
 * Paired bootstrap of mean(after) - mean(before) over the same items.
 * Returns { delta, lo, hi } (95% interval).
 */
export function pairedBootstrap(before, after, iters = 2000, seed = 7) {
  const n = Math.min(before.length, after.length);
  const d = Array.from({ length: n }, (_, i) => (after[i] ?? 0) - (before[i] ?? 0));
  const delta = d.reduce((a, b) => a + b, 0) / (n || 1);
  const r = rng(seed);
  const means = new Float64Array(iters);
  for (let it = 0; it < iters; it++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += d[Math.floor(r() * n)];
    means[it] = s / (n || 1);
  }
  means.sort();
  return { delta, lo: means[Math.floor(0.025 * iters)], hi: means[Math.floor(0.975 * iters)] };
}

/** Normalise answer text for containment checks (SQuAD-style). */
export const normText = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
