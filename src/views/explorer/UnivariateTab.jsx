import React, { useMemo, useState } from 'react';
import { ChartCard, Segmented, SelectPill } from '../../components/ChartCard';
import { CategoryBarsChart, CategoryDonut, EcdfChart, HistogramChart, QQChart, TimelineChart, ValueBarsChart, donutSlices } from '../../components/charts';
import { BoxPlotChart } from '../../components/svgCharts';
import { Callout, Card, DataTable, EmptyState, SectionTitle } from '../../components/ui';
import { approx, formatDate, formatNumber, formatPct } from '../../lib/analysis';
import { measureCols } from '../../lib/blueprints';
import { GLOSSARY } from '../../lib/glossary';
import { CHART } from '../../lib/palette';
import { GRANULARITY_OPTIONS, aggregateTimeline } from '../../lib/timeline';

const cvTone = (cv) => (cv == null ? '' : cv > 75 ? 'text-warn' : cv > 50 ? 'text-caution' : '');
const accuracyNote = (exact) => (exact ? 'exact' : 'quantiles within 0.1%');
const VIEW_NAMES = { histogram: 'histogram', box: 'box plot', ecdf: 'cumulative distribution', qq: 'Q-Q plot' };
const BOX_LABELS = {
    min: 'Minimum',
    q1: 'Q1',
    median: 'Median',
    q3: 'Q3',
    max: 'Maximum',
    iqr: 'IQR',
    lowerFence: 'Lower fence',
    upperFence: 'Upper fence',
    whiskerLow: 'Lower whisker',
    whiskerHigh: 'Upper whisker',
    outliersLow: 'Low outliers',
    outliersHigh: 'High outliers',
};

/* ---------- Numeric ---------- */

const NUMERIC_VIEWS = [
    { value: 'histogram', label: 'Histogram' },
    { value: 'box', label: 'Box plot' },
    { value: 'ecdf', label: 'Cumulative' },
    { value: 'qq', label: 'Q-Q' },
];
const VIEW_INFO = { histogram: GLOSSARY.histogram, box: GLOSSARY.boxplot, ecdf: GLOSSARY.ecdf, qq: GLOSSARY.qq };

function NumericCard({ column, stat, detail, rows }) {
    const [view, setView] = useState('histogram');
    const [bins, setBins] = useState(detail.valueCounts ? 'values' : 'auto');
    const a = approx(stat.exact);

    const binOptions = [
        ...(detail.valueCounts ? [{ value: 'values', label: `Each value (${detail.valueCounts.length})` }] : []),
        { value: 'auto', label: `Auto (${detail.histograms.auto.length} bins)` },
        ...[10, 20, 50, 100].map((n) => ({ value: String(n), label: `≈ ${n} bins` })),
    ];

    const subtitle = `${stat.count.toLocaleString()} values of ${rows.toLocaleString()} rows · ${accuracyNote(stat.exact)}`;
    const getExport = () => {
        const base = { filename: `${column} ${VIEW_NAMES[view]}`, subtitle };
        if (view === 'histogram') {
            if (bins === 'values') {
                return { ...base, title: `${column}: count per value`, rows: detail.valueCounts.map((v) => ({ Value: v.value, Records: v.count, 'Share (%)': (v.count / stat.count) * 100 })) };
            }
            return {
                ...base,
                title: `${column}: histogram`,
                rows: detail.histograms[bins].map((b) => ({ 'Bin start': b.start, 'Bin end': b.end, 'Includes end': !!b.closed, Records: b.count, 'Share (%)': (b.count / stat.count) * 100 })),
            };
        }
        if (view === 'box') {
            const { box } = detail;
            return {
                ...base,
                title: `${column}: box plot`,
                legend: [
                    { label: 'Interquartile range (Q1 to Q3)', color: CHART.soft },
                    { label: 'Median', color: CHART.accent },
                    { label: 'Outlier extremes', color: CHART.warn, shape: 'dot' },
                ],
                rows: Object.entries(box).map(([statistic, value]) => ({ Statistic: BOX_LABELS[statistic] || statistic, Value: value })),
            };
        }
        if (view === 'ecdf') return { ...base, title: `${column}: cumulative distribution`, rows: detail.ecdf.map((p) => ({ Percentile: p.p, Value: p.x })) };
        return { ...base, title: `${column}: normal Q-Q plot`, rows: detail.qq.map((p) => ({ 'Expected if normal': p.theoretical, Actual: p.sample })) };
    };

    return (
        <ChartCard
            eyebrow="Distribution"
            title={column}
            info={VIEW_INFO[view]}
            exact={stat.exact}
            getExport={getExport}
            controls={
                <>
                    <Segmented options={NUMERIC_VIEWS} value={view} onChange={setView} label={`Chart type for ${column}`} />
                    {view === 'histogram' && <SelectPill label="Bins" value={bins} onChange={setBins} options={binOptions} />}
                </>
            }
            footer={
                <dl className="percentiles">
                    {detail.percentiles.map((p) => (
                        <div key={p.p}>
                            <dt>P{p.p}</dt>
                            <dd>
                                {a}
                                {formatNumber(p.value)}
                            </dd>
                        </div>
                    ))}
                </dl>
            }
        >
            <p className="card__sub">
                Mean <strong>{formatNumber(stat.mean)}</strong> · Median <strong>{a}{formatNumber(stat.median)}</strong> · Std <strong>{formatNumber(stat.std)}</strong> · Skew{' '}
                <strong>{formatNumber(stat.skewness)}</strong>
                {stat.outliers > 0 && (
                    <>
                        {' '}
                        · Outliers <strong className="text-warn">{formatPct(stat.outlierPct)}</strong>
                    </>
                )}
            </p>
            {view === 'histogram' &&
                (bins === 'values' ? (
                    <ValueBarsChart valueCounts={detail.valueCounts} column={column} total={stat.count} />
                ) : (
                    <HistogramChart bins={detail.histograms[bins]} column={column} total={stat.count} integer={stat.integer} />
                ))}
            {view === 'box' && <BoxPlotChart box={detail.box} column={column} exact={stat.exact} />}
            {view === 'ecdf' && <EcdfChart points={detail.ecdf} column={column} exact={stat.exact} />}
            {view === 'qq' && <QQChart points={detail.qq} column={column} />}
        </ChartCard>
    );
}

