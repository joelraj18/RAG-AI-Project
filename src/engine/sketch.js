// Mergeable, constant-memory summaries used when a column has too many values to keep in memory.
// All structures are plain objects (structured-clone friendly) operated on by functions.

/* ---------- Log-bucketed quantile sketch (DDSketch-style) ----------
 * A value v > 0 falls in bucket ceil(log_γ v); every value in a bucket is within ±ALPHA of the
 * bucket's representative, so any quantile is accurate to ±ALPHA relative error.
 */

export const ALPHA = 0.001;
const GAMMA = (1 + ALPHA) / (1 - ALPHA);
export const INV_LOG_GAMMA = 1 / Math.log(GAMMA);
export const MIN_ABS = 1e-12; // |v| below this counts as zero

/** Group sketches merge 5 fine buckets into one (±0.5%) to keep thousands of them cheap. */
export const GROUP_WIDTH = 5;

export const bucketKey = (absValue) => Math.ceil(Math.log(absValue) * INV_LOG_GAMMA);

export const createStore = (width = 1) => ({ width, offset: 0, counts: null });

export function storeAdd(store, key, count) {
    let counts = store.counts;
    if (counts === null) {
        store.counts = counts = new Float64Array(128);
        store.offset = key - 64;
    }
    let pos = key - store.offset;
    if (pos < 0 || pos >= counts.length) {
        const lo = Math.min(key, store.offset);
        const hi = Math.max(key, store.offset + counts.length - 1);
        const span = hi - lo + 1;
        const size = Math.max(counts.length * 2, span + 128);
        const offset = lo - Math.floor((size - span) / 2);
        const next = new Float64Array(size);
        next.set(counts, store.offset - offset);
        store.counts = counts = next;
        store.offset = offset;
        pos = key - offset;
    }
    counts[pos] += count;
}

export function storeMerge(into, from) {
    if (!from.counts) return;
    const { counts, offset } = from;
    for (let i = 0; i < counts.length; i++) if (counts[i] !== 0) storeAdd(into, offset + i, counts[i]);
}

/** Representative value of a bucket: minimises the worst relative error within it. */
function representative(key, width) {
    const lower = GAMMA ** (key * width - 1);
    const upper = GAMMA ** (key * width + width - 1);
    return (2 * lower * upper) / (lower + upper);
}

export const createSketch = (width = 1) => ({ pos: createStore(width), neg: createStore(width), zero: 0 });

export function sketchAddValue(sketch, v, count = 1) {
    if (v > MIN_ABS) storeAdd(sketch.pos, Math.floor(bucketKey(v) / sketch.pos.width), count);
    else if (v < -MIN_ABS) storeAdd(sketch.neg, Math.floor(bucketKey(-v) / sketch.neg.width), count);
    else sketch.zero += count;
}

export function sketchMerge(into, from) {
    storeMerge(into.pos, from.pos);
    storeMerge(into.neg, from.neg);
    into.zero += from.zero;
}

/** Sorted (value, count) pairs approximating the sketch's contents. */
export function sketchBuckets(sketch) {
    const values = [];
    const counts = [];
    const { neg, pos } = sketch;
    if (neg.counts) {
        for (let i = neg.counts.length - 1; i >= 0; i--) {
            if (neg.counts[i] !== 0) {
                values.push(-representative(neg.offset + i, neg.width));
                counts.push(neg.counts[i]);
            }
        }
    }
    if (sketch.zero) {
        values.push(0);
        counts.push(sketch.zero);
    }
    if (pos.counts) {
        for (let i = 0; i < pos.counts.length; i++) {
            if (pos.counts[i] !== 0) {
                values.push(representative(pos.offset + i, pos.width));
                counts.push(pos.counts[i]);
            }
        }
    }
    return { values: Float64Array.from(values), counts: Float64Array.from(counts) };
}

/* ---------- Distribution: one query API over exact values or sketch buckets ---------- */

