import { analyzeFile } from '../../engine';
import { formatBytes, formatCompact, formatDate, formatDuration, formatNumber } from '../analysis';
import { answer } from '../assistant';
import { guessTarget, measureCols, predictiveSummary, qualitySummary } from '../blueprints';
import { buildNotebook, buildPythonTemplate, buildReport } from '../exporters';
import { createSampleFile } from '../sampleData';
import { aggregateTimeline } from '../timeline';

let analysis;
beforeAll(async () => {
    analysis = await analyzeFile(createSampleFile(3000));
});

describe('formatters', () => {
    test('numbers, sizes and durations', () => {
        expect(formatNumber(null)).toBe('n/a');
        expect(formatNumber(Infinity)).toBe('∞');
        expect(formatNumber(-0.0001)).toBe('0');
        expect(formatBytes(1500)).toBe('1.5 KB');
        expect(formatDuration(65_000)).toBe('1 min 05 s');
        expect(formatCompact(1_250_000)).toMatch(/1\.3M/);
    });
});

describe('sample dataset analysis', () => {
    test('types every column and flags the ID', () => {
        expect(analysis.meta.rows).toBe(3000);
        expect(analysis.idCols).toEqual(['OrderID']);
        expect(analysis.dateCols).toEqual(['OrderDate']);
        expect(measureCols(analysis)).toEqual(['StorageGB', 'Price', 'Discount', 'CustomerAge', 'Satisfaction']);
        expect(guessTarget(analysis)).toBe('Price');
    });

    test('blueprints', () => {
        expect(qualitySummary(analysis).missing.map((m) => m.col)).toEqual(['Satisfaction']);
        expect(predictiveSummary(analysis).target).toBe('Price');
    });

    test('timeline rolls days into months without losing records', () => {
        const { points, granularity } = aggregateTimeline(analysis.timelines.OrderDate, 'month', null);
        expect(granularity).toBe('month');
        expect(points.reduce((s, p) => s + p.value, 0)).toBe(3000);
        const means = aggregateTimeline(analysis.timelines.OrderDate, 'auto', 'Price').points.filter((p) => p.value != null);
        expect(means.every((p) => p.value > 0)).toBe(true);
    });
});

describe('assistant', () => {
    test('answers from the analysis', () => {
        expect(answer('what is the average of price?', analysis)).toContain(`**${formatNumber(analysis.stats.Price.mean)}**`);
        expect(answer('which columns have missing values', analysis)).toContain('**Satisfaction**');
        expect(answer('Which column has the highest CV?', analysis)).toContain('most variable');
        expect(answer('percentiles of price', analysis)).toContain('P90');
        expect(answer('where are the outliers?', analysis)).toMatch(/1\.5 × IQR/);
        expect(answer('when did orders happen', analysis)).toContain('**OrderDate**');
    });
});

describe('display names', () => {
    test('underscores and hyphens read as spaces, but generated code keeps the real names', async () => {
        const rows = Array.from({ length: 40 }, (_, i) => `${i % 7},${(i * 3) % 11},${i % 2 ? 'x' : 'y'},2024-0${1 + (i % 9)}-15`);
        const blob = new Blob([`unit_price,unit-count,store_type,order_date\n${rows.join('\n')}\n`]);
        const a = await analyzeFile(blob);
        expect(a.columns).toEqual(['unit price', 'unit count', 'store type', 'order date']);
        expect(a.meta.sourceColumns).toEqual(['unit_price', 'unit-count', 'store_type', 'order_date']);
        const template = buildPythonTemplate(a);
        expect(template).toContain("numerical_cols = ['unit_price', 'unit-count']");
        expect(template).toContain("date_cols = ['order_date']");
        expect(formatDate('2024-01-31')).toBe('31 Jan 2024');
    });
});

describe('exporters', () => {
    test('report, notebook and template are well formed', () => {
        expect(buildReport(analysis)).toContain('### Price (numeric)');
        expect(JSON.parse(buildNotebook(analysis)).nbformat).toBe(4);
        const template = buildPythonTemplate(analysis);
        expect(template).toContain("numerical_cols = ['StorageGB', 'Price'");
        expect(template).toContain("date_cols = ['OrderDate']");
    });
});
