// Streams one byte range of a CSV file and accumulates every statistic in a single pass.
// Runs inside a Web Worker (one per CPU core) or, as a fallback, on the main thread.

import { createRowBuffers, fieldText, hashBytes, isBlankRow, isNAToken, parseDay, parseNumber, tokenize } from './csv';
import { readSlice } from './io';
import { createHll, hllAdd } from './sketch';
import { createNumStream, numStreamAdd, numStreamDistinct } from './stream';
import { categoryEntries, categoryFind, categoryInsert, categoryPrune, createCategoryTable } from './tables';

export const CHUNK_BYTES = 4 << 20;
const MAX_TIMELINE_DAYS = 200_000;
const INVALID_EXAMPLES = 5;
const FREEZE_AFTER_PRUNES = 3;

function createState(plan, rangeIndex) {
    const nNum = plan.numeric.length;
    const nCat = plan.categorical.length;
    const nDate = plan.dates.length;
    const nSlots = plan.groupCats.length;
    const nGN = plan.groupNums.length;
    const nC = plan.corrCols.length;
    const nPairs = (nC * (nC - 1)) / 2;
    const nTN = plan.timelineNums.length;
    const groupCells = nSlots * plan.maxGroups * nGN;

    const groupSlotOfCat = new Int16Array(nCat).fill(-1);
    plan.groupCats.forEach((c, slot) => (groupSlotOfCat[c] = slot));
    const groupNumIndex = new Int16Array(nNum).fill(-1);
    plan.groupNums.forEach((j, k) => (groupNumIndex[j] = k));

    return {
        rangeIndex,
        exact: plan.exact,
        buf: null,
        limit: Infinity,
        stopped: false,
        rows: 0,
        malformed: 0,
        groupSlotOfCat,
        groupNumIndex,

        // Numeric columns: shifted power sums give exact mean / variance / skew / kurtosis.
        num: {
            count: new Float64Array(nNum),
            missing: new Float64Array(nNum),
            invalid: new Float64Array(nNum),
            s1: new Float64Array(nNum),
            s2: new Float64Array(nNum),
            s3: new Float64Array(nNum),
            s4: new Float64Array(nNum),
            min: new Float64Array(nNum).fill(Infinity),
            max: new Float64Array(nNum).fill(-Infinity),
            nonInteger: new Uint8Array(nNum),
            invalidExamples: Array.from({ length: nNum }, () => []),
        },
        vals: new Float64Array(nNum),

        // Exact mode keeps every value (row-aligned, NaN = missing) plus each row's group codes.
        capacity: 0,
        buffers: plan.exact ? Array.from({ length: nNum }, () => new Float64Array(0)) : null,
        codes: plan.exact ? Array.from({ length: nSlots }, () => new Uint8Array(0)) : null,
        streams: plan.exact ? null : createStreams(plan),

        cat: {
            tables: Array.from({ length: nCat }, () => createCategoryTable()),
            missing: new Float64Array(nCat),
            hll: Array.from({ length: nCat }, createHll),
            pruned: new Uint8Array(nCat), // number of times the table was cut back (0 = counts exact)
            dropped: new Float64Array(nCat),
        },
        hash: new Uint32Array(2),

        groups: {
            active: new Uint8Array(nSlots).fill(1),
            next: new Int16Array(nSlots),
            names: Array.from({ length: nSlots }, () => []),
            n: new Float64Array(groupCells),
            s1: new Float64Array(groupCells),
            s2: new Float64Array(groupCells),
            min: new Float64Array(groupCells).fill(Infinity),
            max: new Float64Array(groupCells).fill(-Infinity),
        },
        rowCodes: new Int16Array(nSlots).fill(-1),

        // Pearson correlation from shifted cross-products: complete rows take a fast path.
        corr: {
            x: new Float64Array(nC),
            completeN: 0,
            cs1: new Float64Array(nC),
            cs2: new Float64Array(nC),
            csxy: new Float64Array(nPairs),
            pn: new Float64Array(nPairs),
            psx: new Float64Array(nPairs),
            psy: new Float64Array(nPairs),
            psxx: new Float64Array(nPairs),
            psyy: new Float64Array(nPairs),
            psxy: new Float64Array(nPairs),
        },

        dates: {
            count: new Float64Array(nDate),
            missing: new Float64Array(nDate),
            invalid: new Float64Array(nDate),
            min: new Float64Array(nDate).fill(Infinity),
            max: new Float64Array(nDate).fill(-Infinity),
            timelines: plan.timelineDates.map(() => ({
                slotOf: new Map(),
                days: new Float64Array(256),
                counts: new Float64Array(256),
                sums: new Float64Array(256 * nTN),
                ns: new Float64Array(256 * nTN),
                size: 0,
                overflow: false,
            })),
        },

        reservoir: [],
        nextPick: 0,
        weight: 0,
        preview: rangeIndex === 0 ? [] : null,
    };
}

