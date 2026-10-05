// Recharts-based charts. Every chart has labelled axes, exact values in its tooltip, and a
// single value axis. Hover layers are tagged so image exports leave them out.

import React from 'react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    LabelList,
    Line,
    LineChart,
    Pie,
    PieChart,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { formatCompact, formatNumber, formatPct } from '../lib/analysis';
import { CATEGORICAL, CHART, OTHER_COLOR } from '../lib/palette';
import { niceTicks } from './svgCharts';

const AXIS = {
    stroke: CHART.axis,
    tick: { fill: CHART.axis, fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: CHART.grid },
};
const AXIS_LABEL = { fill: CHART.axis, fontSize: 11 };
const CURSOR = { fill: 'rgba(95,127,69,0.08)' };
const truncate = (s, n = 14) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function TooltipCard({ title, rows }) {
    return (
        <div className="chart-tooltip">
            <p className="chart-tooltip__title">{title}</p>
            {rows.map(([label, value, color]) => (
                <p key={label} className="chart-tooltip__row">
                    {color && <span className="chart-tooltip__swatch" style={{ background: color }} />}
                    {label}
                    <strong>{value}</strong>
                </p>
            ))}
        </div>
    );
}

/* ---------- Univariate: numeric ---------- */

export function HistogramChart({ bins, column, total, integer }) {
    const data = bins.map((b) => ({ ...b, pct: total ? (b.count / total) * 100 : 0 }));
    return (
        <div className="chart chart--md" role="img" aria-label={`Histogram of ${column}`}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 44, left: 4, bottom: 18 }} barCategoryGap={1}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} label={{ value: column, position: 'insideBottom', offset: -12, ...AXIS_LABEL }} />
                    <YAxis {...AXIS} axisLine={false} allowDecimals={false} width={56} tickFormatter={formatCompact} label={{ value: 'Records', angle: -90, position: 'insideLeft', offset: 8, ...AXIS_LABEL }} />
                    <Tooltip
                        cursor={CURSOR}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const b = payload[0].payload;
                            const range = integer
                                ? b.label
                                : `${formatNumber(b.start, 6)} ≤ x ${b.closed ? '≤' : '<'} ${formatNumber(b.end, 6)}`;
                            return <TooltipCard title={range} rows={[['Records', formatNumber(b.count)], ['Share', formatPct(b.pct, 2)]]} />;
                        }}
                    />
                    <Bar dataKey="count" fill={CHART.primary} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

export function ValueBarsChart({ valueCounts, column, total }) {
    const data = valueCounts.map((v) => ({ label: formatNumber(v.value, 6), count: v.count, pct: total ? (v.count / total) * 100 : 0 }));
    return (
        <div className="chart chart--md" role="img" aria-label={`Count of each value of ${column}`}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 18, right: 8, left: 4, bottom: 18 }} barCategoryGap="18%">
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" {...AXIS} interval={data.length > 16 ? 'preserveStartEnd' : 0} label={{ value: column, position: 'insideBottom', offset: -12, ...AXIS_LABEL }} />
                    <YAxis {...AXIS} axisLine={false} allowDecimals={false} width={56} tickFormatter={formatCompact} label={{ value: 'Records', angle: -90, position: 'insideLeft', offset: 8, ...AXIS_LABEL }} />
                    <Tooltip cursor={CURSOR} content={({ active, payload }) => (active && payload?.length ? <TooltipCard title={`${column} = ${payload[0].payload.label}`} rows={[['Records', formatNumber(payload[0].payload.count)], ['Share', formatPct(payload[0].payload.pct, 2)]]} /> : null)} />
                    <Bar dataKey="count" fill={CHART.primary} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {data.length <= 12 && <LabelList dataKey="pct" position="top" formatter={(v) => formatPct(v, 0)} style={{ fill: CHART.axis, fontSize: 11 }} />}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

