// Turns merged scan results into the analysis object the UI renders and stores.

import { civilFromDays } from './csv';
import { numStreamDense, numStreamDistinct } from './stream';
import {
    countAtOrBelow,
    countBelow,
    createDistribution,
    hllEstimate,
    quantile,
    select,
    sketchBuckets,
    valueAtRank,
} from './sketch';

export const ANALYSIS_VERSION = 2;
export const STRONG_CORRELATION = 0.7;
export const PERCENTILES = [1, 5, 10, 25, 50, 75, 90, 95, 99];
const TOP_CATEGORIES = 100;
const VALUE_BARS_MAX = 30;

export const pairKey = (catCol, numCol) => `${catCol}\u0000${numCol}`;

/* ---------- Moments ---------- */

/** Mean, sample std (ddof = 1, like pandas) and bias-corrected skew / excess kurtosis from shifted sums. */
export function momentsFromSums(n, shift, s1, s2, s3, s4) {
    if (n === 0) return { mean: NaN, std: NaN, skewness: NaN, kurtosis: NaN };
    const m = s1 / n;
    const m2 = Math.max(0, s2 / n - m * m);
    const m3 = s3 / n - 3 * m * (s2 / n) + 2 * m ** 3;
    const m4 = s4 / n - 4 * m * (s3 / n) + 6 * m * m * (s2 / n) - 3 * m ** 4;
    const std = n > 1 ? Math.sqrt((m2 * n) / (n - 1)) : 0;
    let skewness = NaN;
    let kurtosis = NaN;
    if (m2 > 0 && n > 2) skewness = (m3 / m2 ** 1.5) * (Math.sqrt(n * (n - 1)) / (n - 2));
    if (m2 > 0 && n > 3) kurtosis = (((n + 1) * (m4 / (m2 * m2) - 3) + 6) * (n - 1)) / ((n - 2) * (n - 3));
    return { mean: shift + m, std, skewness, kurtosis };
}

/* ---------- Normal quantile (Acklam) for Q-Q plots ---------- */

