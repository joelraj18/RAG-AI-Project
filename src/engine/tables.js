// Allocation-free open-addressing hash tables for the scan hot path. They replace Map, which is
// slow for the keys we have (52-bit hashes and floating-point values are boxed heap numbers).

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Mixes a double's bit pattern into a 32-bit hash. */
function hashDouble(v) {
    f64[0] = v === 0 ? 0 : v; // fold -0 into 0
    let h = Math.imul(u32[0] ^ Math.imul(u32[1], 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    return Math.imul(h, 0xc2b2ae35) ^ (h >>> 16);
}

/* ---------- Distinct numeric values (with optional per-group counts) ---------- */

export function createDistinctTable(capacity, width) {
    let tableSize = 16;
    while (tableSize < capacity * 2) tableSize <<= 1;
    return {
        size: 0,
        capacity,
        width,
        mask: tableSize - 1,
        slots: new Int32Array(tableSize).fill(-1),
        values: new Float64Array(capacity),
        counts: new Float64Array(capacity),
        groups: width ? new Float64Array(capacity * width) : null,
    };
}

/** Entry index for v, inserting it if there is room; -1 when the table is full. */
export function distinctIndex(t, v) {
    if (v === 0) v = 0; // -0 and 0 are the same value
    let i = hashDouble(v) & t.mask;
    for (;;) {
        const e = t.slots[i];
        if (e === -1) {
            if (t.size === t.capacity) return -1;
            const index = t.size++;
            t.slots[i] = index;
            t.values[index] = v;
            return index;
        }
        if (t.values[e] === v) return e;
        i = (i + 1) & t.mask;
    }
}

/* ---------- Categories keyed by a pair of 32-bit hashes ---------- */

export function createCategoryTable(minCapacity = 64) {
    // Capacity must be a power of two: probing uses `hash & mask`.
    let initial = 64;
    while (initial < minCapacity) initial <<= 1;
    return {
        size: 0,
        mask: initial * 2 - 1,
        slots: new Int32Array(initial * 2).fill(-1),
        h1: new Uint32Array(initial),
        h2: new Uint32Array(initial),
        counts: new Float64Array(initial),
        codes: new Int16Array(initial).fill(-1),
        names: [],
    };
}

function rehash(t, capacity) {
    const old = t;
    const next = createCategoryTable(capacity);
    for (let e = 0; e < old.size; e++) {
        let i = old.h1[e] & next.mask;
        while (next.slots[i] !== -1) i = (i + 1) & next.mask;
        next.slots[i] = e;
    }
    next.h1.set(old.h1.subarray(0, old.size));
    next.h2.set(old.h2.subarray(0, old.size));
    next.counts.set(old.counts.subarray(0, old.size));
    next.codes.set(old.codes.subarray(0, old.size));
    next.names = old.names;
    next.size = old.size;
    return next;
}

/**
 * Entry index for the hash pair, or -1 if absent. When absent and `insert` is true the caller
 * must follow up with `categoryInsert` (so the name is only decoded for new categories).
 */
export function categoryFind(t, h1, h2) {
    let i = h1 & t.mask;
    for (;;) {
        const e = t.slots[i];
        if (e === -1) return -1;
        if (t.h1[e] === h1 && t.h2[e] === h2) return e;
        i = (i + 1) & t.mask;
    }
}

/** Inserts a new category and returns [table, index] (the table may have grown). */
export function categoryInsert(t, h1, h2, name) {
    if (t.size * 2 >= t.h1.length) t = rehash(t, t.h1.length * 2);
    const index = t.size++;
    let i = h1 & t.mask;
    while (t.slots[i] !== -1) i = (i + 1) & t.mask;
    t.slots[i] = index;
    t.h1[index] = h1;
    t.h2[index] = h2;
    t.counts[index] = 0;
    t.codes[index] = -1;
    t.names.push(name);
    return [t, index];
}

/** Keeps the `keep` most frequent categories; returns the new table and the count dropped. */
export function categoryPrune(t, keep) {
    const order = Array.from({ length: t.size }, (_, i) => i).sort((a, b) => t.counts[b] - t.counts[a]);
    let dropped = 0;
    let next = createCategoryTable(Math.max(64, keep));
    order.forEach((e, rank) => {
        if (rank >= keep) {
            dropped += t.counts[e];
            return;
        }
        let index;
        [next, index] = categoryInsert(next, t.h1[e], t.h2[e], t.names[e]);
        next.counts[index] = t.counts[e];
        next.codes[index] = t.codes[e];
    });
    return [next, dropped];
}

export function categoryEntries(t) {
    return t.names.slice(0, t.size).map((name, i) => ({ name, count: t.counts[i], code: t.codes[i] }));
}
