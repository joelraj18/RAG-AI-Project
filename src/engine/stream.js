// Per-numeric-column value accumulator for files too large to keep every value.
//
// Three stages, each exact for as long as it can be:
//  1. distinct — a table of distinct values with per-group counts (ratings, sizes, flags…);
//  2. dense    — whole-number columns whose values span ≤ DENSE_SPAN integers (prices, ages,
//                counts, years…) get one counter per integer, so their quantiles stay exact
//                at any row count; group quantiles move to ±0.5% sketches;
//  3. sketch   — everything else: a ±0.1% log-bucket quantile sketch.

import { GROUP_WIDTH, MIN_ABS, bucketKey, createSketch, sketchAddValue, sketchMerge, storeAdd } from './sketch';
import { createDistinctTable, distinctIndex } from './tables';

/**
 * @param groupSlots number of tracked categorical columns (0 disables group tracking)
 * @param maxGroups  categories tracked per categorical column
 */
export const DENSE_SPAN = 1 << 18; // 262,144 consecutive integers (2 MB of counters)

export function createNumStream(groupSlots, maxGroups, distinctCap) {
    const width = groupSlots * maxGroups;
    return {
        groupSlots,
        maxGroups,
        width,
        distinct: createDistinctTable(distinctCap, width),
        dense: null, // { offset, counts: Float64Array }
        sketch: null,
        groups: null, // sketch per (slot * maxGroups + code), created lazily
    };
}

const isDenseCandidate = (v) => v % 1 === 0 && Math.abs(v) < 2 ** 52;

/** Makes room for integer v in the dense counters; false if the span would exceed DENSE_SPAN. */
function denseFit(d, v) {
    if (d.counts.length === 0) {
        // Empty store (e.g. a merge target): centre the first window on this value.
        d.offset = v - 512;
        d.counts = new Float64Array(1024);
        return true;
    }
    const end = d.offset + d.counts.length;
    if (v >= d.offset && v < end) return true;
    const lo = Math.min(d.offset, v);
    const hi = Math.max(end - 1, v);
    const span = hi - lo + 1;
    if (span > DENSE_SPAN) return false;
    const size = Math.min(DENSE_SPAN, Math.max(span, d.counts.length * 2));
    const offset = v < d.offset ? Math.max(hi - size + 1, lo - (size - span)) : lo;
    const next = new Float64Array(size);
    next.set(d.counts, d.offset - offset);
    d.counts = next;
    d.offset = offset;
    return true;
}

function denseToSketch(ns) {
    const d = ns.dense;
    ns.sketch = createSketch(1);
    for (let i = 0; i < d.counts.length; i++) if (d.counts[i] !== 0) sketchAddValue(ns.sketch, d.offset + i, d.counts[i]);
    ns.dense = null;
}

function groupSketch(ns, i) {
    return ns.groups[i] || (ns.groups[i] = createSketch(GROUP_WIDTH));
}

