import React, { useState } from 'react';
import { Check, Copy, Gem, Users } from 'lucide-react';
import { ChartCard } from '../../components/ChartCard';
import { MissingChart } from '../../components/charts';
import { Callout, Card, DataTable, EmptyState, InfoTip, RichText, SectionTitle, StatTile } from '../../components/ui';
import { STRONG_CORRELATION, displayName, formatNumber, formatPct } from '../../lib/analysis';
import { decisionSummary, predictiveSummary, qualitySummary, segmentationSummary } from '../../lib/blueprints';
import { buildPythonTemplate } from '../../lib/exporters';
import { GLOSSARY } from '../../lib/glossary';

const cvTone = (cv) => (cv == null ? '' : cv > 75 ? 'text-warn' : cv > 50 ? 'text-caution' : '');

/* ---------- Insights ---------- */

const AGENT_TONE = { warning: 'warning', success: 'success', info: 'info' };

export function InsightsTab({ analysis }) {
    return (
        <div className="stack-xl">
            <SectionTitle strong="Insights" soft="What stood out in your data" info={GLOSSARY.insights} />
            <div className="stack">
                {analysis.insights.map((insight, i) => (
                    <Callout key={i} tone={AGENT_TONE[insight.type]} title={insight.agent}>
                        <RichText text={insight.text} />
                    </Callout>
                ))}
            </div>
        </div>
    );
}

/* ---------- Decision center ---------- */