function createStreams(plan) {
    const slots = plan.groupCats.length;
    return plan.numeric.map((_, j) =>
        createNumStream(plan.groupNums.includes(j) ? slots : 0, plan.maxGroups, plan.distinctCap),
    );
}

/** Exact mode ran out of budget: replay the buffered rows into streaming accumulators. */
function switchToStreaming(st, plan) {
    st.streams = createStreams(plan);
    const codes = new Int16Array(plan.groupCats.length);
    for (let r = 0; r < st.rows - 1; r++) {
        for (let s = 0; s < codes.length; s++) codes[s] = st.codes[s][r] === 255 ? -1 : st.codes[s][r];
        for (let j = 0; j < st.buffers.length; j++) {
            const v = st.buffers[j][r];
            if (!Number.isNaN(v)) numStreamAdd(st.streams[j], v, codes);
        }
    }
    st.exact = false;
    st.buffers = null;
    st.codes = null;
}

function growBuffers(st, needed) {
    const capacity = Math.max(1024, st.capacity * 2, needed);
    st.buffers = st.buffers.map((b) => {
        const next = new Float64Array(capacity);
        next.set(b);
        return next;
    });
    st.codes = st.codes.map((b) => {
        const next = new Uint8Array(capacity);
        next.set(b);
        return next;
    });
    st.capacity = capacity;
}

function pruneCategories(st, c, cap) {
    const [table, dropped] = categoryPrune(st.cat.tables[c], Math.floor(cap / 2));
    st.cat.tables[c] = table;
    st.cat.dropped[c] += dropped;
    if (st.cat.pruned[c] < 255) st.cat.pruned[c]++;
}

function growTimeline(tl, nTN) {
    const size = tl.days.length * 2;
    const grow = (arr, len) => {
        const next = new Float64Array(len);
        next.set(arr);
        return next;
    };
    tl.days = grow(tl.days, size);
    tl.counts = grow(tl.counts, size);
    tl.sums = grow(tl.sums, size * nTN);
    tl.ns = grow(tl.ns, size * nTN);
}

/* ---------- Per-row work ----------
 * Split into small functions on purpose: V8 declines to optimise very large functions, and one
 * monolithic row handler ran ~15× slower in Chrome than these focused, individually optimised steps.
 */

function createContext(plan) {
    const timelineOf = new Int16Array(plan.dates.length).fill(-1);
    plan.timelineDates.forEach((d, t) => (timelineOf[d] = t));
    return {
        ncols: plan.columns.length,
        numeric: Int32Array.from(plan.numeric),
        categorical: Int32Array.from(plan.categorical),
        dates: Int32Array.from(plan.dates),
        shifts: plan.shifts,
        corrCols: Int32Array.from(plan.corrCols),
        groupNums: Int32Array.from(plan.groupNums),
        timelineNums: Int32Array.from(plan.timelineNums),
        timelineOf,
        maxGroups: plan.maxGroups,
        categoryCap: plan.categoryCap,
        bufferCap: plan.bufferCap,
        reservoirSize: plan.reservoirSize,
        previewRows: plan.previewRows,
    };
}

function decodeRow(buf, rb, n, ncols) {
    const row = new Array(ncols);
    for (let k = 0; k < ncols; k++) row[k] = k < n ? fieldText(buf, rb, k) : '';
    return row;
}