/* ---------- Categorical ---------- */

function CategoryCard({ column, stat, dist }) {
    const canDonut = stat.unique <= 12;
    const [view, setView] = useState('bars');
    const getExport = () => {
        const subtitle = `${stat.count.toLocaleString()} values · ${stat.uniqueExact ? '' : '≈ '}${formatNumber(stat.unique)} categories${stat.countsExact ? '' : ' · counts for rare categories are lower bounds'}`;
        const rows = dist.map((d) => ({ Category: d.name, Records: d.value, 'Share (%)': d.percentage }));
        if (view === 'donut') {
            const slices = donutSlices(dist, stat.otherCount);
            return { filename: `${column} donut`, title: `${column}: share of records`, subtitle, rows, legend: slices.map((s) => ({ label: s.name, value: `${s.percentage.toFixed(1)}%`, color: s.fill, shape: 'dot' })) };
        }
        return { filename: `${column} bars`, title: `${column}: records per category`, subtitle, rows };
    };
    return (
        <ChartCard
            eyebrow={`${stat.uniqueExact ? '' : '≈ '}${formatNumber(stat.unique)} categories`}
            title={column}
            info={view === 'donut' ? GLOSSARY.donut : GLOSSARY.categoryBars}
            getExport={getExport}
            controls={
                canDonut ? (
                    <Segmented
                        options={[
                            { value: 'bars', label: 'Bars' },
                            { value: 'donut', label: 'Donut' },
                        ]}
                        value={view}
                        onChange={setView}
                        label={`Chart type for ${column}`}
                    />
                ) : null
            }
        >
            <p className="card__sub">
                Most common <strong>{stat.mode}</strong> ({formatPct(stat.modePct)}) · Missing {formatPct(stat.missingPct)}
            </p>
            {view === 'donut' ? <CategoryDonut data={dist} column={column} otherCount={stat.otherCount} /> : <CategoryBarsChart data={dist} column={column} otherCount={stat.otherCount} />}
        </ChartCard>
    );
}

/* ---------- Dates ---------- */

function TimelineCard({ column, stat, timeline, measures }) {
    const [granularity, setGranularity] = useState('auto');
    const [measure, setMeasure] = useState('');
    const available = timeline.measures.map((m) => m.column).filter((c) => measures.includes(c));
    const { points, granularity: used } = useMemo(() => aggregateTimeline(timeline, granularity, measure || null), [timeline, granularity, measure]);
    const measureLabel = measure ? `Average ${measure}` : 'Records';

    return (
        <ChartCard
            eyebrow={`${formatDate(stat.min)} to ${formatDate(stat.max)}`}
            title={column}
            info={GLOSSARY.timeline}
            getExport={() => ({
                filename: `${column} timeline by ${used}`,
                title: `${measureLabel} per ${used}: ${column}`,
                subtitle: `${stat.count.toLocaleString()} dated records · ${formatNumber(stat.spanDays)} days`,
                rows: points.map((p) => ({ 'Period start': p.start, Period: p.title, [measure ? `Average ${measure}` : 'Records']: p.value, ...(measure ? { Records: p.n } : {}) })),
            })}
            controls={
                <>
                    <SelectPill
                        label="Per"
                        value={granularity}
                        onChange={setGranularity}
                        options={GRANULARITY_OPTIONS.map((g) => ({ value: g, label: g === 'auto' ? `Auto (${used})` : g[0].toUpperCase() + g.slice(1) }))}
                    />
                    <SelectPill label="Show" value={measure} onChange={setMeasure} options={[{ value: '', label: 'Record count' }, ...available.map((c) => ({ value: c, label: `Average ${c}` }))]} />
                </>
            }
        >
            <p className="card__sub">
                {formatNumber(stat.count)} dated records over {formatNumber(stat.spanDays)} days · Missing {formatPct(stat.missingPct)}
                {stat.invalid > 0 && <> · {formatNumber(stat.invalid)} unreadable dates</>}
            </p>
            <TimelineChart points={points} measureLabel={measureLabel} isCount={!measure} />
        </ChartCard>
    );
}

