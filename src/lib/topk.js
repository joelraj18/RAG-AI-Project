// Bounded min-heap top-k: O(n log k) instead of sorting all n scores on every query.

export function topK(n, k, scoreAt) {
  const cap = Math.min(k, n);
  if (cap <= 0) return [];
  const idx = new Int32Array(cap);
  const val = new Float64Array(cap);
  let size = 0;
  const swap = (a, b) => {
    const ti = idx[a];
    idx[a] = idx[b];
    idx[b] = ti;
    const tv = val[a];
    val[a] = val[b];
    val[b] = tv;
  };
  for (let i = 0; i < n; i++) {
    const v = scoreAt(i);
    if (v == null || Number.isNaN(v)) continue;
    if (size < cap) {
      idx[size] = i;
      val[size] = v;
      let c = size++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (val[p] <= val[c]) break;
        swap(p, c);
        c = p;
      }
    } else if (v > val[0]) {
      idx[0] = i;
      val[0] = v;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let m = p;
        if (l < size && val[l] < val[m]) m = l;
        if (r < size && val[r] < val[m]) m = r;
        if (m === p) break;
        swap(p, m);
        p = m;
      }
    }
  }
  const out = [];
  for (let i = 0; i < size; i++) out.push({ idx: idx[i], score: val[i] });
  return out.sort((a, b) => b.score - a.score);
}