/** Categorical columns: counts, distinct estimate, and this row's group codes. */
function scanCategorical(st, cx, buf, rb, n) {
    const { cat, groups, rowCodes, hash } = st;
    const starts = rb.starts;
    const ends = rb.ends;
    const cols = cx.categorical;
    for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        const slot = st.groupSlotOfCat[c];
        let code = -1;
        const s = col < n ? starts[col] : 0;
        const e = col < n ? ends[col] : 0;
        if (col >= n || isNAToken(buf, s, e)) {
            cat.missing[c]++;
        } else {
            hashBytes(buf, s, e, hash);
            const h1 = hash[0];
            const h2 = hash[1];
            let table = cat.tables[c];
            let ent = categoryFind(table, h1, h2);
            if (ent < 0 && cat.pruned[c] >= FREEZE_AFTER_PRUNES) {
                // An ID-like column (millions of distinct values): stop tracking new names so the
                // table stops churning; its distinct count still comes from HyperLogLog.
                cat.dropped[c]++;
                hllAdd(cat.hll[c], h1, h2);
                if (slot >= 0) rowCodes[slot] = -1;
                continue;
            }
            if (ent < 0) {
                const name = fieldText(buf, rb, col);
                [table, ent] = categoryInsert(table, h1, h2, name);
                cat.tables[c] = table;
                if (slot >= 0 && groups.active[slot]) {
                    if (groups.next[slot] < cx.maxGroups) {
                        table.codes[ent] = groups.next[slot]++;
                        groups.names[slot].push(name);
                    } else {
                        groups.active[slot] = 0; // too many categories to compare
                    }
                }
            }
            table.counts[ent]++;
            hllAdd(cat.hll[c], h1, h2);
            code = table.codes[ent];
            if (table.size > cx.categoryCap) pruneCategories(st, c, cx.categoryCap);
        }
        if (slot >= 0) rowCodes[slot] = groups.active[slot] ? code : -1;
    }
}

function noteInvalid(num, j, buf, rb, col) {
    num.invalid[j]++;
    const examples = num.invalidExamples[j];
    if (examples.length < INVALID_EXAMPLES) {
        const text = fieldText(buf, rb, col);
        if (!examples.includes(text)) examples.push(text);
    }
}

/** Numeric columns: parse into `vals` and accumulate moments and extremes. */
function scanNumeric(st, cx, buf, rb, n) {
    const { num, vals } = st;
    const starts = rb.starts;
    const ends = rb.ends;
    const cols = cx.numeric;
    const shifts = cx.shifts;
    for (let j = 0; j < cols.length; j++) {
        const col = cols[j];
        let v = NaN;
        if (col < n && starts[col] !== ends[col]) {
            v = parseNumber(buf, starts[col], ends[col]);
            if (Number.isNaN(v)) {
                if (isNAToken(buf, starts[col], ends[col])) num.missing[j]++;
                else noteInvalid(num, j, buf, rb, col);
            }
        } else {
            num.missing[j]++;
        }
        vals[j] = v;
        if (!Number.isNaN(v)) {
            num.count[j]++;
            const d = v - shifts[j];
            const d2 = d * d;
            num.s1[j] += d;
            num.s2[j] += d2;
            num.s3[j] += d2 * d;
            num.s4[j] += d2 * d2;
            if (v < num.min[j]) num.min[j] = v;
            if (v > num.max[j]) num.max[j] = v;
            if (num.nonInteger[j] === 0 && v % 1 !== 0) num.nonInteger[j] = 1;
        }
    }
}

/** Value distributions: keep everything (exact mode) or stream into distinct tables / sketches. */
function storeValues(st, plan, row) {
    const { vals, rowCodes } = st;
    if (st.exact && row >= plan.bufferCap) switchToStreaming(st, plan);
    if (st.exact) {
        if (row >= st.capacity) growBuffers(st, row + 1);
        const buffers = st.buffers;
        for (let j = 0; j < vals.length; j++) buffers[j][row] = vals[j];
        const codes = st.codes;
        for (let s = 0; s < codes.length; s++) codes[s][row] = rowCodes[s] < 0 ? 255 : rowCodes[s];
        return;
    }
    const streams = st.streams;
    for (let j = 0; j < vals.length; j++) {
        const v = vals[j];
        if (!Number.isNaN(v)) numStreamAdd(streams[j], v, rowCodes);
    }
}

/** Group sums for bivariate means. */
function scanGroups(st, cx) {
    const { groups, rowCodes, vals } = st;
    const groupNums = cx.groupNums;
    const nGN = groupNums.length;
    for (let s = 0; s < rowCodes.length; s++) {
        const code = rowCodes[s];
        if (code < 0) continue;
        const base = (s * cx.maxGroups + code) * nGN;
        for (let k = 0; k < nGN; k++) {
            const j = groupNums[k];
            const v = vals[j];
            if (Number.isNaN(v)) continue;
            const idx = base + k;
            const d = v - cx.shifts[j];
            groups.n[idx]++;
            groups.s1[idx] += d;
            groups.s2[idx] += d * d;
            if (v < groups.min[idx]) groups.min[idx] = v;
            if (v > groups.max[idx]) groups.max[idx] = v;
        }
    }
}

