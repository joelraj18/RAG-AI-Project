// Hand-drawn SVG charts (box plots, correlation matrix). Colours are attributes, not CSS,
// so exported images look exactly like the screen.

import React, { useEffect, useRef, useState } from 'react';
import { formatCompact, formatNumber } from '../lib/analysis';
import { CHART, divergingColor, divergingInk } from '../lib/palette';

/** Width of a container, tracked with ResizeObserver (falls back to a default in tests). */
function useWidth(fallback = 640) {
    const ref = useRef(null);
    const [width, setWidth] = useState(fallback);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, width];
}

/** Round tick values covering [lo, hi]. */
export function niceTicks(lo, hi, count = 6) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].find((s) => raw / mag <= s) * mag;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
}

const TEXT = { fontSize: 11, fill: CHART.axis };

/* ---------- One horizontal box plot ---------- */

/** Box-plot labels: full precision, but compact for very large magnitudes so labels don't collide. */
const boxLabel = (v) => (Math.abs(v) >= 1e7 ? Intl.NumberFormat(undefined, { notation: 'compact', maximumSignificantDigits: 4 }).format(v) : formatNumber(v));

export function BoxPlotChart({ box, column, exact }) {
    const [ref, width] = useWidth();
    const height = 190;
    if (box.min === box.max) {
        return (
            <div ref={ref} className="chart" style={{ height }}>
                <svg width={width} height={height} role="img" aria-label={`Every value of ${column} is ${formatNumber(box.min)}`}>
                    <line x1={24} x2={width - 24} y1={116} y2={116} stroke={CHART.grid} />
                    <circle cx={width / 2} cy={76} r={7} fill={CHART.accent} />
                    <text x={width / 2} y={50} textAnchor="middle" fontSize={13} fontWeight={600} fill={CHART.text}>
                        {`All values = ${formatNumber(box.min)}`}
                    </text>
                    <text x={width / 2} y={140} textAnchor="middle" {...TEXT}>
                        {`${column} has no spread, so there is no box to draw`}
                    </text>
                </svg>
            </div>
        );
    }
    const m = { left: 24, right: 24, top: 36, bottom: 44 };
    const lo = box.min;
    const hi = box.max;
    const span = hi - lo || 1;
    const x = (v) => m.left + ((v - lo) / span) * (width - m.left - m.right);
    const cy = m.top + 40;
    const ticks = niceTicks(lo, hi, Math.max(3, Math.floor(width / 110)));
    const a = exact ? '' : '≈ ';
    const labels = [
        ['Q1', box.q1],
        ['Median', box.median],
        ['Q3', box.q3],
    ];

    return (
        <div ref={ref} className="chart" style={{ height }}>
            <svg width={width} height={height} role="img" aria-label={`Box plot of ${column}`}>
                <title>{`Box plot of ${column}: Q1 ${a}${formatNumber(box.q1)}, median ${a}${formatNumber(box.median)}, Q3 ${a}${formatNumber(box.q3)}`}</title>
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={x(t)} x2={x(t)} y1={m.top} y2={height - m.bottom} stroke={CHART.grid} />
                        <text x={x(t)} y={height - m.bottom + 16} textAnchor="middle" {...TEXT}>
                            {formatCompact(t)}
                        </text>
                    </g>
                ))}
                <text x={width / 2} y={height - 6} textAnchor="middle" {...TEXT}>
                    {column}
                </text>
                {/* Whiskers */}
                <line x1={x(box.whiskerLow)} x2={x(box.q1)} y1={cy} y2={cy} stroke={CHART.accent} strokeWidth={1.5} />
                <line x1={x(box.q3)} x2={x(box.whiskerHigh)} y1={cy} y2={cy} stroke={CHART.accent} strokeWidth={1.5} />
                <line x1={x(box.whiskerLow)} x2={x(box.whiskerLow)} y1={cy - 12} y2={cy + 12} stroke={CHART.accent} strokeWidth={1.5} />
                <line x1={x(box.whiskerHigh)} x2={x(box.whiskerHigh)} y1={cy - 12} y2={cy + 12} stroke={CHART.accent} strokeWidth={1.5} />
                {/* Box and median */}
                <rect x={x(box.q1)} y={cy - 24} width={Math.max(1, x(box.q3) - x(box.q1))} height={48} rx={6} fill={CHART.soft} stroke={CHART.primary} strokeWidth={1.5} />
                <line x1={x(box.median)} x2={x(box.median)} y1={cy - 24} y2={cy + 24} stroke={CHART.accent} strokeWidth={3} />
                {/* Extremes beyond the whiskers stand in for the outliers */}
                {box.outliersLow > 0 && <circle cx={x(box.min)} cy={cy} r={4} fill="#ffffff" stroke={CHART.warn} strokeWidth={2} />}
                {box.outliersHigh > 0 && <circle cx={x(box.max)} cy={cy} r={4} fill="#ffffff" stroke={CHART.warn} strokeWidth={2} />}
                {box.outliersLow > 0 && (
                    <text x={x(box.min)} y={cy + 40} textAnchor="start" {...TEXT} fill={CHART.warn}>
                        {formatNumber(box.outliersLow)} low outliers
                    </text>
                )}
                {box.outliersHigh > 0 && (
                    <text x={x(box.max)} y={cy + 40} textAnchor="end" {...TEXT} fill={CHART.warn}>
                        {formatNumber(box.outliersHigh)} high outliers
                    </text>
                )}
                {labels.map(([name, v], i) => (
                    <text key={name} x={x(v)} y={cy - 32} textAnchor={i === 0 ? 'end' : i === 2 ? 'start' : 'middle'} fontSize={11} fill={CHART.text} fontWeight={i === 1 ? 600 : 400}>
                        {`${name} ${a}${boxLabel(v)}`}
                    </text>
                ))}
            </svg>
        </div>
    );
}

