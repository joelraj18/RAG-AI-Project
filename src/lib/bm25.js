import { tokenize } from './text.js';

// Okapi BM25 lexical index with compact typed-array postings (structured-clone friendly,
// so it is built inside the ingest worker and transferred to the UI thread cheaply).

export function buildBM25(chunks, { k1 = 1.2, b = 0.75, prefix = (c) => c.section } = {}) {
  const termIds = new Map();
  const docs = [];
  const lens = new Float32Array(chunks.length);
  let total = 0;
  chunks.forEach((c, i) => {
    // section titles are indexed too, so "treatment of X" matches chunks under heading "X"
    const toks = tokenize(`${prefix(c) || ''} ${c.text}`);
    const tf = new Map();
    for (const t of toks) {
      let id = termIds.get(t);
      if (id === undefined) termIds.set(t, (id = termIds.size));
      tf.set(id, (tf.get(id) || 0) + 1);
    }
    docs.push(tf);
    lens[i] = toks.length;
    total += toks.length;
  });
  const T = termIds.size;
  const df = new Int32Array(T);
  for (const tf of docs) for (const id of tf.keys()) df[id]++;
  const pDocs = Array.from({ length: T }, (_, id) => new Int32Array(df[id]));
  const pTf = Array.from({ length: T }, (_, id) => new Uint16Array(df[id]));
  const fill = new Int32Array(T);
  docs.forEach((tf, i) => {
    for (const [id, f] of tf) {
      pDocs[id][fill[id]] = i;
      pTf[id][fill[id]++] = Math.min(f, 65535);
    }
  });
  return { N: chunks.length, avgdl: chunks.length ? total / chunks.length : 0, k1, b, termIds, df, pDocs, pTf, lens };
}

/** Corpus-wide document frequencies, so scores of several per-document indexes are comparable. */
export function globalStats(indexes, query) {
  const N = indexes.reduce((s, x) => s + x.N, 0);
  const df = new Map();
  for (const t of new Set(tokenize(query))) {
    let n = 0;
    for (const x of indexes) {
      const id = x.termIds.get(t);
      if (id !== undefined) n += x.df[id];
    }
    df.set(t, n);
  }
  return { N, df };
}

export function searchBM25(index, query, k = 10, global = null) {
  const { N, avgdl, k1, b, termIds, df, pDocs, pTf, lens } = index;
  const scores = new Map();
  for (const t of new Set(tokenize(query))) {
    const id = termIds.get(t);
    if (id === undefined) continue;
    const n = global ? global.df.get(t) : df[id];
    const total = global ? global.N : N;
    const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
    const ds = pDocs[id];
    const fs = pTf[id];
    for (let j = 0; j < ds.length; j++) {
      const i = ds[j];
      const f = fs[j];
      scores.set(i, (scores.get(i) || 0) + idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lens[i]) / avgdl))));
    }
  }
  return [...scores]
    .sort((x, y) => y[1] - x[1])
    .slice(0, k)
    .map(([idx, score]) => ({ idx, score }));
}

export function bm25Bytes(index) {
  let bytes = index.lens.byteLength + index.df.byteLength;
  for (let i = 0; i < index.pDocs.length; i++) bytes += index.pDocs[i].byteLength + index.pTf[i].byteLength;
  return bytes + index.termIds.size * 16;
}