/** Correlation cross-products; rows with every value present take the fast path. */
function scanCorrelation(st, cx) {
    const { corr, vals } = st;
    const cols = cx.corrCols;
    const nC = cols.length;
    const x = corr.x;
    let complete = true;
    for (let a = 0; a < nC; a++) {
        const j = cols[a];
        x[a] = vals[j] - cx.shifts[j];
        if (Number.isNaN(x[a])) complete = false;
    }
    let p = 0;
    if (complete) {
        corr.completeN++;
        const { cs1, cs2, csxy } = corr;
        for (let a = 0; a < nC; a++) {
            const xa = x[a];
            cs1[a] += xa;
            cs2[a] += xa * xa;
            for (let b = a + 1; b < nC; b++) csxy[p++] += xa * x[b];
        }
        return;
    }
    for (let a = 0; a < nC; a++) {
        const xa = x[a];
        if (Number.isNaN(xa)) {
            p += nC - a - 1;
            continue;
        }
        for (let b = a + 1; b < nC; b++, p++) {
            const xb = x[b];
            if (Number.isNaN(xb)) continue;
            corr.pn[p]++;
            corr.psx[p] += xa;
            corr.psy[p] += xb;
            corr.psxx[p] += xa * xa;
            corr.psyy[p] += xb * xb;
            corr.psxy[p] += xa * xb;
        }
    }
}

/** Dates: range plus a per-day timeline. */
function scanDates(st, cx, buf, rb, n) {
    const { dates, vals } = st;
    const cols = cx.dates;
    const nums = cx.timelineNums;
    const nTN = nums.length;
    for (let d = 0; d < cols.length; d++) {
        const col = cols[d];
        const s = col < n ? rb.starts[col] : 0;
        const e = col < n ? rb.ends[col] : 0;
        if (col >= n || isNAToken(buf, s, e)) {
            dates.missing[d]++;
            continue;
        }
        const day = parseDay(buf, s, e);
        if (Number.isNaN(day)) {
            dates.invalid[d]++;
            continue;
        }
        dates.count[d]++;
        if (day < dates.min[d]) dates.min[d] = day;
        if (day > dates.max[d]) dates.max[d] = day;
        const t = cx.timelineOf[d];
        if (t < 0) continue;
        const tl = dates.timelines[t];
        let slot = tl.slotOf.get(day);
        if (slot === undefined) {
            if (tl.size >= MAX_TIMELINE_DAYS) {
                tl.overflow = true;
                continue;
            }
            if (tl.size === tl.days.length) growTimeline(tl, nTN);
            slot = tl.size++;
            tl.slotOf.set(day, slot);
            tl.days[slot] = day;
        }
        tl.counts[slot]++;
        const base = slot * nTN;
        for (let k = 0; k < nTN; k++) {
            const v = vals[nums[k]];
            if (!Number.isNaN(v)) {
                tl.sums[base + k] += v;
                tl.ns[base + k]++;
            }
        }
    }
}

/** Uniform random sample of rows (reservoir sampling, Algorithm L: no random draw per row). */
function sampleRow(st, cx, buf, rb, n, seen) {
    const size = cx.reservoirSize;
    if (seen <= size) {
        st.reservoir.push(decodeRow(buf, rb, n, cx.ncols));
        if (seen === size) {
            st.weight = Math.exp(Math.log(Math.random()) / size);
            st.nextPick = seen + Math.floor(Math.log(Math.random()) / Math.log(1 - st.weight)) + 1;
        }
    } else if (seen === st.nextPick) {
        st.reservoir[Math.floor(Math.random() * size)] = decodeRow(buf, rb, n, cx.ncols);
        st.weight *= Math.exp(Math.log(Math.random()) / size);
        st.nextPick += Math.floor(Math.log(Math.random()) / Math.log(1 - st.weight)) + 1;
    }
}

function makeRowHandler(st, plan, rb) {
    const cx = createContext(plan);
    const hasCat = cx.categorical.length > 0;
    const hasGroups = plan.groupCats.length > 0 && cx.groupNums.length > 0;
    const hasCorr = cx.corrCols.length > 1;
    const hasDates = cx.dates.length > 0;

    return (n, rowStart) => {
        if (rowStart >= st.limit) {
            st.stopped = true;
            return false;
        }
        if (isBlankRow(n, rb)) return true;
        const buf = st.buf;
        const row = st.rows++;
        if (n !== cx.ncols) st.malformed++;
        if (st.preview !== null && st.preview.length < cx.previewRows) st.preview.push(decodeRow(buf, rb, n, cx.ncols));
        if (hasCat) scanCategorical(st, cx, buf, rb, n);
        scanNumeric(st, cx, buf, rb, n);
        storeValues(st, plan, row);
        if (hasGroups) scanGroups(st, cx);
        if (hasCorr) scanCorrelation(st, cx);
        if (hasDates) scanDates(st, cx, buf, rb, n);
        sampleRow(st, cx, buf, rb, n, row + 1);
        return true;
    };
}