/**
 * @param values ascending values (all observations, or distinct values / bucket representatives)
 * @param counts multiplicities aligned with `values`, or null when each value occurs once
 * @param exact  whether the values are the true data (vs. sketch representatives)
 */
export function createDistribution(values, counts, exact, min, max) {
    const n = values.length;
    let cumulative = null;
    let total = n;
    if (counts) {
        cumulative = new Float64Array(n);
        let acc = 0;
        for (let i = 0; i < n; i++) {
            acc += counts[i];
            cumulative[i] = acc;
        }
        total = acc;
    }
    return { values, counts, cumulative, total, exact, min, max };
}

/** Index of the first value >= x (or > x when `strict` is false … i.e. upper bound). */
function bound(values, x, upper) {
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (upper ? values[mid] <= x : values[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Number of observations strictly below x. */
export function countBelow(dist, x) {
    if (x <= dist.min) return 0;
    if (x > dist.max) return dist.total;
    const i = bound(dist.values, x, false);
    return dist.cumulative ? (i === 0 ? 0 : dist.cumulative[i - 1]) : i;
}

/** Number of observations less than or equal to x. */
export function countAtOrBelow(dist, x) {
    if (x < dist.min) return 0;
    if (x >= dist.max) return dist.total;
    const i = bound(dist.values, x, true);
    return dist.cumulative ? (i === 0 ? 0 : dist.cumulative[i - 1]) : i;
}

/** The k-th smallest observation (0-based). Extremes are always the exact min and max. */
export function valueAtRank(dist, k) {
    if (k <= 0) return dist.min;
    if (k >= dist.total - 1) return dist.max;
    if (!dist.cumulative) return dist.values[k];
    let lo = 0;
    let hi = dist.values.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (dist.cumulative[mid] > k) hi = mid;
        else lo = mid + 1;
    }
    return Math.min(dist.max, Math.max(dist.min, dist.values[lo]));
}

/** Quantile with linear interpolation between order statistics (pandas' default). */
export function quantile(dist, q) {
    if (dist.total === 0) return NaN;
    const pos = (dist.total - 1) * q;
    const lo = Math.floor(pos);
    const frac = pos - lo;
    const a = valueAtRank(dist, lo);
    return frac === 0 ? a : a + frac * (valueAtRank(dist, lo + 1) - a);
}

/* ---------- HyperLogLog distinct-count estimate (~0.8% standard error) ---------- */

const HLL_P = 14;
const HLL_M = 1 << HLL_P;

export const createHll = () => new Uint8Array(HLL_M);

export function hllAdd(registers, h1, h2) {
    const idx = h1 >>> (32 - HLL_P);
    const rank = h2 === 0 ? 33 : Math.clz32(h2) + 1;
    if (rank > registers[idx]) registers[idx] = rank;
}

export function hllMerge(into, from) {
    for (let i = 0; i < HLL_M; i++) if (from[i] > into[i]) into[i] = from[i];
}

export function hllEstimate(registers) {
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < HLL_M; i++) {
        sum += 2 ** -registers[i];
        if (registers[i] === 0) zeros++;
    }
    const alpha = 0.7213 / (1 + 1.079 / HLL_M);
    const raw = (alpha * HLL_M * HLL_M) / sum;
    if (raw <= 2.5 * HLL_M && zeros > 0) return Math.round(HLL_M * Math.log(HLL_M / zeros));
    return Math.round(raw);
}

/* ---------- Selection ---------- */

/** Rearranges a[lo..hi] so a[k] holds the k-th smallest value (Floyd–Rivest style quickselect). */
export function select(a, k, lo = 0, hi = a.length - 1) {
    while (hi > lo) {
        const pivot = a[k];
        let i = lo;
        let j = hi;
        while (i <= j) {
            while (a[i] < pivot) i++;
            while (a[j] > pivot) j--;
            if (i <= j) {
                const t = a[i];
                a[i] = a[j];
                a[j] = t;
                i++;
                j--;
            }
        }
        if (k <= j) hi = j;
        else if (k >= i) lo = i;
        else return a[k];
    }
    return a[k];
}
