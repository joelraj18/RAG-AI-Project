// Combines per-worker partial results into one, as if a single scan had read the whole file.

import { hllMerge } from './sketch';
import { createNumStream, numStreamAdd, numStreamAddWeighted, numStreamMergeDense, numStreamMergeSketch } from './stream';

export function mergePartials(input, plan) {
    const partials = [...input].sort((a, b) => a.index - b.index);
    const { maxGroups } = plan;
    const nNum = plan.numeric.length;
    const nSlots = plan.groupCats.length;
    const nGN = plan.groupNums.length;
    const rows = partials.reduce((a, p) => a + p.rows, 0);

    /* ---- Group codes: each worker numbered categories in the order it met them. ---- */
    const groupNames = [];
    const groupActive = new Uint8Array(nSlots);
    const remap = partials.map(() => []);
    for (let s = 0; s < nSlots; s++) {
        const names = [];
        let active = partials.every((p) => p.groups.active[s]);
        partials.forEach((p, pi) => {
            remap[pi][s] = p.groups.names[s].map((name) => {
                let code = names.indexOf(name);
                if (code < 0) {
                    code = names.length;
                    names.push(name);
                }
                return code;
            });
        });
        if (names.length > maxGroups) active = false;
        groupNames.push(names);
        groupActive[s] = active ? 1 : 0;
    }
    const globalCode = (pi, s, local) => (groupActive[s] && local >= 0 ? remap[pi][s][local] : -1);

    /* ---- Numeric moments ---- */
    const num = {
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
    };
    for (const p of partials) {
        for (let j = 0; j < nNum; j++) {
            for (const key of ['count', 'missing', 'invalid', 's1', 's2', 's3', 's4']) num[key][j] += p.num[key][j];
            num.min[j] = Math.min(num.min[j], p.num.min[j]);
            num.max[j] = Math.max(num.max[j], p.num.max[j]);
            num.nonInteger[j] |= p.num.nonInteger[j];
            for (const ex of p.num.invalidExamples[j]) {
                if (num.invalidExamples[j].length < 5 && !num.invalidExamples[j].includes(ex)) num.invalidExamples[j].push(ex);
            }
        }
    }

    /* ---- Value distributions ---- */
    const exact = partials.every((p) => p.exact);
    let buffers = null;
    let codes = null;
    let streams = null;
    if (exact) {
        buffers = Array.from({ length: nNum }, () => new Float64Array(rows));
        codes = Array.from({ length: nSlots }, () => new Uint8Array(rows).fill(255));
        let offset = 0;
        partials.forEach((p, pi) => {
            for (let j = 0; j < nNum; j++) buffers[j].set(p.buffers[j], offset);
            for (let s = 0; s < nSlots; s++) {
                const src = p.codes[s];
                const dst = codes[s];
                for (let r = 0; r < p.rows; r++) {
                    const c = src[r];
                    if (c !== 255) {
                        const g = globalCode(pi, s, c);
                        if (g >= 0) dst[offset + r] = g;
                    }
                }
            }
            offset += p.rows;
        });
    } else {
        streams = plan.numeric.map((_, j) => createNumStream(plan.groupNums.includes(j) ? nSlots : 0, maxGroups, plan.distinctCap));
        const rowCodes = new Int16Array(nSlots);
        partials.forEach((p, pi) => {
            const remapIndex = (i) => {
                const s = Math.floor(i / maxGroups);
                const g = globalCode(pi, s, i % maxGroups);
                return g < 0 ? -1 : s * maxGroups + g;
            };
            if (p.exact) {
                for (let r = 0; r < p.rows; r++) {
                    for (let s = 0; s < nSlots; s++) rowCodes[s] = p.codes[s][r] === 255 ? -1 : globalCode(pi, s, p.codes[s][r]);
                    for (let j = 0; j < nNum; j++) {
                        const v = p.buffers[j][r];
                        if (!Number.isNaN(v)) numStreamAdd(streams[j], v, rowCodes);
                    }
                }
                return;
            }
            p.streams.forEach((src, j) => {
                if (src.dense) {
                    numStreamMergeDense(streams[j], src, remapIndex);
                    return;
                }
                if (!src.values) {
                    numStreamMergeSketch(streams[j], src, remapIndex);
                    return;
                }
                const width = src.width;
                const g = width ? new Float64Array(width) : null;
                for (let i = 0; i < src.values.length; i++) {
                    if (g) {
                        g.fill(0);
                        for (let w = 0; w < width; w++) {
                            const count = src.g[i * width + w];
                            if (count === 0) continue;
                            const target = remapIndex(w);
                            if (target >= 0) g[target] += count;
                        }
                    }
                    numStreamAddWeighted(streams[j], src.values[i], src.counts[i], g);
                }
            });
        });
    }

    /* ---- Group sums ---- */
    const cells = nSlots * maxGroups * nGN;
    const groups = {
        active: groupActive,
        names: groupNames,
        n: new Float64Array(cells),
        s1: new Float64Array(cells),
        s2: new Float64Array(cells),
        min: new Float64Array(cells).fill(Infinity),
        max: new Float64Array(cells).fill(-Infinity),
    };
    partials.forEach((p, pi) => {
        for (let s = 0; s < nSlots; s++) {
            if (!groupActive[s]) continue;
            p.groups.names[s].forEach((_, local) => {
                const g = globalCode(pi, s, local);
                for (let k = 0; k < nGN; k++) {
                    const from = (s * maxGroups + local) * nGN + k;
                    const to = (s * maxGroups + g) * nGN + k;
                    groups.n[to] += p.groups.n[from];
                    groups.s1[to] += p.groups.s1[from];
                    groups.s2[to] += p.groups.s2[from];
                    groups.min[to] = Math.min(groups.min[to], p.groups.min[from]);
                    groups.max[to] = Math.max(groups.max[to], p.groups.max[from]);
                }
            });
        }
    });

    /* ---- Categorical counts ---- */
    const cat = plan.categorical.map((_, c) => {
        const counts = new Map();
        let missing = 0;
        let pruned = false;
        let dropped = 0;
        let hll = null;
        for (const p of partials) {
            for (const ent of p.cat.entries[c]) counts.set(ent.name, (counts.get(ent.name) || 0) + ent.count);
            missing += p.cat.missing[c];
            pruned = pruned || !!p.cat.pruned[c];
            dropped += p.cat.dropped[c];
            if (hll) hllMerge(hll, p.cat.hll[c]);
            else hll = Uint8Array.from(p.cat.hll[c]);
        }
        return { counts, missing, pruned, dropped, hll };
    });

    /* ---- Correlation sums ---- */
    const corr = {};
    for (const key of ['completeN', 'cs1', 'cs2', 'csxy', 'pn', 'psx', 'psy', 'psxx', 'psyy', 'psxy']) {
        const first = partials[0].corr[key];
        if (typeof first === 'number') corr[key] = partials.reduce((a, p) => a + p.corr[key], 0);
        else {
            corr[key] = new Float64Array(first.length);
            for (const p of partials) for (let i = 0; i < first.length; i++) corr[key][i] += p.corr[key][i];
        }
    }

    /* ---- Dates ---- */
    const nTN = plan.timelineNums.length;
    const dates = {
        count: sumArrays(partials.map((p) => p.dates.count)),
        missing: sumArrays(partials.map((p) => p.dates.missing)),
        invalid: sumArrays(partials.map((p) => p.dates.invalid)),
        min: partials.reduce((acc, p) => acc.map((v, i) => Math.min(v, p.dates.min[i])), [...partials[0].dates.min]),
        max: partials.reduce((acc, p) => acc.map((v, i) => Math.max(v, p.dates.max[i])), [...partials[0].dates.max]),
        timelines: plan.timelineDates.map((_, t) => {
            const byDay = new Map();
            let overflow = false;
            for (const p of partials) {
                const tl = p.dates.timelines[t];
                overflow = overflow || tl.overflow;
                for (let i = 0; i < tl.size; i++) {
                    let slot = byDay.get(tl.days[i]);
                    if (!slot) {
                        slot = { count: 0, sums: new Float64Array(nTN), ns: new Float64Array(nTN) };
                        byDay.set(tl.days[i], slot);
                    }
                    slot.count += tl.counts[i];
                    for (let k = 0; k < nTN; k++) {
                        slot.sums[k] += tl.sums[i * nTN + k];
                        slot.ns[k] += tl.ns[i * nTN + k];
                    }
                }
            }
            return { byDay, overflow };
        }),
    };

    return {
        rows,
        malformed: partials.reduce((a, p) => a + p.malformed, 0),
        exact,
        num,
        buffers,
        codes,
        streams,
        groups,
        cat,
        corr,
        dates,
        reservoir: mergeReservoirs(partials, plan.reservoirSize),
        preview: partials[0].preview || [],
    };
}

function sumArrays(arrays) {
    const out = new Float64Array(arrays[0].length);
    for (const a of arrays) for (let i = 0; i < a.length; i++) out[i] += a[i];
    return out;
}

/**
 * Merges uniform samples drawn from disjoint parts of the file into one uniform sample of the
 * whole: each pick comes from a part with probability proportional to its remaining rows.
 */
function mergeReservoirs(partials, size) {
    const pools = partials.map((p) => ({ remaining: p.rows, items: shuffle([...p.reservoir]) }));
    let total = pools.reduce((a, p) => a + p.remaining, 0);
    const out = [];
    while (out.length < size && total > 0) {
        let r = Math.random() * total;
        let pool = pools[0];
        for (const p of pools) {
            if (r < p.remaining) {
                pool = p;
                break;
            }
            r -= p.remaining;
        }
        if (!pool.items.length) {
            total -= pool.remaining;
            pool.remaining = 0;
            continue;
        }
        out.push(pool.items.pop());
        pool.remaining--;
        total--;
    }
    return out;
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}
