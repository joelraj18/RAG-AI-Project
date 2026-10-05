import React, { useMemo, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { ChartCard, Segmented, SelectPill } from '../../components/ChartCard';
import { GroupMeansChart, ScatterTrendChart } from '../../components/charts';
import { CorrelationMatrixChart, GroupBoxPlotChart } from '../../components/svgCharts';
import { Callout, Card, DataTable, EmptyState, SectionTitle } from '../../components/ui';
import { NOTABLE_CORRELATION, STRONG_CORRELATION, approx, correlationBetween, displayName, formatNumber, pairKey } from '../../lib/analysis';
import { guessTarget, measureCols } from '../../lib/blueprints';
import { GLOSSARY } from '../../lib/glossary';
import { CHART, divergingColor } from '../../lib/palette';

const options = (cols) => cols.map((c) => ({ value: c, label: c }));

/* ---------- Correlation ---------- */

export function CorrelationTab({ analysis }) {
    const { correlations, meta } = analysis;
    const cols = measureCols(analysis).filter((c) => correlations.some((p) => p.col1 === c || p.col2 === c));
    if (cols.length < 2) return <EmptyState title="Correlation needs at least two numeric columns that are not IDs" />;
    const top = correlations.filter((c) => Math.abs(c.correlation) > NOTABLE_CORRELATION).slice(0, 8);
    const lookup = (a, b) => correlationBetween(correlations, a, b);

    return (
        <div className="stack-xl">
            <SectionTitle strong="Correlation" soft="Which columns move together" info={GLOSSARY.correlation} />
            <ChartCard
                eyebrow={`Pearson’s r · all ${meta.rows.toLocaleString()} rows`}
                title="Correlation matrix"
                info={GLOSSARY.correlation}
                exact
                getExport={() => ({
                    filename: 'Correlation matrix',
                    title: 'Correlation matrix (Pearson’s r)',
                    subtitle: `${displayName(meta.fileName)} · ${meta.rows.toLocaleString()} rows · each pair uses every row where both have values`,
                    legend: [
                        { label: 'r near minus 1: move in opposite directions', color: divergingColor(-1) },
                        { label: 'r near 0: no linear relation', color: divergingColor(0) },
                        { label: 'r near 1: move together', color: divergingColor(1) },
                    ],
                    rows: cols.map((row) => ({ Column: row, ...Object.fromEntries(cols.map((c) => [c, lookup(row, c)])) })),
                })}
            >
                <CorrelationMatrixChart columns={cols} lookup={lookup} />
            </ChartCard>
            <Card title={`Most related pairs (|r| > ${NOTABLE_CORRELATION})`}>
                {top.length === 0 ? (
                    <p className="text-muted">No pairs above |r| = {NOTABLE_CORRELATION}. Relationships here are weak or not linear.</p>
                ) : (
                    <ul className="pair-list">
                        {top.map((c) => (
                            <li key={`${c.col1}-${c.col2}`}>
                                <span>
                                    <strong>{c.col1}</strong> and <strong>{c.col2}</strong> <span className="text-muted">· {formatNumber(c.n)} rows</span>
                                </span>
                                <span className={`pill ${c.correlation > 0 ? 'pill--pos' : 'pill--neg'}`}>
                                    {c.correlation > 0 ? <TrendingUp aria-hidden="true" /> : <TrendingDown aria-hidden="true" />}
                                    r = {c.correlation.toFixed(3)} · {Math.abs(c.correlation) > STRONG_CORRELATION ? 'strong' : 'moderate'}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
            <Callout title="Correlation is not causation">
                A high r means two columns tend to move together. It doesn’t tell you that one causes the other, because a third factor may drive both. Pearson’s r also only captures straight line
                relationships; check the scatter plot in Bivariate for curves.
            </Callout>
        </div>
    );
}

/* ---------- Bivariate ---------- */

function ScatterSection({ analysis }) {
    const cols = measureCols(analysis);
    const target = guessTarget(analysis);
    const firstPartner = analysis.correlations.find((c) => c.col1 === target || c.col2 === target);
    const [x, setX] = useState(firstPartner ? (firstPartner.col1 === target ? firstPartner.col2 : firstPartner.col1) : cols[0]);
    const [y, setY] = useState(target && target !== x ? target : cols.find((c) => c !== x));

    const { points, fit } = useMemo(() => {
        const xi = analysis.columns.indexOf(x);
        const yi = analysis.columns.indexOf(y);
        const pts = [];
        for (const row of analysis.sample.rows) {
            const vx = row[xi];
            const vy = row[yi];
            if (vx != null && vy != null) pts.push({ x: vx, y: vy });
        }
        const pair = analysis.correlations.find((c) => (c.col1 === x && c.col2 === y) || (c.col1 === y && c.col2 === x));
        let line = null;
        if (pair) {
            line = pair.col1 === x ? { slope: pair.slope, intercept: pair.intercept, r: pair.correlation, n: pair.n } : { slope: pair.slopeReverse, intercept: pair.interceptReverse, r: pair.correlation, n: pair.n };
        }
        return { points: pts, fit: line };
    }, [analysis, x, y]);

    if (cols.length < 2 || !x || !y) return null;
    const sampled = points.length < analysis.meta.rows;

    return (
        <ChartCard
            eyebrow={sampled ? `${points.length.toLocaleString()} sampled rows · trend from all ${analysis.meta.rows.toLocaleString()}` : `${points.length.toLocaleString()} rows`}
            title={`${y} vs ${x}`}
            info={GLOSSARY.scatter}
            controls={
                <>
                    <SelectPill label="X" value={x} onChange={setX} options={options(cols.filter((c) => c !== y))} />
                    <SelectPill label="Y" value={y} onChange={setY} options={options(cols.filter((c) => c !== x))} />
                </>
            }
            getExport={() => ({
                filename: `${y} vs ${x} scatter`,
                title: `${y} vs ${x}`,
                subtitle: `${sampled ? `${points.length.toLocaleString()} randomly sampled rows; ` : ''}least squares line fitted on all ${analysis.meta.rows.toLocaleString()} rows${fit ? ` · r = ${fit.r.toFixed(3)}` : ''}`,
                legend: [
                    { label: sampled ? 'Sampled rows' : 'Rows', color: CHART.primary, shape: 'dot' },
                    { label: 'Trend (all rows)', color: CHART.accent },
                ],
                rows: points.map((p) => ({ [x]: p.x, [y]: p.y })),
            })}
        >
            {fit && Number.isFinite(fit.slope) && (
                <p className="card__sub">
                    r = <strong>{fit.r.toFixed(3)}</strong> · Trend: {y} ≈ <strong>{formatNumber(fit.intercept, 4)}</strong> {fit.slope < 0 ? 'minus' : 'plus'} <strong>{formatNumber(Math.abs(fit.slope), 4)}</strong> × {x}
                </p>
            )}
            <div className="chart-legend" aria-hidden="true">
                <span>
                    <i className="key key--dot key--light" /> {sampled ? 'Sampled rows' : 'Rows'}
                </span>
                <span>
                    <i className="key key--line" /> Trend (all rows)
                </span>
            </div>
            <ScatterTrendChart points={points} xCol={x} yCol={y} fit={fit} />
        </ChartCard>
    );
}

export function BivariateTab({ analysis }) {
    const { chartableCatCols, bivariate } = analysis;
    const nums = measureCols(analysis).filter((c) => chartableCatCols.some((cat) => bivariate[pairKey(cat, c)]));
    const [catCol, setCatCol] = useState(chartableCatCols[0]);
    const [numCol, setNumCol] = useState(() => {
        const target = guessTarget(analysis);
        return nums.includes(target) ? target : nums[0];
    });
    const [view, setView] = useState('means');

    const data = (catCol && numCol && bivariate[pairKey(catCol, numCol)]) || [];
    const exact = data.every((g) => g.exact);
    const columns = [
        { key: 'category', label: catCol },
        { key: 'count', label: 'Records', numeric: true, render: (r) => r.count.toLocaleString() },
        { key: 'mean', label: 'Mean', numeric: true, info: GLOSSARY.mean, render: (r) => formatNumber(r.mean) },
        { key: 'median', label: 'Median', numeric: true, info: GLOSSARY.median, render: (r) => `${approx(r.exact)}${formatNumber(r.median)}` },
        { key: 'q1', label: 'Q1', numeric: true, render: (r) => `${approx(r.exact)}${formatNumber(r.q1)}` },
        { key: 'q3', label: 'Q3', numeric: true, render: (r) => `${approx(r.exact)}${formatNumber(r.q3)}` },
        { key: 'std', label: 'Std dev', numeric: true, info: GLOSSARY.std, render: (r) => formatNumber(r.std) },
        { key: 'min', label: 'Min', numeric: true, render: (r) => formatNumber(r.min) },
        { key: 'max', label: 'Max', numeric: true, render: (r) => formatNumber(r.max) },
    ];

    return (
        <div className="stack-xl">
            <SectionTitle strong="Compare groups" soft="See how a category shifts a number" info={GLOSSARY.bivariate} />
            {!chartableCatCols.length || !nums.length ? (
                <EmptyState title="Group comparisons need a numeric column and a categorical column with 2 to 14 values" />
            ) : (
                <>
                    <div className="filters">
                        <SelectPill label="Group by" value={catCol} onChange={setCatCol} options={options(chartableCatCols)} />
                        <SelectPill label="Measure" value={numCol} onChange={setNumCol} options={options(nums)} />
                    </div>
                    <ChartCard
                        eyebrow={`${numCol} by ${catCol}`}
                        title={view === 'means' ? 'Mean and median per group' : 'Box plot per group'}
                        info={view === 'means' ? GLOSSARY.bivariate : GLOSSARY.groupBox}
                        exact={exact}
                        controls={
                            <Segmented
                                options={[
                                    { value: 'means', label: 'Mean & median' },
                                    { value: 'box', label: 'Box plots' },
                                ]}
                                value={view}
                                onChange={setView}
                                label="Group chart type"
                            />
                        }
                        getExport={() => ({
                            filename: `${numCol} by ${catCol} ${view === 'means' ? 'means' : 'box plots'}`,
                            title: `${numCol} by ${catCol}`,
                            subtitle: `${view === 'means' ? 'Mean (bars) and median (dots)' : 'Box plots: IQR, median, whiskers at 1.5 × IQR'} · all ${analysis.meta.rows.toLocaleString()} rows${exact ? '' : ' · medians within 0.5%'}`,
                            legend:
                                view === 'means'
                                    ? [
                                          { label: 'Mean', color: CHART.primary },
                                          { label: 'Median', color: CHART.accent, shape: 'dot' },
                                      ]
                                    : [
                                          { label: 'Q1 to Q3', color: CHART.soft },
                                          { label: 'Median', color: CHART.accent },
                                          { label: 'Outlier extremes', color: CHART.warn, shape: 'dot' },
                                      ],
                            rows: data.map(({ category, count, mean, median, q1, q3, std, min, max, whiskerLow, whiskerHigh, outliers }) => ({ [catCol]: category, Records: count, Mean: mean, Median: median, Q1: q1, Q3: q3, 'Std dev': std, Min: min, Max: max, 'Lower whisker': whiskerLow, 'Upper whisker': whiskerHigh, Outliers: outliers })),
                        })}
                        minHeight={340}
                    >
                        {view === 'means' ? (
                            <>
                                <div className="chart-legend" aria-hidden="true">
                                    <span>
                                        <i className="key key--bar" /> Mean
                                    </span>
                                    <span>
                                        <i className="key key--dot" /> Median
                                    </span>
                                </div>
                                <GroupMeansChart data={data} catCol={catCol} numCol={numCol} />
                            </>
                        ) : (
                            <GroupBoxPlotChart groups={data} catCol={catCol} numCol={numCol} />
                        )}
                    </ChartCard>
                    <Card title="Group table">
                        <DataTable columns={columns} rows={data} rowKey={(r) => r.category} />
                    </Card>
                </>
            )}

            <SectionTitle strong="Scatter" soft="Two numbers, side by side" info={GLOSSARY.scatter} />
            <ScatterSection analysis={analysis} />
        </div>
    );
}
