import React, { useRef, useState } from 'react';
import {
    ArrowUpRight,
    BarChart3,
    Brain,
    CalendarDays,
    Cpu,
    Download,
    FileSpreadsheet,
    Grid3x3,
    Layers,
    Loader2,
    ShieldCheck,
    Target,
    Trash2,
    UploadCloud,
} from 'lucide-react';
import AnalysisProgress from '../components/AnalysisProgress';
import { Carousel, EmptyState, InfoTip, SectionTitle } from '../components/ui';
import { displayName, formatBytes, formatCompact, formatDuration } from '../lib/analysis';
import { GLOSSARY } from '../lib/glossary';

const EXPERIENCE = [
    { icon: Cpu, title: 'Every row, every core', text: 'Files of any size, even millions or billions of rows, are streamed across all your CPU cores. Nothing is sampled away.' },
    { icon: BarChart3, title: 'Four views per column', text: 'Histogram with adjustable bins, box plot, cumulative distribution and Q-Q plot, plus a percentile table.' },
    { icon: Grid3x3, title: 'Correlation matrix', text: 'Pearson’s r between every pair of numeric columns, computed over all rows, with the strongest pairs called out.' },
    { icon: Layers, title: 'Group comparisons', text: 'Means, medians and box plots per category, and scatter plots with a trend line fitted on every row.' },
    { icon: CalendarDays, title: 'Timelines', text: 'Date columns become charts of records over time, by day, week, month or year.' },
    { icon: Download, title: 'Clean chart exports', text: 'Download any chart as a PNG or SVG image without tooltips or UI, or the exact numbers behind it as CSV.' },
    { icon: Brain, title: 'Insights engine', text: 'Skew, outliers, invalid values, dominant categories and missing data flagged automatically, in plain English.' },
    { icon: Target, title: 'Predictive blueprint', text: 'Ranks the features most likely to predict your target, and the segments with outsized value.' },
    { icon: ShieldCheck, title: 'Private by design', text: 'Parsing and analysis run on your device. Your files are never uploaded anywhere.' },
];

/** Column names and kinds for a dataset, whether it was saved by this version or an older one. */
function columnKinds(dataset) {
    if (dataset.analysis?.columns) return dataset.analysis.columns.map((c, i) => [c, dataset.analysis.kinds?.[i] || dataset.analysis.stats[c]?.type]);
    const sample = dataset.data?.[0] || {};
    return (dataset.columns || []).map((c) => [c, typeof sample[c] === 'number' ? 'numeric' : 'categorical']);
}

/** Column-type dots on a dataset card, like the colour swatches on a product tile. */
function ColumnDots({ dataset }) {
    const kinds = columnKinds(dataset);
    const count = (k) => kinds.filter(([, kind]) => kind === k).length;
    const parts = [`${count('numeric')} numeric`, `${count('categorical')} text`];
    if (count('date')) parts.push(`${count('date')} date`);
    return (
        <div className="swatches">
            <span className="swatches__dots" aria-hidden="true">
                {kinds.slice(0, 12).map(([c, kind]) => (
                    <span key={c} className={`swatch swatch--${kind === 'numeric' ? 'num' : kind === 'date' ? 'date' : 'cat'}`} title={`${c} (${kind})`} />
                ))}
                {kinds.length > 12 && <span className="swatches__more">+{kinds.length - 12}</span>}
            </span>
            <span className="swatches__caption">{parts.join(' · ')}</span>
        </div>
    );
}

