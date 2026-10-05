// Higher-level, business-facing summaries derived from an analysis result.

import { STRONG_CORRELATION, correlationBetween, pairKey } from './analysis';

const TARGET_HINTS = ['price', 'revenue', 'sales', 'salary', 'income', 'amount', 'total', 'cost', 'value', 'score'];

/** Numeric columns worth analysing: everything except likely identifiers and empty columns. */
export const measureCols = (analysis) =>
    analysis.numericCols.filter((c) => !analysis.idCols.includes(c) && !analysis.stats[c].empty);

/** Best guess at the numeric column the user most likely cares about predicting. */
export function guessTarget(analysis) {
    const cols = measureCols(analysis);
    for (const hint of TARGET_HINTS) {
        const match = cols.find((c) => c.toLowerCase().includes(hint));
        if (match) return match;
    }
    return cols[0] ?? null;
}

export function decisionSummary(analysis) {
    const { stats, correlations, insights } = analysis;
    const unstable = measureCols(analysis)
        .filter((c) => stats[c].cv != null && stats[c].cv > 50)
        .map((c) => ({ col: c, cv: stats[c].cv }))
        .sort((a, b) => b.cv - a.cv);
    const drivers = correlations.filter((c) => Math.abs(c.correlation) >= STRONG_CORRELATION).slice(0, 3);
    const risks = insights.filter((i) => i.type === 'warning');
    return { unstable, drivers, risks };
}

export function qualitySummary(analysis) {
    const { stats, columns, categoricalCols, idCols } = analysis;
    const rows = analysis.meta.rows;

    const missing = columns
        .map((col) => {
            const s = stats[col];
            const cells = (s.missing || 0) + (s.invalid || 0);
            return { col, pct: rows ? (cells / rows) * 100 : 0, rows: cells, invalid: s.invalid || 0 };
        })
        .filter((m) => m.rows > 0)
        .sort((a, b) => b.pct - a.pct);

    const highCardinality = [...new Set([...idCols, ...categoricalCols.filter((c) => stats[c].unique / rows > 0.8)])];
    const inconsistent = measureCols(analysis)
        .filter((c) => stats[c].cv != null && stats[c].cv > 75)
        .map((c) => ({ col: c, cv: stats[c].cv }));

    const cells = rows * columns.length;
    const missingCells = missing.reduce((acc, m) => acc + m.rows, 0);
    const completeness = cells ? 100 - (missingCells / cells) * 100 : 100;

    return { missing, highCardinality, inconsistent, completeness };
}

/** Highest-mean and lowest-mean groups for `target` across every chartable categorical column. */
function extremeGroups(analysis, target) {
    let best = null;
    let worst = null;
    for (const catCol of analysis.chartableCatCols) {
        for (const g of analysis.bivariate[pairKey(catCol, target)] || []) {
            if (!best || g.mean > best.mean) best = { column: catCol, ...g };
            if (!worst || g.mean < worst.mean) worst = { column: catCol, ...g };
        }
    }
    return { best, worst };
}

export function segmentationSummary(analysis) {
    const target = guessTarget(analysis);
    const { stats, categoricalCols, correlations } = analysis;

    const driver = target
        ? correlations
              .filter((c) => c.col1 === target || c.col2 === target)
              .map((c) => ({ col: c.col1 === target ? c.col2 : c.col1, r: c.correlation }))[0] ?? null
        : null;

    const { best } = target ? extremeGroups(analysis, target) : { best: null };

    // The volume segment is the most common value of the most concentrated multi-valued column.
    const volumeCol = categoricalCols
        .filter((c) => stats[c].unique > 1 && stats[c].unique < 50)
        .sort((a, b) => stats[b].modePct - stats[a].modePct)[0];
    const volume = volumeCol ? { column: volumeCol, group: stats[volumeCol].mode, pct: stats[volumeCol].modePct } : null;

    return { target, driver, premium: best, volume };
}

export function predictiveSummary(analysis) {
    const { stats, correlations, bivariate, chartableCatCols } = analysis;
    const cols = measureCols(analysis);
    const target = guessTarget(analysis);
    if (!target || cols.length < 2) return { target, predictors: [], skewed: [], best: null, worst: null };

    // Risk-adjusted score: strong relationship with the target, weighted down by noisy (high-CV) features.
    const predictors = cols
        .filter((c) => c !== target && stats[c].cv)
        .map((col) => {
            const r = Math.abs(correlationBetween(correlations, col, target));
            const { cv } = stats[col];
            return { col, r, cv, score: r / (cv / 100) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    const targetStd = stats[target].std;
    const skewed = chartableCatCols
        .flatMap((catCol) =>
            (bivariate[pairKey(catCol, target)] || [])
                .filter((g) => g.mean > 0 && g.mean - g.median > 0.2 * targetStd)
                .map((g) => ({ column: catCol, group: g.category, gap: g.mean - g.median })),
        )
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 3);

    const { best, worst } = extremeGroups(analysis, target);
    return { target, predictors, skewed, best, worst };
}
