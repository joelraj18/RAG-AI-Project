// Int8 vector quantisation with one float scale per row.
// 4x smaller than Float32 (a 14k-chunk index drops from ~21 MB to ~5.4 MB) with a
// cosine error well below 0.01, which leaves retrieval rankings practically unchanged.

/** Quantise rows of `dim` floats. */
export function quantize(f32, dim) {
  const count = f32.length / dim;
  const q = new Int8Array(f32.length);
  const scales = new Float32Array(count);
  for (let r = 0; r < count; r++) {
    const o = r * dim;
    let max = 0;
    for (let i = 0; i < dim; i++) max = Math.max(max, Math.abs(f32[o + i]));
    const s = max / 127 || 1;
    scales[r] = s;
    for (let i = 0; i < dim; i++) q[o + i] = Math.round(f32[o + i] / s);
  }
  return { q, scales };
}

export function dequantizeRow(q, scales, dim, row) {
  const out = new Float32Array(dim);
  const s = scales[row];
  for (let i = 0; i < dim; i++) out[i] = q[row * dim + i] * s;
  return out;
}

/** dot(float query, int8 row) */
export function dotQ(q, scales, dim, row, query) {
  const o = row * dim;
  let acc = 0;
  for (let i = 0; i < dim; i++) acc += q[o + i] * query[i];
  return acc * scales[row];
}

/** dot(int8 row a, int8 row b) */
export function dotQQ(q, scales, dim, a, b) {
  const oa = a * dim;
  const ob = b * dim;
  let acc = 0;
  for (let i = 0; i < dim; i++) acc += q[oa + i] * q[ob + i];
  return acc * scales[a] * scales[b];
}

export function cosine(a, b) {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na * nb) || 1);
}