/* ---------- Tab ---------- */

export default function UnivariateTab({ analysis }) {
    const { stats, numericDetails, categoricalCols, dateCols, categoricalDists, timelines, idCols, meta } = analysis;
    const measures = measureCols(analysis);

    const columns = [
        { key: 'col', label: 'Feature' },
        { key: 'mean', label: 'Mean', numeric: true, info: GLOSSARY.mean, render: (r) => formatNumber(r.mean) },
        { key: 'median', label: 'Median', numeric: true, info: GLOSSARY.median, render: (r) => `${approx(r.exact)}${formatNumber(r.median)}` },
        { key: 'std', label: 'Std dev', numeric: true, info: GLOSSARY.std, render: (r) => formatNumber(r.std) },
        { key: 'skewness', label: 'Skew', numeric: true, info: GLOSSARY.skewness, render: (r) => <span className={Math.abs(r.skewness) > 1 ? 'text-caution' : ''}>{formatNumber(r.skewness)}</span> },
        { key: 'cv', label: 'CV', numeric: true, info: GLOSSARY.cv, render: (r) => <span className={cvTone(r.cv)}>{r.cv == null ? 'n/a' : formatPct(r.cv)}</span> },
        { key: 'min', label: 'Min', numeric: true, info: GLOSSARY.min, render: (r) => formatNumber(r.min) },
        { key: 'max', label: 'Max', numeric: true, info: GLOSSARY.max, render: (r) => formatNumber(r.max) },
        { key: 'outlierPct', label: 'Outliers', numeric: true, info: GLOSSARY.outliers, render: (r) => <span className={r.outlierPct > 1 ? 'text-warn' : 'text-muted'}>{formatPct(r.outlierPct)}</span> },
        { key: 'missingPct', label: 'Missing', numeric: true, info: GLOSSARY.missing, render: (r) => <span className={r.missingPct > 0 ? 'text-warn' : 'text-muted'}>{formatPct(r.missingPct)}</span> },
    ];

    const catCols = categoricalCols.filter((c) => categoricalDists[c]?.length > 0);

    return (
        <div className="stack-xl">
            <section>
                <SectionTitle strong="Numbers" soft="Centre, spread and shape of every numeric column" />
                {measures.length === 0 ? (
                    <EmptyState title="No numeric columns found" />
                ) : (
                    <>
                        <Card>
                            <DataTable columns={columns} rows={measures.map((col) => ({ col, ...stats[col] }))} rowKey={(r) => r.col} />
                        </Card>
                        {!meta.exactStats && (
                            <Callout title="Some quantiles are estimated">
                                {meta.approxColumns.join(', ')} {meta.approxColumns.length > 1 ? 'hold' : 'holds'} too many distinct fractional values to keep in memory at this file size, so medians,
                                percentiles and histograms come from a streaming sketch accurate to ±0.1% (marked ≈). Counts, means, std, skew, min and max are exact.
                            </Callout>
                        )}
                        <div className="grid grid--2">
                            {measures.map((col) => (
                                <NumericCard key={col} column={col} stat={stats[col]} detail={numericDetails[col]} rows={meta.rows} />
                            ))}
                        </div>
                        {idCols.length > 0 && (
                            <Callout title="Identifier columns">
                                {idCols.join(', ')} {idCols.length > 1 ? 'look like IDs' : 'looks like an ID'} (unique whole numbers), so {idCols.length > 1 ? 'they are' : 'it is'} not charted or used in correlations.
                            </Callout>
                        )}
                    </>
                )}
            </section>

            {catCols.length > 0 && (
                <section>
                    <SectionTitle strong="Categories" soft="How records split across each label" />
                    <div className="grid grid--2">
                        {catCols.map((col) => (
                            <CategoryCard key={col} column={col} stat={stats[col]} dist={categoricalDists[col]} />
                        ))}
                    </div>
                </section>
            )}

            {dateCols.length > 0 && (
                <section>
                    <SectionTitle strong="Dates" soft="When your records happened" info={GLOSSARY.dates} />
                    <div className="grid">
                        {dateCols
                            .filter((c) => timelines[c]?.days.length)
                            .map((col) => (
                                <TimelineCard key={col} column={col} stat={stats[col]} timeline={timelines[col]} measures={measures} />
                            ))}
                    </div>
                </section>
            )}
        </div>
    );
}
