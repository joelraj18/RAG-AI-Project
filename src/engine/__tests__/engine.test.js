import { binEdges, momentsFromSums, normalQuantile } from '../finalize';
import { analyzeFile, pairKey } from '../index';
import { mergePartials } from '../merge';
import { finalize } from '../finalize';
import { buildPlan, sniff } from '../plan';
import { scanRange } from '../scanner';
import { parseDay, parseNumber, normaliseHeader } from '../csv';

const enc = (s) => Uint8Array.from(Buffer.from(s, 'utf8'));

/* ---------- Deterministic test data ---------- */

function makeCsv(rows, seed = 7) {
    let x = seed;
    const rand = () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x / 2147483648;
    };
    const regions = ['North', 'South', 'East', 'West'];
    const lines = ['id,region,price,qty,score,day,note'];
    const data = [];
    for (let i = 0; i < rows; i++) {
        const region = regions[Math.floor(rand() * 4)];
        const qty = 1 + Math.floor(rand() * 9);
        const price = Math.round((50 + rand() * 900 + qty * 20) * 100) / 100;
        const score = rand() < 0.05 ? null : Math.round(rand() * 1000) / 10;
        const day = `2024-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`;
        const note = rand() < 0.1 ? '"has, comma"' : rand() < 0.1 ? 'NA' : `n${i % 37}`;
        lines.push([i + 1, region, price, qty, score ?? '', day, note].join(','));
        data.push({ id: i + 1, region, price, qty, score, day, note: note === 'NA' ? null : note.replace(/"/g, '') });
    }
    return { text: `${lines.join('\n')}\n`, data };
}

const sortedNums = (arr) => Float64Array.from(arr.filter((v) => v != null)).sort();
const q7 = (sorted, q) => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    return lo + 1 < sorted.length ? sorted[lo] + (pos - lo) * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sampleStd = (a) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const pearson = (xs, ys) => {
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    xs.forEach((x, i) => {
        num += (x - mx) * (ys[i] - my);
        dx += (x - mx) ** 2;
        dy += (ys[i] - my) ** 2;
    });
    return num / Math.sqrt(dx * dy);
};

/** Runs the scan split into `parts` byte ranges, as the parallel workers would. */
async function analyseInParts(text, parts, forceMode) {
    const file = new Blob([text]);
    file.name = 'test.csv';
    const sniffed = await sniff(file);
    const plan = buildPlan(sniffed, file.size, { cores: parts, forceMode });
    plan.workers = parts;
    const size = Math.ceil((file.size - plan.dataStart) / parts);
    const ranges = Array.from({ length: parts }, (_, i) => ({
        index: i,
        start: plan.dataStart + i * size,
        end: Math.min(file.size, plan.dataStart + (i + 1) * size),
    }));
    const partials = [];
    for (const r of ranges) partials.push(await scanRange(file, r, plan));
    return finalize(mergePartials(partials, plan), plan, { fileName: 'test.csv', fileSize: file.size });
}

/* ---------- Primitives ---------- */

describe('csv primitives', () => {
    test('parseNumber matches JavaScript parsing', () => {
        for (const s of ['0', '-12', '3.14159', '0.1', '1e3', '-2.5E-3', '.5', '+7', '123456789012345678', ' 42 ', '0.30000000000000004']) {
            expect(parseNumber(enc(s), 0, s.length)).toBe(Number(s.trim()));
        }
        for (const s of ['1,000', '12kg', '-', '.', 'abc', '1e999']) expect(parseNumber(enc(s), 0, s.length)).toBeNaN();
    });

    test('parseDay handles ISO dates and rejects invalid ones', () => {
        expect(parseDay(enc('1970-01-02'), 0, 10)).toBe(1);
        expect(parseDay(enc('2024/02/29 10:00'), 0, 16)).toBe(Date.UTC(2024, 1, 29) / 864e5);
        expect(parseDay(enc('2024-13-01'), 0, 10)).toBeNaN();
        expect(parseDay(enc('03/04/2024'), 0, 10)).toBeNaN();
    });

    test('headers are de-duplicated like pandas', () => {
        expect(normaliseHeader(['a', 'a', '', 'a'])).toEqual(['a', 'a.1', 'Unnamed: 2', 'a.2']);
    });

    test('moments and bins', () => {
        const xs = [2, 4, 4, 4, 5, 5, 7, 9];
        const m = momentsFromSums(xs.length, 0, ...[1, 2, 3, 4].map((p) => xs.reduce((s, v) => s + v ** p, 0)));
        expect(m.mean).toBeCloseTo(5);
        expect(m.std).toBeCloseTo(sampleStd(xs));
        expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
        expect(binEdges(0, 100, 10, false)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
        const ages = binEdges(18, 63, 15, true);
        expect(ages[0]).toBeLessThanOrEqual(18);
        expect(ages[ages.length - 1]).toBeGreaterThanOrEqual(63);
        expect(ages.every((e) => Number.isInteger(e))).toBe(true);
    });
});

/* ---------- Full pipeline vs reference ---------- */

describe.each([
    ['exact, single range', 1, 'exact'],
    ['exact, four ranges', 4, 'exact'],
    ['streaming, single range', 1, 'stream'],
    ['streaming, three ranges', 3, 'stream'],
])('%s', (_, parts, mode) => {
    const { text, data } = makeCsv(3000);
    let a;
    beforeAll(async () => {
        a = await analyseInParts(text, parts, mode);
    });

    test('counts every row and types columns', () => {
        expect(a.meta.rows).toBe(3000);
        expect(a.numericCols).toEqual(['id', 'price', 'qty', 'score']);
        expect(a.idCols).toEqual(['id']);
        expect(a.dateCols).toEqual(['day']);
        expect(a.categoricalCols).toEqual(['region', 'note']);
    });

    test('exact moments and extremes', () => {
        const prices = data.map((d) => d.price);
        expect(a.stats.price.mean).toBeCloseTo(mean(prices), 9);
        expect(a.stats.price.std).toBeCloseTo(sampleStd(prices), 9);
        expect(a.stats.price.min).toBe(Math.min(...prices));
        expect(a.stats.price.max).toBe(Math.max(...prices));
        expect(a.stats.score.missing).toBe(data.filter((d) => d.score == null).length);
    });

    test('quantiles: exact, or within the sketch error bound', () => {
        const sorted = sortedNums(data.map((d) => d.price));
        const tolerance = mode === 'exact' ? 1e-9 : 0.0025;
        for (const [q, key] of [[0.25, 'q1'], [0.5, 'median'], [0.75, 'q3']]) {
            const truth = q7(sorted, q);
            expect(Math.abs(a.stats.price[key] - truth) / truth).toBeLessThanOrEqual(tolerance);
        }
        expect(a.stats.price.exact).toBe(mode === 'exact');
        // A discrete column stays exact even in streaming mode.
        expect(a.stats.qty.exact).toBe(true);
        expect(a.stats.qty.median).toBe(q7(sortedNums(data.map((d) => d.qty)), 0.5));
    });

    test('histogram bins account for every value', () => {
        for (const option of ['auto', 10, 20, 50, 100]) {
            const total = a.numericDetails.price.histograms[option].reduce((s, b) => s + b.count, 0);
            expect(total).toBe(3000);
        }
        expect(a.numericDetails.qty.valueCounts).toHaveLength(9);
    });

    test('pairwise-complete correlation', () => {
        const rows = data.filter((d) => d.score != null);
        const expected = pearson(rows.map((d) => d.price), rows.map((d) => d.score));
        const got = a.correlations.find((c) => c.col1 === 'price' && c.col2 === 'score');
        expect(got.correlation).toBeCloseTo(expected, 9);
        const all = a.correlations.find((c) => c.col1 === 'price' && c.col2 === 'qty');
        expect(all.correlation).toBeCloseTo(pearson(data.map((d) => d.price), data.map((d) => d.qty)), 9);
    });

    test('group statistics', () => {
        const groups = a.bivariate[pairKey('region', 'price')];
        expect(groups.map((g) => g.count).reduce((s, v) => s + v, 0)).toBe(3000);
        for (const g of groups) {
            const vals = data.filter((d) => d.region === g.category).map((d) => d.price);
            expect(g.mean).toBeCloseTo(mean(vals), 9);
            const truth = q7(sortedNums(vals), 0.5);
            expect(Math.abs(g.median - truth) / truth).toBeLessThanOrEqual(mode === 'exact' ? 1e-12 : 0.011);
        }
    });

    test('categories, missing tokens and quoted commas', () => {
        const notes = data.map((d) => d.note);
        expect(a.stats.note.missing).toBe(notes.filter((n) => n == null).length);
        const comma = a.categoricalDists.note.find((c) => c.name === 'has, comma');
        expect(comma.value).toBe(notes.filter((n) => n === 'has, comma').length);
    });

    test('dates and the random sample', () => {
        const days = data.map((d) => d.day).sort();
        expect(a.stats.day.min).toBe(days[0]);
        expect(a.stats.day.max).toBe(days[days.length - 1]);
        expect(a.timelines.day.counts.reduce((s, v) => s + v, 0)).toBe(3000);
        expect(a.sample.rows).toHaveLength(3000); // fewer rows than the reservoir size
    });
});

describe('dense integer counters (streaming mode)', () => {
    // 20,000 rows: a whole-number column with ~15,000 distinct values (exact via dense counters)
    // and a column that turns fractional late in the file (must fall back to the sketch).
    const rows = Array.from({ length: 20000 }, (_, i) => {
        const units = (i * 7919) % 15000;
        const late = i < 15000 ? i % 3000 : (i % 3000) + 0.5;
        return { units, late };
    });
    const text = `units,late\n${rows.map((r) => `${r.units},${r.late}`).join('\n')}\n`;

    test.each([1, 3])('exact quantiles for whole numbers across %i range(s)', async (parts) => {
        const a = await analyseInParts(text, parts, 'stream');
        const sorted = sortedNums(rows.map((r) => r.units));
        expect(a.stats.units.exact).toBe(true);
        expect(a.stats.units.median).toBe(q7(sorted, 0.5));
        expect(a.stats.units.q1).toBe(q7(sorted, 0.25));
        expect(a.numericDetails.units.histograms.auto.reduce((s, b) => s + b.count, 0)).toBe(20000);

        const lateSorted = sortedNums(rows.map((r) => r.late));
        expect(a.stats.late.exact).toBe(false);
        expect(Math.abs(a.stats.late.median - q7(lateSorted, 0.5)) / q7(lateSorted, 0.5)).toBeLessThan(0.0025);
    });
});

describe('high-cardinality text', () => {
    test('a column with 60,000 unique values finishes, with an estimated distinct count', async () => {
        const lines = Array.from({ length: 60000 }, (_, i) => `user-${(i * 2654435761) % 4294967296},${i % 3 ? 'a' : 'b'}`);
        const a = await analyseInParts(`user,flag\n${lines.join('\n')}\n`, 1, 'stream');
        expect(a.meta.rows).toBe(60000);
        expect(a.stats.user.uniqueExact).toBe(false);
        expect(Math.abs(a.stats.user.unique - 60000) / 60000).toBeLessThan(0.03);
        expect(a.stats.flag.unique).toBe(2);
        expect(a.categoricalDists.flag[0]).toEqual(expect.objectContaining({ name: 'a', value: 40000 }));
    });
});

describe('analyzeFile (main-thread fallback)', () => {
    test('handles CRLF, BOM, semicolons and invalid numbers', async () => {
        const good = Array.from({ length: 12 }, (_, k) => `${k};${k % 2 ? 'x' : 'y'};2024-01-0${1 + (k % 9)}`);
        const text = `\ufeffa;b;c\r\n${good.join('\r\n')}\r\nabc;x;\r\n4;;2024-01-03\r\n`;
        const file = new Blob([text]);
        file.name = 'semi.csv';
        const progress = [];
        const a = await analyzeFile(file, { onProgress: (p) => progress.push(p.phase) });
        expect(a.columns).toEqual(['a', 'b', 'c']);
        expect(a.meta.delimiter).toBe(';');
        expect(a.stats.a.count).toBe(13);
        expect(a.stats.a.invalid).toBe(1);
        expect(a.numericDetails.a.invalidExamples).toEqual(['abc']);
        expect(a.stats.b.missing).toBe(1);
        expect(progress).toEqual(expect.arrayContaining(['reading', 'scanning', 'finalising']));
    });

    test('rejects files without data rows', async () => {
        const file = new Blob(['a,b\n']);
        await expect(analyzeFile(file)).rejects.toThrow(/no data rows/);
    });
});