export function DecisionTab({ analysis }) {
    const { unstable, drivers, risks } = decisionSummary(analysis);

    return (
        <div className="stack-xl">
            <SectionTitle strong="Decision Center" soft="The few things worth acting on" info={GLOSSARY.decision} />
            <div className="grid grid--3">
                <StatTile label="Risks flagged" value={risks.length} tone={risks.length ? 'warn' : 'good'} hint="Skew, outliers or gaps" />
                <StatTile label="Strong drivers" value={drivers.length} hint={`Pairs with |r| ≥ ${STRONG_CORRELATION}`} info={GLOSSARY.strongCorrelations} />
                <StatTile label="Unstable features" value={unstable.length} tone={unstable.length ? 'warn' : 'good'} hint="CV above 50%" info={GLOSSARY.cv} />
            </div>

            <Card eyebrow="01" title="Risks and imbalances">
                {risks.length ? (
                    <div className="stack">
                        {risks.map((r, i) => (
                            <Callout key={i} tone="warning" title={r.agent}>
                                <RichText text={r.text} />
                            </Callout>
                        ))}
                    </div>
                ) : (
                    <p className="text-muted">No skew, extreme outliers or heavy missing data detected.</p>
                )}
            </Card>

            <Card eyebrow="02" title="Strongest drivers">
                {drivers.length ? (
                    <ul className="action-list">
                        {drivers.map((c) => (
                            <li key={`${c.col1}-${c.col2}`}>
                                <p>
                                    <strong>{c.col1}</strong> and <strong>{c.col2}</strong> move {c.correlation > 0 ? 'together' : 'in opposite directions'} (r = {c.correlation.toFixed(2)}).
                                </p>
                                <p className="text-muted">Action: use one to forecast or segment the other, and avoid feeding both into the same linear model.</p>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted">No strong linear relationships (|r| ≥ {STRONG_CORRELATION}). Relationships may be weak or not linear.</p>
                )}
            </Card>

            <Card eyebrow="03" title="Stability" info={GLOSSARY.cv}>
                {unstable.length ? (
                    <ul className="action-list">
                        {unstable.map((u) => (
                            <li key={u.col}>
                                <p>
                                    <strong>{u.col}</strong> varies widely (CV {formatPct(u.cv)}).
                                </p>
                                <p className="text-muted">Action: treat single values with caution; the spread may hide distinct high value segments worth splitting out.</p>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted">Every numeric feature has CV below 50%. The data is stable.</p>
                )}
            </Card>
        </div>
    );
}

/* ---------- Data quality ---------- */

export function QualityTab({ analysis }) {
    const { missing, highCardinality, inconsistent, completeness } = qualitySummary(analysis);
    const { meta, numericCols, categoricalCols, dateCols, stats, numericDetails } = analysis;
    const invalid = numericCols.filter((c) => stats[c].invalid > 0);

    return (
        <div className="stack-xl">
            <SectionTitle strong="Data quality" soft="A health check before you trust the numbers" info={GLOSSARY.quality} />
            <div className="grid grid--3">
                <StatTile label="Completeness" value={formatPct(completeness, 2)} tone={completeness === 100 ? 'good' : 'warn'} info={GLOSSARY.completeness} />
                <StatTile label="Rows analysed" value={meta.rows.toLocaleString()} hint={meta.malformedRows ? `${formatNumber(meta.malformedRows)} malformed` : 'all well formed'} info={GLOSSARY.records} />
                <StatTile
                    label="Column types"
                    value={`${numericCols.length} · ${categoricalCols.length}${dateCols.length ? ` · ${dateCols.length}` : ''}`}
                    hint={`numeric · text${dateCols.length ? ' · date' : ''}`}
                    info={GLOSSARY.numeric}
                />
            </div>

            {missing.length > 0 ? (
                <ChartCard
                    eyebrow={`${missing.length} of ${analysis.columns.length} columns affected`}
                    title="Missing and unusable values"
                    info={GLOSSARY.missing}
                    exact
                    getExport={() => ({
                        filename: 'Missing values',
                        title: 'Missing and unusable values per column',
                        subtitle: `${displayName(meta.fileName)} · ${meta.rows.toLocaleString()} rows`,
                        rows: missing.map((m) => ({ Column: m.col, 'Unusable cells': m.rows, 'Not numeric': m.invalid, 'Share (%)': m.pct })),
                    })}
                    minHeight={140}
                >
                    <MissingChart rows={missing} />
                </ChartCard>
            ) : (
                <Callout tone="success" title="100% complete">
                    Every column has a usable value in every row.
                </Callout>
            )}

            <div className="grid grid--3">
                <Card title="Values that aren’t numbers" info={GLOSSARY.invalid}>
                    {invalid.length ? (
                        <ul className="plain-list">
                            {invalid.map((c) => (
                                <li key={c}>
                                    <strong>{c}</strong> <span className="text-warn">{formatNumber(stats[c].invalid)}</span>
                                    {numericDetails[c].invalidExamples.length > 0 && <span className="text-muted">e.g. “{numericDetails[c].invalidExamples.slice(0, 3).join('”, “')}”</span>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted">Every numeric column contains only numbers.</p>
                    )}
                </Card>
                <Card title="Inconsistent features" info={GLOSSARY.cv}>
                    {inconsistent.length ? (
                        <ul className="plain-list">
                            {inconsistent.map((i) => (
                                <li key={i.col}>
                                    <strong>{i.col}</strong> <span className="text-warn">CV {formatPct(i.cv)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted">All numeric features have CV below 75%.</p>
                    )}
                </Card>
                <Card title="Likely identifiers" info={GLOSSARY.cardinality}>
                    {highCardinality.length ? (
                        <ul className="plain-list">
                            {highCardinality.map((c) => (
                                <li key={c}>
                                    <strong>{c}</strong> <span className="text-muted">behaves like an ID</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted">No column looks like an identifier.</p>
                    )}
                </Card>
            </div>
        </div>
    );
}

/* ---------- Segmentation ---------- */

export function SegmentationTab({ analysis }) {
    const { target, driver, premium, volume } = segmentationSummary(analysis);

    return (
        <div className="stack-xl">
            <SectionTitle strong="Segmentation" soft="Two profiles to start from" info={GLOSSARY.segmentation} />
            <div className="grid grid--2">
                <Card className="segment" eyebrow="Value" title={<><Gem aria-hidden="true" className="segment__icon" /> Premium segment</>}>
                    {premium ? (
                        <>
                            <p className="segment__profile">
                                {premium.column} = <strong>{premium.category}</strong>
                            </p>
                            <dl className="facts">
                                <dt>Average {target}</dt>
                                <dd>{formatNumber(premium.mean)}</dd>
                                <dt>Records</dt>
                                <dd>{premium.count.toLocaleString()}</dd>
                                {driver && (
                                    <>
                                        <dt>Closest driver</dt>
                                        <dd>
                                            {driver.col} (r = {driver.r.toFixed(2)})
                                        </dd>
                                    </>
                                )}
                            </dl>
                            <p className="text-muted">Action: lead with premium features and service for this group, as it carries the highest value per record.</p>
                        </>
                    ) : (
                        <p className="text-muted">Needs a numeric target and a categorical column with 2 to 14 values.</p>
                    )}
                </Card>
                <Card className="segment" eyebrow="Volume" title={<><Users aria-hidden="true" className="segment__icon" /> Core segment</>}>
                    {volume ? (
                        <>
                            <p className="segment__profile">
                                {volume.column} = <strong>{volume.group}</strong>
                            </p>
                            <dl className="facts">
                                <dt>Share of records</dt>
                                <dd>{formatPct(volume.pct)}</dd>
                            </dl>
                            <p className="text-muted">Action: optimise for reliability and affordability here, as this group provides scale and stability.</p>
                        </>
                    ) : (
                        <p className="text-muted">No categorical column with a clear majority group.</p>
                    )}
                </Card>
            </div>
            {target && (
                <Callout title="How the target was chosen">
                    <strong>{target}</strong> was picked as the value column because its name suggests price, revenue or similar. If that’s wrong, the
                    profiles above still describe the column’s group with the highest mean.
                </Callout>
            )}
        </div>
    );
}

/* ---------- Predictive ---------- */

export function PredictiveTab({ analysis }) {
    const { target, predictors, skewed, best, worst } = predictiveSummary(analysis);
    if (!target || analysis.numericCols.length < 2) return <EmptyState title="Predictive analysis needs at least two numeric columns" />;

    const columns = [
        { key: 'col', label: 'Feature' },
        { key: 'score', label: 'Score', numeric: true, info: GLOSSARY.riskScore, render: (r) => <strong className="text-brand">{r.score.toFixed(3)}</strong> },
        { key: 'r', label: `|r| with ${target}`, numeric: true, info: GLOSSARY.correlation, render: (r) => r.r.toFixed(2) },
        { key: 'cv', label: 'CV', numeric: true, info: GLOSSARY.cv, render: (r) => <span className={cvTone(r.cv)}>{formatPct(r.cv)}</span> },
    ];

    return (
        <div className="stack-xl">
            <SectionTitle strong="Predictive blueprint" soft={`What best explains ${target}`} info={GLOSSARY.predictive} />
            <Card eyebrow="01" title="Top predictors, adjusted for risk" info={GLOSSARY.riskScore}>
                {predictors.length ? (
                    <DataTable columns={columns} rows={predictors} rowKey={(r) => r.col} />
                ) : (
                    <p className="text-muted">No other numeric feature has a defined CV to score.</p>
                )}
            </Card>
            <div className="grid grid--2">
                <Card eyebrow="02" title="Outlier opportunities" info={GLOSSARY.skew}>
                    {skewed.length ? (
                        <ul className="plain-list">
                            {skewed.map((s) => (
                                <li key={`${s.column}-${s.group}`}>
                                    {s.column} = <strong>{s.group}</strong> <span className="text-muted">mean exceeds median by {formatNumber(s.gap, 0)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted">No group is strongly skewed to the right.</p>
                    )}
                </Card>
                <Card eyebrow="03" title="Best vs worst case">
                    {best && worst ? (
                        <dl className="facts">
                            <dt>Best</dt>
                            <dd>
                                {best.column} = <strong>{best.category}</strong> · avg {formatNumber(best.mean)}
                            </dd>
                            <dt>Worst</dt>
                            <dd>
                                {worst.column} = <strong>{worst.category}</strong> · avg {formatNumber(worst.mean)}
                            </dd>
                        </dl>
                    ) : (
                        <p className="text-muted">Needs a categorical column with 2 to 14 values.</p>
                    )}
                </Card>
            </div>
        </div>
    );
}

/* ---------- Python template ---------- */

export function TemplateTab({ analysis }) {
    const [copied, setCopied] = useState(false);
    const code = buildPythonTemplate(analysis);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="stack-xl">
            <SectionTitle strong="Python template" soft="Reproduce it in Jupyter" info={GLOSSARY.template} />
            <Card
                title="Paste into a notebook cell"
                actions={
                    <button type="button" className="btn btn--secondary" onClick={copy}>
                        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copied ? 'Copied' : 'Copy code'}
                    </button>
                }
            >
                <pre className="code">
                    <code>{code}</code>
                </pre>
            </Card>
            <p className="footnote">
                Requires pandas, numpy, matplotlib, seaborn and scipy. Uncomment the <code>read_csv</code> line and point it at your file.
                <InfoTip text="Install with: pip install pandas numpy matplotlib seaborn scipy" />
            </p>
        </div>
    );
}
