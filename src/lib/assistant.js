// Rule-based assistant that answers questions from the precomputed analysis.
// Runs entirely in the browser; no data is sent anywhere.

import { STRONG_CORRELATION, approx, formatDate, formatNumber, formatPct } from './analysis';
import { measureCols } from './blueprints';

export const SUGGESTED_QUESTIONS = [
    'Summarize the dataset',
    'Show strong correlations',
    'Which column has the highest CV?',
    'Which columns have missing values?',
    'Where are the outliers?',
    'What patterns or anomalies did you find?',
];

/** The column whose name appears in the query; longest match wins so "price_usd" beats "price". */
const findColumn = (query, columns) =>
    [...columns].sort((a, b) => b.length - a.length).find((c) => query.includes(c.toLowerCase()));

const has = (query, ...words) => words.some((w) => query.includes(w));
const list = (cols) => cols.map((c) => `**${c}**`).join(', ');

export function answer(rawQuery, analysis) {
    const query = ` ${rawQuery.toLowerCase()} `;
    const { stats, numericCols, categoricalCols, dateCols, correlations, categoricalDists, insights, meta, numericDetails } = analysis;
    const measures = measureCols(analysis);
    const numCol = findColumn(query, numericCols);
    const catCol = findColumn(query, categoricalCols);
    const dateCol = findColumn(query, dateCols);

    if (has(query, 'summary', 'summarize', 'overview', 'describe the data')) {
        const top = correlations[0];
        return [
            `This dataset has **${meta.rows.toLocaleString()} records** and **${meta.columns} columns** (${numericCols.length} numeric, ${categoricalCols.length} categorical${dateCols.length ? `, ${dateCols.length} date` : ''}). Every row was analysed.`,
            top ? `The strongest relationship is **${top.col1}** vs **${top.col2}** (r = ${top.correlation.toFixed(2)}).` : '',
        ].join(' ');
    }

    if (has(query, 'missing', 'null', 'empty', 'complete')) {
        const missing = analysis.columns.filter((c) => stats[c].missing > 0 || stats[c].invalid > 0);
        return missing.length
            ? `Columns with missing or unusable values:\n${missing
                  .map((c) => `- **${c}**: ${formatPct(stats[c].missingPct)} missing${stats[c].invalid ? `, ${formatNumber(stats[c].invalid)} not numeric` : ''}`)
                  .join('\n')}`
            : 'Good news: every column is **100% complete**.';
    }

    if (has(query, ' cv', 'variab', 'volatil', 'inconsist', 'coefficient')) {
        const ranked = measures.filter((c) => stats[c].cv != null).sort((a, b) => stats[b].cv - stats[a].cv);
        if (!ranked.length) return 'There are no numeric columns with a defined coefficient of variation.';
        return `**${ranked[0]}** is the most variable column (CV ${formatPct(stats[ranked[0]].cv)}). CV is spread relative to the mean, so higher means less predictable.\n\nRanking:\n${ranked
            .slice(0, 5)
            .map((c) => `- **${c}**: ${formatPct(stats[c].cv)}`)
            .join('\n')}`;
    }

    if (has(query, 'outlier', 'extreme', 'unusual')) {
        const cols = (numCol ? [numCol] : measures).filter((c) => stats[c].outliers > 0).sort((a, b) => stats[b].outlierPct - stats[a].outlierPct);
        if (!cols.length) return 'No values fall outside 1.5 × IQR of their column, so there are no outliers by the box plot rule.';
        return `Values beyond 1.5 × IQR (the box plot rule):\n${cols
            .slice(0, 6)
            .map((c) => {
                const box = numericDetails[c].box;
                return `- **${c}**: ${formatNumber(stats[c].outliers)} (${formatPct(stats[c].outlierPct)}) outside ${formatNumber(box.lowerFence)} to ${formatNumber(box.upperFence)}`;
            })
            .join('\n')}`;
    }

    if (has(query, 'correlat', 'relationship', 'related')) {
        const strong = correlations.filter((c) => Math.abs(c.correlation) > 0.6).slice(0, 5);
        return strong.length
            ? `Strongest correlations (|r| > 0.6), computed over all rows:\n${strong.map((c) => `- **${c.col1}** & **${c.col2}**: ${c.correlation.toFixed(2)}`).join('\n')}`
            : 'No strong correlations (|r| > 0.6) were found. The relationships may be weak or not linear.';
    }

    if (has(query, 'percentile', 'quantile', 'p90', 'p95', 'p99')) {
        if (!numCol) return `Which numeric column? Try one of: ${list(measures)}.`;
        const s = stats[numCol];
        return `Percentiles of **${numCol}**${s.exact ? '' : ' (estimated to within 0.1%)'}:\n${numericDetails[numCol].percentiles
            .map((p) => `- P${p.p}: ${approx(s.exact)}${formatNumber(p.value)}`)
            .join('\n')}`;
    }

    if (has(query, 'skew', 'shape', 'normal')) {
        if (!numCol) return `Which numeric column? Try one of: ${list(measures)}.`;
        const s = stats[numCol];
        const shape = Math.abs(s.skewness) < 0.5 ? 'roughly symmetric' : s.skewness > 0 ? 'skewed to the right (a long tail of high values)' : 'skewed to the left (a long tail of low values)';
        return `**${numCol}** is ${shape}: skewness ${formatNumber(s.skewness)}, excess kurtosis ${formatNumber(s.kurtosis)}. Compare its Q-Q plot in Explore → Univariate to see how far it departs from a normal distribution.`;
    }

    if (has(query, 'distribution', 'spread', 'range', 'iqr')) {
        if (!numCol) return `Which numeric column? Try one of: ${list(measures)}.`;
        const s = stats[numCol];
        return `**${numCol}** ranges from **${formatNumber(s.min)}** to **${formatNumber(s.max)}**. The interquartile range is **${approx(s.exact)}${formatNumber(s.iqr)}**, so the middle 50% of values fall between ${formatNumber(s.q1)} and ${formatNumber(s.q3)}.`;
    }

    if (dateCol || has(query, 'date', 'when', 'time period', 'busiest')) {
        const col = dateCol || dateCols[0];
        if (!col) return 'This dataset has no date columns.';
        const s = stats[col];
        const tl = analysis.timelines[col];
        let busiest = '';
        if (tl?.days.length) {
            const i = tl.counts.reduce((best, c, k) => (c > tl.counts[best] ? k : best), 0);
            busiest = ` The busiest day was **${dayLabel(tl.days[i])}** with ${formatNumber(tl.counts[i])} records.`;
        }
        return `**${col}** runs from **${formatDate(s.min)}** to **${formatDate(s.max)}** (${formatNumber(s.spanDays)} days).${busiest}`;
    }

    if (has(query, 'category', 'categories', 'mode', 'frequent', 'common', 'top')) {
        if (!catCol) return `Which categorical column? Try one of: ${list(categoricalCols)}.`;
        const top = (categoricalDists[catCol] || []).slice(0, 3);
        return `The most frequent value in **${catCol}** is **${top[0]?.name}** (${top[0]?.percentage.toFixed(1)}%).${
            top.length > 1 ? ` Next: ${top.slice(1).map((d) => `${d.name} (${d.percentage.toFixed(1)}%)`).join(', ')}.` : ''
        }`;
    }

    if (has(query, 'highest', 'maximum', 'max', 'largest')) {
        return numCol ? `The maximum of **${numCol}** is **${formatNumber(stats[numCol].max)}**.` : 'Which numeric column should I look at?';
    }

    if (has(query, 'lowest', 'minimum', ' min', 'smallest')) {
        return numCol ? `The minimum of **${numCol}** is **${formatNumber(stats[numCol].min)}**.` : 'Which numeric column should I look at?';
    }

    if (has(query, 'average', 'mean', 'median')) {
        if (!numCol) return 'Which numeric column should I average?';
        const s = stats[numCol];
        return `The average of **${numCol}** is **${formatNumber(s.mean)}** (median ${approx(s.exact)}${formatNumber(s.median)}, standard deviation ${formatNumber(s.std)}).`;
    }

    if (has(query, 'insight', 'pattern', 'anomal', 'finding')) {
        const findings = insights.filter((i) => i.type !== 'success');
        return findings.length ? `Key findings:\n${findings.map((i) => `- ${i.text}`).join('\n')}` : 'No notable patterns or anomalies were detected.';
    }

    if (has(query, 'column', 'feature', 'field')) {
        return `**Numeric:** ${numericCols.join(', ') || 'none'}\n**Categorical:** ${categoricalCols.join(', ') || 'none'}${dateCols.length ? `\n**Dates:** ${dateCols.join(', ')}` : ''}`;
    }

    const strongCount = correlations.filter((c) => Math.abs(c.correlation) > STRONG_CORRELATION).length;
    const example = measures[0] ?? '[column]';
    return `I can answer questions about this dataset's ${meta.columns} columns and ${strongCount} strong correlations. Try:\n- "**Summarize** the dataset"\n- "What is the **average** of ${example}?"\n- "**Percentiles** of ${example}"\n- "Is ${example} **skewed**?"\n- "**Top categories** in ${categoricalCols[0] ?? '[column]'}"`;
}

function dayLabel(day) {
    return formatDate(new Date(day * 864e5).toISOString().slice(0, 10));
}
