import React from 'react';
import { CalendarDays, Hash, Type } from 'lucide-react';
import { Callout, Card, SectionTitle } from '../../components/ui';
import { approx, formatBytes, formatDate, formatDuration, formatNumber, formatPct } from '../../lib/analysis';
import { GLOSSARY } from '../../lib/glossary';

const TYPE_ICON = { numeric: Hash, categorical: Type, date: CalendarDays };
const TYPE_LABEL = { numeric: 'Number', categorical: 'Text', date: 'Date' };

function summary(stat) {
    if (stat.type === 'numeric') {
        if (stat.empty) return 'No numeric values';
        return `${formatNumber(stat.min)} to ${formatNumber(stat.max)} · mean ${formatNumber(stat.mean)} · median ${approx(stat.exact)}${formatNumber(stat.median)}`;
    }
    if (stat.type === 'date') return stat.min ? `${formatDate(stat.min)} to ${formatDate(stat.max)}` : 'No readable dates';
    return `Most common: ${stat.mode} (${formatPct(stat.modePct)})`;
}

export default function OverviewTab({ analysis }) {
    const { columns, kinds, stats, preview, meta, idCols } = analysis;
    const rows = meta.rows;

    return (
        <div className="stack-xl">
            <section>
                <SectionTitle strong="Overview" soft="What’s in this file" />
                <div className="facts-grid">
                    <div>
                        <p className="eyebrow">File</p>
                        <p className="facts-grid__value" title={meta.fileName}>
                            {meta.fileName}
                        </p>
                        <p className="text-muted">
                            {formatBytes(meta.fileSize)} · delimiter “{meta.delimiter === '\t' ? 'tab' : meta.delimiter}”
                        </p>
                    </div>
                    <div>
                        <p className="eyebrow">Analysis</p>
                        <p className="facts-grid__value">Every row · {formatDuration(meta.elapsedMs)}</p>
                        <p className="text-muted">
                            {meta.workers} CPU {meta.workers === 1 ? 'core' : 'cores'} · {meta.mode === 'exact' ? 'all values held in memory' : 'streaming'}
                        </p>
                    </div>
                    <div>
                        <p className="eyebrow">Accuracy</p>
                        <p className="facts-grid__value">{meta.exactStats ? 'Exact statistics' : 'Exact, quantiles ±0.1%'}</p>
                        <p className="text-muted">{meta.exactStats ? 'Matches pandas to full floating point precision' : `${meta.approxColumns.length} column(s) use the quantile sketch`}</p>
                    </div>
                </div>
                {meta.malformedRows > 0 && (
                    <Callout tone="warning" title={`${formatNumber(meta.malformedRows)} malformed rows`}>
                        These rows have a different number of fields than the header. Missing fields were treated as empty and extra fields ignored.
                    </Callout>
                )}
            </section>

            <section>
                <SectionTitle strong="Columns" soft={`${columns.length} in total`} />
                <Card>
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th scope="col">Column</th>
                                    <th scope="col">Type</th>
                                    <th scope="col" className="is-num">
                                        Filled
                                    </th>
                                    <th scope="col" className="is-num">
                                        Distinct
                                    </th>
                                    <th scope="col">Summary</th>
                                </tr>
                            </thead>
                            <tbody>
                                {columns.map((col, i) => {
                                    const s = stats[col];
                                    const Icon = TYPE_ICON[kinds[i]];
                                    const filled = rows ? 100 - ((s.missing || 0) / rows) * 100 - (s.invalidPct || 0) : 0;
                                    const distinct = s.type === 'categorical' ? `${s.uniqueExact ? '' : '≈ '}${formatNumber(s.unique)}` : s.type === 'numeric' && s.unique != null ? formatNumber(s.unique) : s.type === 'numeric' ? 'over 1,024' : 'n/a';
                                    return (
                                        <tr key={col}>
                                            <th scope="row">{col}</th>
                                            <td>
                                                <span className="type-tag">
                                                    <Icon aria-hidden="true" /> {idCols.includes(col) ? 'ID' : TYPE_LABEL[kinds[i]]}
                                                </span>
                                            </td>
                                            <td className="is-num">
                                                <span className={filled < 100 ? 'text-warn' : ''}>{formatPct(filled)}</span>
                                            </td>
                                            <td className="is-num">{distinct}</td>
                                            <td className="cell-wrap text-muted">{summary(s)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </section>

            {preview.length > 0 && (
                <section>
                    <SectionTitle strong="Preview" soft={`First ${preview.length} rows`} info={GLOSSARY.preview} />
                    <Card>
                        <div className="table-wrap">
                            <table className="table table--compact">
                                <thead>
                                    <tr>
                                        <th scope="col" className="is-num text-muted">
                                            #
                                        </th>
                                        {columns.map((c, i) => (
                                            <th key={c} scope="col" className={kinds[i] === 'numeric' ? 'is-num' : ''}>
                                                {c}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.map((row, r) => (
                                        // eslint-disable-next-line react/no-array-index-key
                                        <tr key={r}>
                                            <td className="is-num text-muted">{r + 1}</td>
                                            {row.map((v, i) => (
                                                // eslint-disable-next-line react/no-array-index-key
                                                <td key={i} className={kinds[i] === 'numeric' ? 'is-num' : ''}>
                                                    {v === '' ? <span className="text-muted">empty</span> : v}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </section>
            )}
        </div>
    );
}