/** Leaves distinct mode: dense counters when every value so far is a whole number in range, else a sketch. */
function toSketch(ns) {
    const t = ns.distinct;
    let lo = Infinity;
    let hi = -Infinity;
    let integers = true;
    for (let e = 0; e < t.size; e++) {
        const v = t.values[e];
        if (!isDenseCandidate(v)) integers = false;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    if (t.size === 0) {
        ns.dense = { offset: 0, counts: new Float64Array(0) };
    } else if (integers && hi - lo + 1 <= DENSE_SPAN) {
        const size = Math.min(DENSE_SPAN, Math.max(1024, (hi - lo + 1) * 2));
        ns.dense = { offset: Math.max(lo - Math.floor((size - (hi - lo + 1)) / 2), hi - size + 1), counts: new Float64Array(size) };
        for (let e = 0; e < t.size; e++) ns.dense.counts[t.values[e] - ns.dense.offset] += t.counts[e];
    } else {
        ns.sketch = createSketch(1);
        for (let e = 0; e < t.size; e++) sketchAddValue(ns.sketch, t.values[e], t.counts[e]);
    }
    if (ns.width) ns.groups = new Array(ns.width).fill(null);
    for (let e = 0; e < t.size; e++) {
        if (t.groups) {
            for (let i = 0; i < ns.width; i++) {
                const c = t.groups[e * ns.width + i];
                if (c !== 0) sketchAddValue(groupSketch(ns, i), t.values[e], c);
            }
        }
    }
    ns.distinct = null;
}

/** Adds one observation; `codes[slot]` is its category code per tracked column, or -1. */
export function numStreamAdd(ns, v, codes) {
    const t = ns.distinct;
    if (t !== null) {
        const e = distinctIndex(t, v);
        if (e >= 0) {
            t.counts[e]++;
            if (t.groups !== null) {
                const base = e * ns.width;
                for (let s = 0; s < ns.groupSlots; s++) {
                    const code = codes[s];
                    if (code >= 0) t.groups[base + s * ns.maxGroups + code]++;
                }
            }
            return;
        }
        toSketch(ns);
    }

    // Dense integer counters stay exact; a fraction or an out-of-range value ends dense mode.
    let counted = false;
    const d = ns.dense;
    if (d !== null) {
        if (isDenseCandidate(v) && denseFit(d, v)) {
            d.counts[v - d.offset]++;
            counted = true;
        } else {
            denseToSketch(ns);
        }
    }

    // Sketch mode: compute the bucket once and reuse it for the column and its groups.
    let key = 0;
    let sign = 0;
    if (v > MIN_ABS) {
        key = bucketKey(v);
        sign = 1;
        if (!counted) storeAdd(ns.sketch.pos, key, 1);
    } else if (v < -MIN_ABS) {
        key = bucketKey(-v);
        sign = -1;
        if (!counted) storeAdd(ns.sketch.neg, key, 1);
    } else if (!counted) {
        ns.sketch.zero++;
    }
    if (ns.groups !== null) {
        const groupKey = Math.floor(key / GROUP_WIDTH);
        for (let s = 0; s < ns.groupSlots; s++) {
            const code = codes[s];
            if (code < 0) continue;
            const sk = groupSketch(ns, s * ns.maxGroups + code);
            if (sign > 0) storeAdd(sk.pos, groupKey, 1);
            else if (sign < 0) storeAdd(sk.neg, groupKey, 1);
            else sk.zero++;
        }
    }
}

/** Adds `count` copies of v whose per-group counts are in `g` (already in this stream's layout). */
export function numStreamAddWeighted(ns, v, count, g) {
    const t = ns.distinct;
    if (t !== null) {
        const e = distinctIndex(t, v);
        if (e >= 0) {
            t.counts[e] += count;
            if (t.groups && g) for (let i = 0; i < ns.width; i++) t.groups[e * ns.width + i] += g[i];
            return;
        }
        toSketch(ns);
    }
    if (ns.dense !== null) {
        if (isDenseCandidate(v) && denseFit(ns.dense, v)) ns.dense.counts[v - ns.dense.offset] += count;
        else {
            denseToSketch(ns);
            sketchAddValue(ns.sketch, v, count);
        }
    } else {
        sketchAddValue(ns.sketch, v, count);
    }
    if (ns.groups && g) for (let i = 0; i < ns.width; i++) if (g[i] !== 0) sketchAddValue(groupSketch(ns, i), v, g[i]);
}

/** Merges another stream's dense integer counters (its groups are merged separately). */
export function numStreamMergeDense(ns, other, remap) {
    if (ns.distinct !== null) toSketch(ns);
    const { offset, counts } = other.dense;
    for (let i = 0; i < counts.length; i++) {
        if (counts[i] === 0) continue;
        const v = offset + i;
        if (ns.dense !== null && denseFit(ns.dense, v)) ns.dense.counts[v - ns.dense.offset] += counts[i];
        else {
            if (ns.dense !== null) denseToSketch(ns);
            sketchAddValue(ns.sketch, v, counts[i]);
        }
    }
    mergeGroupSketches(ns, other, remap);
}

function mergeGroupSketches(ns, other, remap) {
    if (!ns.groups || !other.groups) return;
    other.groups.forEach((sk, i) => {
        const target = sk ? remap(i) : -1;
        if (target >= 0) sketchMerge(groupSketch(ns, target), sk);
    });
}

/** Merges another sketch-mode stream whose group indexes are remapped via `remap(i) → i' | -1`. */
export function numStreamMergeSketch(ns, other, remap) {
    if (ns.distinct !== null) toSketch(ns);
    if (ns.dense !== null) denseToSketch(ns);
    sketchMerge(ns.sketch, other.sketch);
    mergeGroupSketches(ns, other, remap);
}

/** Exact (value, count) pairs from dense counters, or null when not in dense mode. */
export function numStreamDense(ns) {
    const d = ns.dense;
    if (d === null) return null;
    const values = [];
    const counts = [];
    for (let i = 0; i < d.counts.length; i++) {
        if (d.counts[i] !== 0) {
            values.push(d.offset + i);
            counts.push(d.counts[i]);
        }
    }
    return { values: Float64Array.from(values), counts: Float64Array.from(counts) };
}

/** Distinct values (ascending) with counts and group counts, or null in sketch mode. */
export function numStreamDistinct(ns) {
    const t = ns.distinct;
    if (t === null) return null;
    const order = Array.from({ length: t.size }, (_, i) => i).sort((a, b) => t.values[a] - t.values[b]);
    const values = new Float64Array(t.size);
    const counts = new Float64Array(t.size);
    const g = t.groups ? new Float64Array(t.size * ns.width) : null;
    order.forEach((e, i) => {
        values[i] = t.values[e];
        counts[i] = t.counts[e];
        if (g) g.set(t.groups.subarray(e * ns.width, (e + 1) * ns.width), i * ns.width);
    });
    return { values, counts, g, width: ns.width };
}
