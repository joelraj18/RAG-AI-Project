import { tokenize } from './text.js';

// Okapi BM25 lexical index. Builds in a second or two for a 4,000-page manual, so
// the manual is searchable immediately while semantic embeddings build in the background.

export function buildBM25(chunks, { k1 = 1.2, b = 0.75 } = {}) {
  const df = new Map();
  const docs = new Array(chunks.length);
  let totalLen = 0;
  chunks.forEach((c, i) => {
    const toks = tokenize(c.text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs[i] = { tf, len: toks.length };
    totalLen += toks.length;
  });
  const N = chunks.length;
  const avgdl = N ? totalLen / N : 0;
  // inverted index: term -> [[docIdx, tf], ...]
  const postings = new Map();
  docs.forEach((d, i) => {
    for (const [t, f] of d.tf) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push([i, f]);
    }
  });
  const lens = Float32Array.from(docs, (d) => d.len);
  return { N, avgdl, k1, b, df, postings, lens };
}

export function searchBM25(index, query, k = 10) {
  const { N, avgdl, k1, b, df, postings, lens } = index;
  const scores = new Map();
  for (const t of new Set(tokenize(query))) {
    const plist = postings.get(t);
    if (!plist) continue;
    const n = df.get(t);
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    for (const [i, f] of plist) {
      const s = idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lens[i]) / avgdl)));
      scores.set(i, (scores.get(i) || 0) + s);
    }
  }
  return [...scores]
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, k)
    .map(([idx, score]) => ({ idx, score }));
}
