import React from 'react';
import { CheckCircle2, Download, FileText, NotebookPen } from 'lucide-react';
import { AccuracyBadge } from '../../components/ChartCard';
import { StatTile } from '../../components/ui';
import { STRONG_CORRELATION, displayName, formatBytes, formatDuration, formatPct } from '../../lib/analysis';
import { qualitySummary } from '../../lib/blueprints';
import { GLOSSARY } from '../../lib/glossary';
import OverviewTab from './OverviewTab';
import { BivariateTab, CorrelationTab } from './RelationshipTabs';
import UnivariateTab from './UnivariateTab';
import { DecisionTab, InsightsTab, PredictiveTab, QualityTab, SegmentationTab, TemplateTab } from './tabs';

export const EXPLORER_TABS = [
    { id: 'overview', label: 'Overview', Component: OverviewTab },
    { id: 'univariate', label: 'Univariate', Component: UnivariateTab },
    { id: 'correlation', label: 'Correlation', Component: CorrelationTab },
    { id: 'bivariate', label: 'Bivariate', Component: BivariateTab },
    { id: 'insights', label: 'Insights', Component: InsightsTab },
    { id: 'decision', label: 'Decision Center', Component: DecisionTab },
    { id: 'quality', label: 'Data Quality', Component: QualityTab },
    { id: 'segmentation', label: 'Segmentation', Component: SegmentationTab },
    { id: 'predictive', label: 'Predictive', Component: PredictiveTab },
    { id: 'template', label: 'Python Template', Component: TemplateTab },
];

export default function ExplorerView({ dataset, analysis, tab, onTabChange, onExport }) {
    const active = EXPLORER_TABS.find((t) => t.id === tab) || EXPLORER_TABS[0];
    const { Component } = active;
    const { completeness } = qualitySummary(analysis);
    const { meta } = analysis;
    const strong = analysis.correlations.filter((c) => Math.abs(c.correlation) > STRONG_CORRELATION).length;

    return (
        <div className="page">
            <header className="page-hero">
                <div>
                    <p className="eyebrow">Explore</p>
                    <h1 className="display display--md" title={dataset.name}>
                        {displayName(dataset.name)}
                    </h1>
                </div>
                <div className="page-hero__links">
                    <button type="button" className="link" onClick={() => onExport('report')}>
                        <FileText aria-hidden="true" /> Report (.md)
                    </button>
                    <button type="button" className="link" onClick={() => onExport('notebook')}>
                        <NotebookPen aria-hidden="true" /> Notebook (.ipynb)
                    </button>
                    <button type="button" className="link" onClick={() => onExport('csv')} disabled={!dataset.file} title={dataset.file ? undefined : 'The original file was too large to keep in this browser'}>
                        <Download aria-hidden="true" /> Original file ({formatBytes(meta.fileSize)})
                    </button>
                </div>
            </header>

            <div className="run-strip">
                <CheckCircle2 aria-hidden="true" />
                <p>
                    <strong>All {meta.rows.toLocaleString()} rows analysed</strong> in {formatDuration(meta.elapsedMs)} on {meta.workers} CPU {meta.workers === 1 ? 'core' : 'cores'}.
                </p>
                <AccuracyBadge exact={meta.exactStats} />
            </div>

            <div className="kpis">
                <StatTile label="Records" value={meta.rows.toLocaleString()} info={GLOSSARY.records} />
                <StatTile label="Columns" value={meta.columns} info={GLOSSARY.features} />
                <StatTile label="Numeric" value={analysis.numericCols.length} info={GLOSSARY.numeric} />
                <StatTile label="Categorical" value={analysis.categoricalCols.length} info={GLOSSARY.categorical} />
                {analysis.dateCols.length > 0 && <StatTile label="Dates" value={analysis.dateCols.length} info={GLOSSARY.dates} />}
                <StatTile label="Completeness" value={formatPct(completeness)} tone={completeness === 100 ? 'good' : undefined} info={GLOSSARY.completeness} />
                <StatTile label="Strong correlations" value={strong} info={GLOSSARY.strongCorrelations} />
            </div>

            <nav className="subnav" aria-label="Analysis sections">
                <ul role="tablist">
                    {EXPLORER_TABS.map((t) => (
                        <li key={t.id}>
                            <button type="button" role="tab" aria-selected={t.id === active.id} className={t.id === active.id ? 'is-active' : ''} onClick={() => onTabChange(t.id)}>
                                {t.label}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>

            <div role="tabpanel" aria-label={active.label} className="tabpanel">
                <Component key={dataset.id} analysis={analysis} />
            </div>
        </div>
    );
}