function DatasetCard({ dataset, active, busy, onOpen, onDelete }) {
    const uploaded = new Date(dataset.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const meta = dataset.analysis?.meta;
    const rows = meta?.rows ?? dataset.data?.length ?? 0;
    const columns = meta?.columns ?? dataset.columns?.length ?? 0;
    const outdated = !dataset.analysis || dataset.analysis.version !== 2;
    return (
        <article className={`product-card ${active ? 'is-active' : ''}`}>
            <p className="eyebrow">{active ? 'Currently open' : `Added ${uploaded}`}</p>
            <h3 className="product-card__title" title={dataset.name}>
                {displayName(dataset.name)}
            </h3>
            <div className="product-card__visual" aria-hidden="true">
                <span className="product-card__big">{formatCompact(rows)}</span>
                <span className="product-card__bigunit">rows</span>
            </div>
            <ColumnDots dataset={dataset} />
            <footer className="product-card__footer">
                <p className="product-card__meta">
                    <strong>{rows.toLocaleString()}</strong> records · <strong>{columns}</strong> columns
                    <br />
                    {outdated
                        ? 'Saved by an earlier version, so opening it runs a fresh analysis'
                        : `${formatBytes(dataset.size || meta.fileSize)} · analysed in ${formatDuration(meta.elapsedMs)}`}
                    {dataset.unsaved && ' · this session only'}
                </p>
                <div className="product-card__actions">
                    <button type="button" className="icon-btn icon-btn--danger" onClick={() => onDelete(dataset)} aria-label={`Delete ${dataset.name}`} title="Delete">
                        <Trash2 aria-hidden="true" />
                    </button>
                    <button type="button" className="btn btn--primary" onClick={() => onOpen(dataset)} disabled={busy}>
                        {active ? 'Explore' : 'Open'}
                    </button>
                </div>
            </footer>
        </article>
    );
}

function UploadZone({ onFile, busy }) {
    const input = useRef(null);
    const [dragging, setDragging] = useState(false);

    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
    };

    return (
        <div
            className={`upload ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
        >
            {busy ? <Loader2 className="upload__icon spin" aria-hidden="true" /> : <UploadCloud className="upload__icon" aria-hidden="true" />}
            <div className="upload__text">
                <p className="upload__title">Drop a CSV here to begin.</p>
                <p className="upload__hint">
                    Any size. Every row is analysed, streamed across all your CPU cores. The first row should hold column names; comma, semicolon, tab and pipe delimiters are detected automatically.
                </p>
            </div>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => input.current?.click()}>
                Choose file
            </button>
            <input
                ref={input}
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                className="visually-hidden"
                tabIndex={-1}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) onFile(file);
                }}
            />
        </div>
    );
}

export default function DatasetsView({ datasets, activeId, job, loading, onFile, onOpen, onDelete, onSample }) {
    const busy = !!job;
    return (
        <div className="page">
            <header className="page-hero">
                <h1 className="display">Datasets</h1>
                <div className="page-hero__links">
                    <button type="button" className="link" onClick={onSample} disabled={busy}>
                        Try a sample dataset <ArrowUpRight aria-hidden="true" />
                    </button>
                    <span className="link link--muted">
                        Where is my data stored?
                        <InfoTip text={GLOSSARY.privacy} align="end" />
                    </span>
                </div>
            </header>

            {job ? <AnalysisProgress fileName={job.fileName} progress={job.progress} onCancel={job.cancel} /> : <UploadZone onFile={onFile} busy={busy} />}

            <section className="shelf">
                <SectionTitle strong="Your datasets" soft={datasets.length ? 'Pick one to explore' : loading ? 'Loading…' : 'Nothing here yet'} />
                {loading && datasets.length === 0 ? (
                    <EmptyState icon={Loader2} title="Loading your saved datasets…" />
                ) : datasets.length === 0 ? (
                    <EmptyState icon={FileSpreadsheet} title="Upload a CSV, or start with sample data">
                        <button type="button" className="btn btn--secondary" onClick={onSample} disabled={busy}>
                            Load sample phone sales
                        </button>
                    </EmptyState>
                ) : (
                    <Carousel label="Your datasets">
                        {datasets.map((d) => (
                            <DatasetCard key={d.id} dataset={d} active={d.id === activeId} busy={busy} onOpen={onOpen} onDelete={onDelete} />
                        ))}
                    </Carousel>
                )}
            </section>

            <section className="shelf">
                <SectionTitle strong="The DataMind experience" soft="Everything you get from a single upload" />
                <Carousel label="Features">
                    {EXPERIENCE.map(({ icon: Icon, title, text }) => (
                        <article key={title} className="feature-card">
                            <Icon className="feature-card__icon" aria-hidden="true" />
                            <h3 className="feature-card__title">{title}</h3>
                            <p className="feature-card__text">{text}</p>
                        </article>
                    ))}
                </Carousel>
            </section>
        </div>
    );
}