/**
 * Scans the rows whose first byte lies in [range.start, range.end).
 * @param onProgress ({ bytesDone, rows }) after every chunk
 * @param isCancelled () => boolean, polled between chunks
 */
export async function scanRange(file, range, plan, onProgress, isCancelled) {
    const st = createState(plan, range.index);
    const rb = createRowBuffers(Math.max(64, plan.columns.length + 4));
    const onRow = makeRowHandler(st, plan, rb);

    // Every range but the first starts mid-line: skip ahead to the first row that starts inside it.
    let skipPartial = range.start > plan.dataStart;
    let readPos = skipPartial ? range.start - 1 : range.start;
    let carry = null;

    for (;;) {
        const readEnd = Math.min(file.size, readPos + CHUNK_BYTES);
        const chunk = new Uint8Array(await readSlice(file, readPos, readEnd));
        let buf = chunk;
        if (carry && carry.length) {
            buf = new Uint8Array(carry.length + chunk.length);
            buf.set(carry);
            buf.set(chunk, carry.length);
        }
        const bufStart = readPos - (carry ? carry.length : 0);
        readPos = readEnd;
        const isFinal = readEnd >= file.size;

        let from = 0;
        if (skipPartial) {
            while (from < buf.length && buf[from] !== 10) from++;
            if (from === buf.length) {
                carry = null;
                if (isFinal || bufStart + from >= range.end) break;
                continue;
            }
            from++;
            skipPartial = false;
        }

        st.buf = buf;
        st.limit = range.end - bufStart;
        const consumed = tokenize(buf, from, buf.length, plan.delimiter, isFinal, rb, onRow);
        st.buf = null;

        onProgress?.({ bytesDone: Math.min(readEnd, range.end) - range.start, rows: st.rows });
        if (st.stopped || isFinal) break;
        if (isCancelled?.()) throw new Error('cancelled');
        carry = buf.subarray(consumed);
    }
    return finishState(st, plan, range);
}

/** Converts the scan state into a compact, transferable partial result. */
function finishState(st, plan, range) {
    const rows = st.rows;
    const trim = (arr) => (arr ? arr.slice(0, rows) : null);
    const streams = st.streams
        ? st.streams.map((ns) => numStreamDistinct(ns) || (ns.dense ? { dense: ns.dense, groups: ns.groups } : { sketch: ns.sketch, groups: ns.groups }))
        : null;

    return {
        index: range.index,
        rows,
        malformed: st.malformed,
        exact: st.exact,
        num: st.num,
        buffers: st.exact ? st.buffers.map(trim) : null,
        codes: st.exact ? st.codes.map(trim) : null,
        streams,
        cat: {
            entries: st.cat.tables.map(categoryEntries),
            missing: st.cat.missing,
            hll: st.cat.hll,
            pruned: st.cat.pruned,
            dropped: st.cat.dropped,
        },
        groups: st.groups,
        corr: { ...st.corr, x: undefined },
        dates: {
            ...st.dates,
            timelines: st.dates.timelines.map((tl) => ({
                size: tl.size,
                overflow: tl.overflow,
                days: tl.days.slice(0, tl.size),
                counts: tl.counts.slice(0, tl.size),
                sums: tl.sums.slice(0, tl.size * plan.timelineNums.length),
                ns: tl.ns.slice(0, tl.size * plan.timelineNums.length),
            })),
        },
        reservoir: st.reservoir,
        preview: st.preview,
    };
}

/** ArrayBuffers in a partial that can be transferred (not copied) between threads. */
export function transferables(partial) {
    const out = new Set();
    const visit = (v) => {
        if (!v || typeof v !== 'object') return;
        if (ArrayBuffer.isView(v)) {
            out.add(v.buffer);
            return;
        }
        if (Array.isArray(v)) v.forEach(visit);
        else if (!(v instanceof Map)) Object.values(v).forEach(visit);
    };
    visit(partial);
    return [...out];
}