export function EcdfChart({ points, column, exact }) {
    return (
        <div className="chart chart--md" role="img" aria-label={`Cumulative distribution of ${column}`}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
                    <CartesianGrid stroke={CHART.grid} />
                    <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} {...AXIS} tickFormatter={formatCompact} label={{ value: column, position: 'insideBottom', offset: -12, ...AXIS_LABEL }} />
                    <YAxis dataKey="p" type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} axisLine={false} width={56} tickFormatter={(v) => `${v}%`} label={{ value: 'Records at or below', angle: -90, position: 'insideLeft', offset: 8, ...AXIS_LABEL }} />
                    <ReferenceLine y={50} stroke={CHART.grid} strokeDasharray="4 4" />
                    <ReferenceLine y={90} stroke={CHART.grid} strokeDasharray="4 4" />
                    <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipCard title={`P${payload[0].payload.p}`} rows={[[`${payload[0].payload.p}% of records ≤`, `${exact ? '' : '≈ '}${formatNumber(payload[0].payload.x)}`]]} /> : null)} />
                    <Line dataKey="p" type="linear" stroke={CHART.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function roundDomain(lo, hi) {
    const span = hi - lo || Math.abs(hi) || 1;
    const step = 10 ** Math.floor(Math.log10(span / 4));
    const nice = [1, 2, 2.5, 5, 10].find((s) => span / (s * step) <= 5) * step;
    return [Math.floor(lo / nice) * nice, Math.ceil(hi / nice) * nice];
}

const smallDot = (fill, opacity) => (props) => <circle cx={props.cx} cy={props.cy} r={2.6} fill={fill} fillOpacity={opacity} />;

export function QQChart({ points, column }) {
    const [lo, hi] = roundDomain(Math.min(points[0].theoretical, points[0].sample), Math.max(points[points.length - 1].theoretical, points[points.length - 1].sample));
    const ticks = niceTicks(lo, hi, 5);
    return (
        <div className="chart chart--md" role="img" aria-label={`Normal Q-Q plot of ${column}`}>
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
                    <CartesianGrid stroke={CHART.grid} />
                    <XAxis dataKey="theoretical" type="number" domain={[lo, hi]} ticks={ticks} {...AXIS} tickFormatter={formatCompact} label={{ value: 'Expected if normal', position: 'insideBottom', offset: -12, ...AXIS_LABEL }} />
                    <YAxis dataKey="sample" type="number" domain={[lo, hi]} ticks={ticks} {...AXIS} axisLine={false} width={56} tickFormatter={formatCompact} label={{ value: `Actual ${truncate(column, 18)}`, angle: -90, position: 'insideLeft', offset: 8, ...AXIS_LABEL }} />
                    <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke={CHART.axis} strokeDasharray="5 4" ifOverflow="extendDomain" />
                    <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipCard title="Quantile" rows={[['Expected', formatNumber(payload[0].payload.theoretical)], ['Actual', formatNumber(payload[0].payload.sample)]]} /> : null)} />
                    <Scatter data={points} fill={CHART.primary} shape={smallDot(CHART.primary, 0.9)} isAnimationActive={false} />
                </ScatterChart>
            </ResponsiveContainer>
        </div>
    );
}

/* ---------- Univariate: categorical ---------- */

const MAX_SLICES = 7;
const MAX_BARS = 15;

/** Folds the long tail into a single "Other" item so colors are never cycled. */
export function foldCategories(data, keep, otherExtra = 0) {
    const head = data.slice(0, keep);
    const tail = data.slice(keep);
    const value = tail.reduce((a, d) => a + d.value, 0) + otherExtra;
    if (!value) return head;
    const total = data.reduce((a, d) => a + d.value, 0) + otherExtra;
    const share = head.length ? head[0].value / head[0].percentage : total / 100;
    return [...head, { name: `Other (${tail.length || 'more'})`, value, percentage: value / share, other: true }];
}