/* ---------- Box plot per group (vertical) ---------- */

export function GroupBoxPlotChart({ groups, catCol, numCol }) {
    const [ref, width] = useWidth();
    const height = 340;
    const m = { left: 64, right: 16, top: 16, bottom: groups.length > 5 ? 64 : 40 };
    const lo = Math.min(...groups.map((g) => g.min));
    const hi = Math.max(...groups.map((g) => g.max));
    const ticks = niceTicks(lo, hi, 6);
    const yLo = Math.min(lo, ticks[0]);
    const yHi = Math.max(hi, ticks[ticks.length - 1]);
    const y = (v) => height - m.bottom - ((v - yLo) / (yHi - yLo || 1)) * (height - m.top - m.bottom);
    const band = (width - m.left - m.right) / Math.max(1, groups.length);
    const boxW = Math.min(64, band * 0.5);
    const rotate = groups.length > 5;

    return (
        <div ref={ref} className="chart" style={{ height }}>
            <svg width={width} height={height} role="img" aria-label={`Box plots of ${numCol} by ${catCol}`}>
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={CHART.grid} />
                        <text x={m.left - 8} y={y(t) + 4} textAnchor="end" {...TEXT}>
                            {formatCompact(t)}
                        </text>
                    </g>
                ))}
                <text transform={`translate(14 ${(height - m.bottom + m.top) / 2}) rotate(-90)`} textAnchor="middle" {...TEXT}>
                    {numCol}
                </text>
                {groups.map((g, i) => {
                    const cx = m.left + band * i + band / 2;
                    const label = g.category.length > 14 ? `${g.category.slice(0, 13)}…` : g.category;
                    return (
                        <g key={g.category}>
                            <title>{`${catCol} = ${g.category}\nRecords ${formatNumber(g.count)}\nMedian ${g.exact ? '' : '≈ '}${formatNumber(g.median)}\nQ1 ${formatNumber(g.q1)} · Q3 ${formatNumber(g.q3)}\nOutliers ${formatNumber(g.outliers)}`}</title>
                            <line x1={cx} x2={cx} y1={y(g.whiskerHigh)} y2={y(g.q3)} stroke={CHART.accent} strokeWidth={1.5} />
                            <line x1={cx} x2={cx} y1={y(g.q1)} y2={y(g.whiskerLow)} stroke={CHART.accent} strokeWidth={1.5} />
                            <line x1={cx - boxW / 4} x2={cx + boxW / 4} y1={y(g.whiskerHigh)} y2={y(g.whiskerHigh)} stroke={CHART.accent} strokeWidth={1.5} />
                            <line x1={cx - boxW / 4} x2={cx + boxW / 4} y1={y(g.whiskerLow)} y2={y(g.whiskerLow)} stroke={CHART.accent} strokeWidth={1.5} />
                            <rect x={cx - boxW / 2} y={y(g.q3)} width={boxW} height={Math.max(1, y(g.q1) - y(g.q3))} rx={5} fill={CHART.soft} stroke={CHART.primary} strokeWidth={1.5} />
                            <line x1={cx - boxW / 2} x2={cx + boxW / 2} y1={y(g.median)} y2={y(g.median)} stroke={CHART.accent} strokeWidth={3} />
                            {g.max > g.whiskerHigh && <circle cx={cx} cy={y(g.max)} r={3.5} fill="#ffffff" stroke={CHART.warn} strokeWidth={1.8} />}
                            {g.min < g.whiskerLow && <circle cx={cx} cy={y(g.min)} r={3.5} fill="#ffffff" stroke={CHART.warn} strokeWidth={1.8} />}
                            <text
                                x={cx}
                                y={height - m.bottom + 16}
                                textAnchor={rotate ? 'end' : 'middle'}
                                transform={rotate ? `rotate(-30 ${cx} ${height - m.bottom + 16})` : undefined}
                                {...TEXT}
                            >
                                {label}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

/* ---------- Correlation matrix ---------- */

export function CorrelationMatrixChart({ columns, lookup }) {
    const [ref, width] = useWidth();
    const label = (c) => (c.length > 16 ? `${c.slice(0, 15)}…` : c);
    const left = 12 + Math.min(16, Math.max(...columns.map((c) => c.length))) * 6.4;
    const top = left;
    const cell = Math.max(30, Math.min(64, Math.floor((width - left - 8) / columns.length)));
    const size = left + cell * columns.length + 8;
    const legendY = top + cell * columns.length + 28;
    const height = legendY + 34;

    return (
        <div ref={ref} className="chart matrix-wrap">
            <svg width={Math.max(size, 300)} height={height} role="img" aria-label="Correlation matrix">
                {columns.map((c, i) => (
                    <g key={c}>
                        <text x={left - 8} y={top + cell * i + cell / 2 + 4} textAnchor="end" {...TEXT}>
                            {label(c)}
                        </text>
                        <text transform={`translate(${left + cell * i + cell / 2 + 4} ${top - 8}) rotate(-60)`} textAnchor="start" {...TEXT}>
                            {label(c)}
                        </text>
                    </g>
                ))}
                {columns.map((row, i) =>
                    columns.map((col, j) => {
                        const r = lookup(row, col);
                        return (
                            <g key={`${row}-${col}`}>
                                <title>{`${row} × ${col}: r = ${r.toFixed(3)}`}</title>
                                <rect x={left + cell * j + 1.5} y={top + cell * i + 1.5} width={cell - 3} height={cell - 3} rx={6} fill={divergingColor(r)} />
                                {cell >= 34 && (
                                    <text x={left + cell * j + cell / 2} y={top + cell * i + cell / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={i === j ? 700 : 500} fill={divergingInk(r)}>
                                        {Math.abs(r) < 0.005 ? '0.00' : r.toFixed(2)}
                                    </text>
                                )}
                            </g>
                        );
                    }),
                )}
                <defs>
                    <linearGradient id="corr-scale">
                        <stop offset="0%" stopColor={divergingColor(-1)} />
                        <stop offset="50%" stopColor={divergingColor(0)} />
                        <stop offset="100%" stopColor={divergingColor(1)} />
                    </linearGradient>
                </defs>
                <text x={left} y={legendY + 4} textAnchor="end" {...TEXT}>
                    −1
                </text>
                <rect x={left + 6} y={legendY - 5} width={180} height={10} rx={5} fill="url(#corr-scale)" />
                <text x={left + 192} y={legendY + 4} {...TEXT}>
                    +1
                </text>
                <text x={left + 6} y={legendY + 24} {...TEXT}>
                    move apart · no relation · move together
                </text>
            </svg>
        </div>
    );
}
