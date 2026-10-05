import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, FileImage, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';
import { exportChartCsv, exportChartPng, exportChartSvg } from '../lib/chartExport';
import { GLOSSARY } from '../lib/glossary';
import { InfoTip } from './ui';

/** Renders children only once they scroll near the viewport (charts are the costliest part of the page). */
function useLazyVisible(margin = '400px') {
    const ref = useRef(null);
    const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
    useEffect(() => {
        if (visible || !ref.current) return undefined;
        const io = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    io.disconnect();
                }
            },
            { rootMargin: margin },
        );
        io.observe(ref.current);
        return () => io.disconnect();
    }, [visible, margin]);
    return [ref, visible];
}

export function AccuracyBadge({ exact }) {
    return (
        <span className={`badge ${exact ? 'badge--exact' : 'badge--approx'}`}>
            {exact ? 'Exact' : '≈ within 0.1%'}
            <InfoTip text={GLOSSARY.exactness} label="About accuracy" />
        </span>
    );
}

function ExportMenu({ plotRef, getSpec }) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState('');
    const menuRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => {
            if (!menuRef.current?.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const run = async (kind) => {
        setOpen(false);
        try {
            const spec = getSpec();
            if (kind === 'csv') exportChartCsv(spec.rows, spec.filename);
            else if (kind === 'svg') exportChartSvg(plotRef.current, spec);
            else await exportChartPng(plotRef.current, spec);
            setStatus('Downloaded');
        } catch (err) {
            setStatus(err.message);
        }
        setTimeout(() => setStatus(''), 2000);
    };

    return (
        <div className="export-menu" ref={menuRef}>
            <button type="button" className="btn btn--ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {status === 'Downloaded' ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}
                <span>{status || 'Download'}</span>
            </button>
            {open && (
                <div className="export-menu__list" role="menu">
                    <button type="button" role="menuitem" onClick={() => run('png')}>
                        <ImageIcon aria-hidden="true" /> Image (PNG)
                    </button>
                    <button type="button" role="menuitem" onClick={() => run('svg')}>
                        <FileImage aria-hidden="true" /> Vector image (SVG)
                    </button>
                    <button type="button" role="menuitem" onClick={() => run('csv')}>
                        <FileSpreadsheet aria-hidden="true" /> Chart data (CSV)
                    </button>
                    <p className="export-menu__note">{GLOSSARY.exportImage}</p>
                </div>
            )}
        </div>
    );
}

/**
 * A card holding one chart with optional controls and a download menu.
 * @param getExport () => { filename, title, subtitle, legend, rows } — computed lazily on download
 */
export function ChartCard({ eyebrow, title, info, exact, controls, getExport, footer, minHeight = 240, children, className = '' }) {
    const plotRef = useRef(null);
    const [lazyRef, visible] = useLazyVisible();
    return (
        <section className={`card chart-card ${className}`} ref={lazyRef}>
            <header className="card__header">
                <div className="chart-card__heading">
                    {eyebrow && <p className="eyebrow">{eyebrow}</p>}
                    <h3 className="card__title">
                        {title}
                        {info && <InfoTip text={info} />}
                        {exact !== undefined && <AccuracyBadge exact={exact} />}
                    </h3>
                </div>
                {getExport && <ExportMenu plotRef={plotRef} getSpec={getExport} />}
            </header>
            {controls && <div className="chart-card__controls">{controls}</div>}
            <div ref={plotRef} className="chart-card__plot" style={{ minHeight }}>
                {visible ? children : null}
            </div>
            {footer}
        </section>
    );
}

/** iOS-style segmented control for switching chart types. */
export function Segmented({ options, value, onChange, label }) {
    return (
        <div className="segmented segmented--inline" role="radiogroup" aria-label={label}>
            {options.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function SelectPill({ label, value, onChange, options }) {
    return (
        <label className="select">
            <span>{label}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