export function CategoryBarsChart({ data, column, otherCount }) {
    const rows = foldCategories(data, MAX_BARS, otherCount).map((d) => ({ ...d, label: truncate(d.name, 18) }));
    const height = Math.max(160, rows.length * 30 + 40);
    return (
        <div className="chart" style={{ height }} role="img" aria-label={`Records per category of ${column}`}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 4 }} barCategoryGap="22%">
                    <CartesianGrid horizontal={false} stroke={CHART.grid} />
                    <XAxis type="number" {...AXIS} tickFormatter={formatCompact} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" {...AXIS} axisLine={false} width={120} interval={0} />
                    <Tooltip cursor={CURSOR} content={({ active, payload }) => (active && payload?.length ? <TooltipCard title={payload[0].payload.name} rows={[['Records', formatNumber(payload[0].payload.value)], ['Share', formatPct(payload[0].payload.percentage, 2)]]} /> : null)} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                        {rows.map((r) => (
                            <Cell key={r.name} fill={r.other ? OTHER_COLOR : CHART.primary} />
                        ))}
                        <LabelList dataKey="percentage" position="right" formatter={(v) => formatPct(v)} style={{ fill: CHART.text, fontSize: 11 }} />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

export function donutSlices(data, otherCount) {
    return foldCategories(data, MAX_SLICES, otherCount).map((d, i) => ({ ...d, fill: d.other ? OTHER_COLOR : CATEGORICAL[i] }));
}