export function normalQuantile(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    if (p < lo) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - lo) {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* ---------- Histogram binning ---------- */

function niceStep(raw, integer) {
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    const steps = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
    const step = steps.find((s) => f <= s) * mag;
    return integer ? Math.max(1, Math.round(step)) : step;
}

const decimalsFor = (step) => Math.max(0, Math.ceil(-Math.log10(step)) + 1);

/** "Nice" bin edges covering [min, max]; bins are [a, b) except the last, which is closed. */
export function binEdges(min, max, targetBins, integer) {
    if (!(max > min)) return [min, max];
    const step = niceStep((max - min) / targetBins, integer);
    const digits = decimalsFor(step);
    const round = (v) => Number(v.toFixed(digits));
    const start = round(Math.floor(min / step) * step);
    const edges = [start];
    // The iteration cap guards against float rounding stalls on extreme magnitudes.
    for (let i = 1; edges[edges.length - 1] < max && i <= targetBins * 3 + 5; i++) edges.push(round(start + step * i));
    if (edges.length < 2) edges.push(round(start + step));
    return edges;
}

/** Freedman–Diaconis bin count, clamped to a readable range. */
export function autoBins(dist, iqr, integer) {
    const { total, min, max } = dist;
    const span = max - min;
    if (!(span > 0)) return 1;
    let bins = iqr > 0 ? Math.ceil(span / (2 * iqr * total ** (-1 / 3))) : Math.ceil(Math.log2(total) + 1);
    bins = Math.max(5, Math.min(50, bins));
    if (integer) bins = Math.min(bins, span + 1);
    return bins;
}

export function histogramFromEdges(dist, edges, integer) {
    if (edges.length === 2 && edges[0] === edges[1]) {
        return [{ start: edges[0], end: edges[1], count: dist.total, label: formatEdge(edges[0]) }];
    }
    const last = edges.length - 2;
    const bins = [];
    let before = countBelow(dist, edges[0]);
    for (let i = 0; i <= last; i++) {
        const upto = i === last ? countAtOrBelow(dist, edges[i + 1]) : countBelow(dist, edges[i + 1]);
        const a = edges[i];
        const b = edges[i + 1];
        let label;
        if (integer) label = b - 1 > a ? `${formatEdge(a)} to ${formatEdge(i === last ? b : b - 1)}` : formatEdge(a);
        else label = `${formatEdge(a)} to ${formatEdge(b)}`;
        bins.push({ start: a, end: b, count: upto - before, label, closed: i === last });
        before = upto;
    }
    return bins;
}

function formatEdge(v) {
    const abs = Math.abs(v);
    if (abs !== 0 && abs < 1e-3) return v.toExponential(2).replace(/\.?0+e/, 'e');
    if (abs >= 1e9) return `${+(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
    if (abs >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
    return `${+v.toPrecision(6)}`;
}

/* ---------- Numeric column summary ---------- */

export const HISTOGRAM_OPTIONS = ['auto', 10, 20, 50, 100];

function boxStats(dist) {
    const q1 = quantile(dist, 0.25);
    const median = quantile(dist, 0.5);
    const q3 = quantile(dist, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const outliersLow = countBelow(dist, lowerFence);
    const outliersHigh = dist.total - countAtOrBelow(dist, upperFence);
    return {
        min: dist.min,
        q1,
        median,
        q3,
        max: dist.max,
        iqr,
        lowerFence,
        upperFence,
        whiskerLow: valueAtRank(dist, outliersLow),
        whiskerHigh: valueAtRank(dist, dist.total - outliersHigh - 1),
        outliersLow,
        outliersHigh,
    };
}

function distinctFromSorted(sorted) {
    const values = [];
    const counts = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] === sorted[i - 1]) counts[counts.length - 1]++;
        else {
            values.push(sorted[i]);
            counts.push(1);
            if (values.length > VALUE_BARS_MAX) return null;
        }
    }
    return { values, counts };
}

function summariseNumeric(dist, moments, integer, totalRows, missing, invalid) {
    const box = boxStats(dist);
    const n = dist.total;
    const percentiles = PERCENTILES.map((p) => ({ p, value: quantile(dist, p / 100) }));

    let valueCounts = null;
    if (dist.exact) {
        const distinct = dist.counts ? { values: [...dist.values], counts: [...dist.counts] } : distinctFromSorted(dist.values);
        if (distinct && distinct.values.length <= VALUE_BARS_MAX) {
            valueCounts = distinct.values.map((value, i) => ({ value, count: distinct.counts[i] }));
        }
    }

    const autoCount = autoBins(dist, box.iqr, integer);
    const histograms = {};
    for (const option of HISTOGRAM_OPTIONS) {
        const target = option === 'auto' ? autoCount : integer ? Math.min(option, dist.max - dist.min + 1) : option;
        histograms[option] = histogramFromEdges(dist, binEdges(dist.min, dist.max, target, integer), integer);
    }

    const ecdf = [];
    for (let p = 0; p <= 100; p++) ecdf.push({ x: quantile(dist, p / 100), p });

    const qq = [];
    for (let i = 1; i <= 99; i++) {
        const p = (i - 0.5) / 99;
        qq.push({ theoretical: moments.mean + moments.std * normalQuantile(p), sample: quantile(dist, p) });
    }

    const cv = moments.mean !== 0 ? (moments.std / Math.abs(moments.mean)) * 100 : null;
    return {
        stat: {
            type: 'numeric',
            count: n,
            missing,
            invalid,
            missingPct: (missing / totalRows) * 100,
            invalidPct: (invalid / totalRows) * 100,
            mean: moments.mean,
            std: moments.std,
            skewness: moments.skewness,
            kurtosis: moments.kurtosis,
            cv,
            min: dist.min,
            max: dist.max,
            q1: box.q1,
            median: box.median,
            q3: box.q3,
            iqr: box.iqr,
            outliers: box.outliersLow + box.outliersHigh,
            outlierPct: n ? ((box.outliersLow + box.outliersHigh) / n) * 100 : 0,
            integer,
            exact: dist.exact,
            unique: dist.exact ? (dist.counts ? dist.values.length : distinctCount(dist.values)) : null,
        },
        detail: { box, percentiles, histograms, autoBins: autoCount, valueCounts, ecdf, qq },
    };
}

function distinctCount(sorted) {
    let count = sorted.length ? 1 : 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1]) count++;
    return count;
}

function columnDistribution(merged, j, min, max) {
    if (merged.exact) {
        const src = merged.buffers[j];
        let n = 0;
        for (let i = 0; i < src.length; i++) if (!Number.isNaN(src[i])) n++;
        const values = new Float64Array(n);
        let k = 0;
        for (let i = 0; i < src.length; i++) if (!Number.isNaN(src[i])) values[k++] = src[i];
        values.sort();
        return createDistribution(values, null, true, min, max);
    }
    const ns = merged.streams[j];
    const distinct = numStreamDistinct(ns);
    if (distinct) return createDistribution(distinct.values, distinct.counts, true, min, max);
    const dense = numStreamDense(ns);
    if (dense) return createDistribution(dense.values, dense.counts, true, min, max);
    const { values, counts } = sketchBuckets(ns.sketch);
    return createDistribution(values, counts, false, min, max);
}

/* ---------- Bivariate (group) statistics ---------- */

function groupQuantilesExact(values, n) {
    const rank = (q) => {
        const pos = (n - 1) * q;
        const lo = Math.floor(pos);
        const a = select(values, lo, 0, n - 1);
        if (pos === lo) return a;
        // The next order statistic is the minimum of the upper partition.
        let b = Infinity;
        for (let i = lo + 1; i < n; i++) if (values[i] < b) b = values[i];
        return a + (pos - lo) * (b - a);
    };
    const q1 = rank(0.25);
    const median = rank(0.5);
    const q3 = rank(0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    let whiskerLow = Infinity;
    let whiskerHigh = -Infinity;
    let outliers = 0;
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v < lowerFence || v > upperFence) outliers++;
        else {
            if (v < whiskerLow) whiskerLow = v;
            if (v > whiskerHigh) whiskerHigh = v;
        }
    }
    return { q1, median, q3, whiskerLow, whiskerHigh, outliers, exact: true };
}

function groupQuantilesFromDist(dist) {
    const box = boxStats(dist);
    return {
        q1: box.q1,
        median: box.median,
        q3: box.q3,
        whiskerLow: box.whiskerLow,
        whiskerHigh: box.whiskerHigh,
        outliers: box.outliersLow + box.outliersHigh,
        exact: dist.exact,
    };
}

function bivariateStats(merged, plan) {
    const out = {};
    const { maxGroups } = plan;
    const nGN = plan.groupNums.length;
    plan.groupCats.forEach((c, s) => {
        if (!merged.groups.active[s]) return;
        const catName = plan.columns[plan.categorical[c]];
        const names = merged.groups.names[s];
        plan.groupNums.forEach((j, k) => {
            const numName = plan.columns[plan.numeric[j]];
            const shift = plan.shifts[j];

            // Exact mode: partition this column's values by group, then select order statistics.
            const distinct = merged.exact ? null : numStreamDistinct(merged.streams[j]);
            let partitions = null;
            if (merged.exact) {
                const sizes = new Float64Array(names.length);
                const codes = merged.codes[s];
                const values = merged.buffers[j];
                for (let r = 0; r < values.length; r++) if (codes[r] !== 255 && !Number.isNaN(values[r])) sizes[codes[r]]++;
                partitions = names.map((_, g) => new Float64Array(sizes[g]));
                const fill = new Float64Array(names.length);
                for (let r = 0; r < values.length; r++) {
                    const g = codes[r];
                    if (g !== 255 && !Number.isNaN(values[r])) partitions[g][fill[g]++] = values[r];
                }
            }

            const rows = names
                .map((category, g) => {
                    const idx = (s * maxGroups + g) * nGN + k;
                    const n = merged.groups.n[idx];
                    if (!n) return null;
                    const mean = shift + merged.groups.s1[idx] / n;
                    const m2 = Math.max(0, merged.groups.s2[idx] / n - (merged.groups.s1[idx] / n) ** 2);
                    const std = n > 1 ? Math.sqrt((m2 * n) / (n - 1)) : 0;
                    const min = merged.groups.min[idx];
                    const max = merged.groups.max[idx];
                    let quantiles;
                    if (partitions) quantiles = groupQuantilesExact(partitions[g], partitions[g].length);
                    else quantiles = groupQuantilesFromDist(groupDistribution(distinct, merged.streams[j], s * maxGroups + g, min, max));
                    return { category, count: n, mean, std, min, max, ...quantiles };
                })
                .filter(Boolean)
                .sort((a, b) => b.mean - a.mean);
            out[pairKey(catName, numName)] = rows;
        });
    });
    return out;
}

function groupDistribution(distinct, ns, index, min, max) {
    if (distinct) {
        const values = [];
        const counts = [];
        for (let i = 0; i < distinct.values.length; i++) {
            const count = distinct.g ? distinct.g[i * distinct.width + index] : 0;
            if (count > 0) {
                values.push(distinct.values[i]);
                counts.push(count);
            }
        }
        return createDistribution(Float64Array.from(values), Float64Array.from(counts), true, min, max);
    }
    const sk = ns.groups?.[index];
    if (!sk) return createDistribution(new Float64Array(0), new Float64Array(0), false, min, max);
    const { values, counts } = sketchBuckets(sk);
    return createDistribution(values, counts, false, min, max);
}

/* ---------- Correlations ---------- */

function correlations(merged, plan) {
    const { corr } = merged;
    const nC = plan.corrCols.length;
    const out = [];
    let p = 0;
    for (let a = 0; a < nC; a++) {
        for (let b = a + 1; b < nC; b++, p++) {
            const n = corr.completeN + corr.pn[p];
            const sx = corr.cs1[a] + corr.psx[p];
            const sy = corr.cs1[b] + corr.psy[p];
            const sxx = corr.cs2[a] + corr.psxx[p];
            const syy = corr.cs2[b] + corr.psyy[p];
            const sxy = corr.csxy[p] + corr.psxy[p];
            const ja = plan.corrCols[a];
            const jb = plan.corrCols[b];
            let r = 0;
            let slope = NaN; // col2 = intercept + slope × col1
            let intercept = NaN;
            let slopeReverse = NaN; // col1 = interceptReverse + slopeReverse × col2
            let interceptReverse = NaN;
            if (n > 1) {
                const cov = sxy - (sx * sy) / n;
                const vx = sxx - (sx * sx) / n;
                const vy = syy - (sy * sy) / n;
                if (vx > 0 && vy > 0) r = Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy)));
                const meanX = plan.shifts[ja] + sx / n;
                const meanY = plan.shifts[jb] + sy / n;
                if (vx > 0) {
                    slope = cov / vx;
                    intercept = meanY - slope * meanX;
                }
                if (vy > 0) {
                    slopeReverse = cov / vy;
                    interceptReverse = meanX - slopeReverse * meanY;
                }
            }
            out.push({
                col1: plan.columns[plan.numeric[ja]],
                col2: plan.columns[plan.numeric[jb]],
                correlation: r,
                n,
                slope,
                intercept,
                slopeReverse,
                interceptReverse,
            });
        }
    }
    return out.sort((x, y) => Math.abs(y.correlation) - Math.abs(x.correlation));
}

/* ---------- Dates ---------- */

export const dayToIso = (day) => {
    const { y, m, d } = civilFromDays(day);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

function timeline(merged, plan, t) {
    const { byDay, overflow } = merged.dates.timelines[t];
    const days = [...byDay.keys()].sort((a, b) => a - b);
    const nTN = plan.timelineNums.length;
    return {
        overflow,
        days,
        counts: days.map((d) => byDay.get(d).count),
        measures: plan.timelineNums.map((j, k) => ({
            column: plan.columns[plan.numeric[j]],
            sums: days.map((d) => byDay.get(d).sums[k]),
            ns: days.map((d) => byDay.get(d).ns[k]),
        })),
        nTN,
    };
}

/* ---------- Insights ---------- */

const fmt = (v) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'n/a');

function buildInsights(analysis) {
    const { stats, numericCols, categoricalCols, dateCols, correlations: corrs, meta, idCols } = analysis;
    const insights = [];
    const add = (agent, type, text) => insights.push({ agent, type, text });

    for (const col of numericCols) {
        const s = stats[col];
        if (idCols.includes(col)) continue;
        if (Math.abs(s.skewness) > 1) {
            add('Analyst', 'warning', `**${col}** is strongly skewed to the ${s.skewness > 0 ? 'right' : 'left'} (skewness ${s.skewness.toFixed(2)}): the mean ${fmt(s.mean)} is pulled ${s.skewness > 0 ? 'above' : 'below'} the median ${fmt(s.median)}.`);
        }
        if (s.outlierPct > 1) {
            add('Analyst', 'warning', `**${col}** has ${fmt(s.outliers)} outliers (${s.outlierPct.toFixed(1)}%) beyond 1.5 × IQR, reaching up to ${fmt(s.max)}. Check whether they are errors or a **premium segment**.`);
        }
        if (s.invalid > 0) {
            const examples = analysis.numericDetails[col].invalidExamples;
            add('Quality', 'warning', `**${col}** has ${fmt(s.invalid)} values that aren’t numbers${examples.length ? ` (e.g. “${examples.slice(0, 3).join('”, “')}”)` : ''}. They are excluded from its statistics.`);
        }
    }
    for (const col of categoricalCols) {
        const top = analysis.categoricalDists[col]?.[0];
        if (top && stats[col].unique > 1 && top.percentage > 70) {
            add('Insight', 'info', `Dominant category in **${col}**: **${top.name}** covers ${top.percentage.toFixed(1)}% of records.`);
        }
    }
    for (const col of [...numericCols, ...categoricalCols, ...dateCols]) {
        if (stats[col].missingPct > 20) add('Quality', 'warning', `**${col}** is missing in ${stats[col].missingPct.toFixed(1)}% of records.`);
    }
    for (const c of corrs) {
        if (Math.abs(c.correlation) > STRONG_CORRELATION) {
            add('Analyst', 'info', `Strong **${c.correlation > 0 ? 'positive' : 'negative'}** correlation between **${c.col1}** and **${c.col2}** (r = ${c.correlation.toFixed(2)}).`);
        }
    }
    if (idCols.length) add('Quality', 'info', `**${idCols.join(', ')}** ${idCols.length > 1 ? 'look like identifiers' : 'looks like an identifier'}, so ${idCols.length > 1 ? 'they are' : 'it is'} left out of correlations and predictions.`);
    if (meta.malformedRows > 0) add('Quality', 'warning', `${fmt(meta.malformedRows)} rows have a different number of fields than the header. Missing fields were treated as empty.`);
    add('Insight', 'success', `All **${meta.rows.toLocaleString()} rows** analysed across **${meta.columns} columns** (${numericCols.length} numeric, ${categoricalCols.length} categorical${dateCols.length ? `, ${dateCols.length} date` : ''}).`);
    return insights;
}

/* ---------- Entry point ---------- */

/**
 * Column names for display: underscores and hyphens become spaces ("created_at" → "created at").
 * Names stay unique; the originals are kept in `meta.sourceColumns` for generated code.
 */
export function displayColumnNames(names) {
    const used = new Set();
    return names.map((raw) => {
        let name = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || raw;
        for (let k = 2; used.has(name); k++) name = `${raw.replace(/[_-]+/g, ' ').trim() || raw} (${k})`;
        used.add(name);
        return name;
    });
}

export function finalize(merged, sourcePlan, meta) {
    const plan = { ...sourcePlan, columns: displayColumnNames(sourcePlan.columns) };
    const { columns } = plan;
    const rows = merged.rows;
    const stats = {};
    const numericDetails = {};
    const categoricalDists = {};
    const timelines = {};

    plan.numeric.forEach((col, j) => {
        const name = columns[col];
        const { num } = merged;
        const moments = momentsFromSums(num.count[j], plan.shifts[j], num.s1[j], num.s2[j], num.s3[j], num.s4[j]);
        if (num.count[j] === 0) {
            stats[name] = { type: 'numeric', count: 0, missing: num.missing[j], invalid: num.invalid[j], missingPct: rows ? (num.missing[j] / rows) * 100 : 0, invalidPct: rows ? (num.invalid[j] / rows) * 100 : 0, mean: NaN, std: NaN, cv: null, min: NaN, max: NaN, median: NaN, q1: NaN, q3: NaN, iqr: NaN, outliers: 0, outlierPct: 0, exact: true, empty: true };
            numericDetails[name] = { empty: true, invalidExamples: num.invalidExamples[j] };
            return;
        }
        const dist = columnDistribution(merged, j, num.min[j], num.max[j]);
        const { stat, detail } = summariseNumeric(dist, moments, !num.nonInteger[j], rows, num.missing[j], num.invalid[j]);
        stats[name] = stat;
        numericDetails[name] = { ...detail, invalidExamples: num.invalidExamples[j] };
    });

    plan.categorical.forEach((col, c) => {
        const name = columns[col];
        const { counts, missing, pruned, dropped, hll } = merged.cat[c];
        const present = rows - missing;
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        categoricalDists[name] = sorted.slice(0, TOP_CATEGORIES).map(([n, value]) => ({ name: n, value, percentage: present ? (value / present) * 100 : 0 }));
        const otherCount = sorted.slice(TOP_CATEGORIES).reduce((a, e) => a + e[1], 0) + dropped;
        stats[name] = {
            type: 'categorical',
            count: present,
            unique: pruned ? Math.max(hllEstimate(hll), counts.size) : counts.size,
            uniqueExact: !pruned,
            mode: sorted[0]?.[0] ?? 'n/a',
            modePct: present && sorted[0] ? (sorted[0][1] / present) * 100 : 0,
            missing,
            missingPct: rows ? (missing / rows) * 100 : 0,
            otherCount,
            countsExact: !pruned,
        };
    });

    plan.dates.forEach((col, d) => {
        const name = columns[col];
        const { count, missing, invalid, min, max } = merged.dates;
        stats[name] = {
            type: 'date',
            count: count[d],
            missing: missing[d],
            invalid: invalid[d],
            missingPct: rows ? (missing[d] / rows) * 100 : 0,
            min: count[d] ? dayToIso(min[d]) : null,
            max: count[d] ? dayToIso(max[d]) : null,
            spanDays: count[d] ? max[d] - min[d] + 1 : 0,
        };
        const t = plan.timelineDates.indexOf(d);
        if (t >= 0) timelines[name] = timeline(merged, plan, t);
    });

    const numericCols = plan.numeric.map((c) => columns[c]);
    const categoricalCols = plan.categorical.map((c) => columns[c]);
    const dateCols = plan.dates.map((c) => columns[c]);
    const idCols = plan.idCols.map((c) => columns[c]);
    const chartableCatCols = plan.groupCats.filter((_, s) => merged.groups.active[s]).map((c) => columns[plan.categorical[c]]);

    const sampleRows = merged.reservoir.map((row) =>
        row.map((v, k) => (plan.kinds[k] === 'numeric' ? (v === '' || Number.isNaN(Number(v)) ? null : Number(v)) : v)),
    );

    const approxColumns = numericCols.filter((c) => stats[c].exact === false);
    const analysis = {
        version: ANALYSIS_VERSION,
        meta: {
            ...meta,
            rows,
            columns: columns.length,
            delimiter: String.fromCharCode(plan.delimiter),
            sourceColumns: sourcePlan.columns,
            malformedRows: merged.malformed,
            exactStats: approxColumns.length === 0,
            approxColumns,
        },
        columns,
        kinds: plan.kinds,
        recordCount: rows,
        totalRecords: rows,
        numericCols,
        categoricalCols,
        dateCols,
        idCols,
        chartableCatCols,
        stats,
        numericDetails,
        categoricalDists,
        timelines,
        correlations: correlations(merged, plan),
        bivariate: bivariateStats(merged, plan),
        sample: { columns, rows: sampleRows },
        preview: merged.preview,
    };
    analysis.insights = buildInsights(analysis);
    return analysis;
}