export function CategoryDonut({ data, column, otherCount }) {
    const slices = donutSlices(data, otherCount);
    return (
        <div className="donut">
            <div className="chart chart--donut" role="img" aria-label={`Category share for ${column}`}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={slices.length > 1 ? 1.5 : 0} stroke="#ffffff" strokeWidth={2} isAnimationActive={false}>
                            {slices.map((s) => (
                                <Cell key={s.name} fill={s.fill} />
                            ))}
                        </Pie>
                        <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipCard title={payload[0].name} rows={[['Records', formatNumber(payload[0].value)], ['Share', formatPct(payload[0].payload.percentage, 2)]]} /> : null)} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <ul className="legend" aria-label={`${column} categories`}>
                {slices.map((s) => (
                    <li key={s.name}>
                        <span className="legend__swatch" style={{ background: s.fill }} />
                        <span className="legend__name" title={s.name}>
                            {s.name}
                        </span>
                        <span className="legend__value">{s.percentage.toFixed(1)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/* ---------- Dates ---------- */

export function TimelineChart({ points, measureLabel, isCount }) {
    const ChartType = isCount ? AreaChart : LineChart;
    return (
        <div className="chart chart--md" role="img" aria-label={`${measureLabel} over time`}>
            <ResponsiveContainer width="100%" height="100%">
                <ChartType data={points} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={32} />
                    <YAxis {...AXIS} axisLine={false} width={56} tickFormatter={formatCompact} label={{ value: measureLabel, angle: -90, position: 'insideLeft', offset: 8, ...AXIS_LABEL }} />
                    <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipCard title={payload[0].payload.title} rows={[[measureLabel, formatNumber(payload[0].payload.value)], ...(isCount ? [] : [['Records', formatNumber(payload[0].payload.n)]])]} /> : null)} />
                    {isCount ? (
                        <Area dataKey="value" type="linear" stroke={CHART.primary} strokeWidth={2} fill={CHART.primary} fillOpacity={0.18} isAnimationActive={false} />
                    ) : (
                        <Line dataKey="value" type="linear" stroke={CHART.primary} strokeWidth={2} dot={points.length <= 40 ? { r: 3, fill: CHART.primary } : false} connectNulls isAnimationActive={false} />
                    )}
                </ChartType>
            </ResponsiveContainer>
        </div>
    );
}

/* ---------- Bivariate ---------- */

/** Mean per category (bars) with the median overlaid (dots), on one shared axis. */
export function GroupMeansChart({ data, catCol, numCol }) {
    const rows = data.map((d) => ({ ...d, label: truncate(d.category) }));
    const rotate = rows.length > 5;
    return (
        <div className="chart chart--lg" role="img" aria-label={`Mean and median of ${numCol} by ${catCol}`}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: rotate ? 8 : 18 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" {...AXIS} interval={0} angle={rotate ? -30 : 0} textAnchor={rotate ? 'end' : 'middle'} height={rotate ? 56 : 30} label={rotate ? undefined : { value: catCol, position: 'insideBottom', offset: -12, ...AXIS_LABEL }} />
                    <YAxis {...AXIS} axisLine={false} width={60} tickFormatter={formatCompact} label={{ value: numCol, angle: -90, position: 'insideLeft', offset: 8, ...AXIS_LABEL }} />
                    <Tooltip
                        cursor={CURSOR}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const g = payload[0].payload;
                            return (
                                <TooltipCard
                                    title={`${catCol}: ${g.category}`}
                                    rows={[['Records', formatNumber(g.count)], ['Mean', formatNumber(g.mean), CHART.primary], [`Median${g.exact ? '' : ' (≈)'}`, formatNumber(g.median), CHART.accent], ['Std dev', formatNumber(g.std)]]}
                                />
                            );
                        }}
                    />
                    <Bar dataKey="mean" name="Mean" fill={CHART.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Line dataKey="median" name="Median" stroke="transparent" dot={{ r: 5, fill: CHART.accent, stroke: '#ffffff', strokeWidth: 2 }} activeDot={{ r: 6, fill: CHART.accent, stroke: '#ffffff', strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

/** Sampled points plus the least-squares line fitted on every row. */
export function ScatterTrendChart({ points, xCol, yCol, fit }) {
    let line = null;
    if (fit && Number.isFinite(fit.slope) && points.length) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of points) {
            if (p.x < lo) lo = p.x;
            if (p.x > hi) hi = p.x;
        }
        line = [
            { x: lo, y: fit.intercept + fit.slope * lo },
            { x: hi, y: fit.intercept + fit.slope * hi },
        ];
    }
    return (
        <div className="chart chart--lg" role="img" aria-label={`${yCol} against ${xCol}`}>
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
                    <CartesianGrid stroke={CHART.grid} />
                    <XAxis dataKey="x" type="number" domain={['auto', 'auto']} {...AXIS} tickFormatter={formatCompact} label={{ value: xCol, position: 'insideBottom', offset: -12, ...AXIS_LABEL }} />
                    <YAxis dataKey="y" type="number" domain={['auto', 'auto']} {...AXIS} axisLine={false} width={60} tickFormatter={formatCompact} label={{ value: yCol, angle: -90, position: 'insideLeft', offset: 8, ...AXIS_LABEL }} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => (active && payload?.length ? <TooltipCard title="Sampled row" rows={[[xCol, formatNumber(payload[0].payload.x)], [yCol, formatNumber(payload[0].payload.y)]]} /> : null)} />
                    <Scatter data={points} fill={CHART.primary} shape={smallDot(CHART.primary, 0.3)} isAnimationActive={false} />
                    {line && <ReferenceLine segment={line} stroke={CHART.accent} strokeWidth={2.5} ifOverflow="hidden" />}
                </ScatterChart>
            </ResponsiveContainer>
        </div>
    );
}

/* ---------- Data quality ---------- */

export function MissingChart({ rows }) {
    const data = rows.map((r) => ({ ...r, label: truncate(r.col, 18) }));
    const height = Math.max(140, data.length * 28 + 40);
    return (
        <div className="chart" style={{ height }} role="img" aria-label="Missing values per column">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 4 }} barCategoryGap="22%">
                    <CartesianGrid horizontal={false} stroke={CHART.grid} />
                    <XAxis type="number" domain={[0, (max) => Math.min(100, Math.max(5, Math.ceil(max)))]} {...AXIS} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="label" {...AXIS} axisLine={false} width={120} interval={0} />
                    <Tooltip cursor={CURSOR} content={({ active, payload }) => (active && payload?.length ? <TooltipCard title={payload[0].payload.col} rows={[['Unusable cells', formatNumber(payload[0].payload.rows)], ['Share of rows', formatPct(payload[0].payload.pct, 2)]]} /> : null)} />
                    <Bar dataKey="pct" fill={CHART.warn} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                        <LabelList dataKey="pct" position="right" formatter={(v) => formatPct(v)} style={{ fill: CHART.text, fontSize: 11 }} />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
