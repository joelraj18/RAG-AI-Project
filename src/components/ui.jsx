// Small, shared presentational building blocks.

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, X } from 'lucide-react';

/**
 * Renders assistant/insight text safely: **bold**, line breaks and "- " bullets.
 * Never uses innerHTML, so values coming from a CSV cannot inject markup.
 */
export function RichText({ text, className }) {
    const renderInline = (line, key) =>
        line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
            part.startsWith('**') && part.endsWith('**') ? (
                <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
            ) : (
                <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>
            ),
        );

    const blocks = [];
    let bullets = [];
    const flush = () => {
        if (bullets.length) {
            blocks.push(
                <ul key={`ul-${blocks.length}`} className="rich-list">
                    {bullets}
                </ul>,
            );
            bullets = [];
        }
    };

    text.split('\n').forEach((line, i) => {
        if (line.startsWith('- ')) {
            bullets.push(<li key={i}>{renderInline(line.slice(2), i)}</li>);
        } else {
            flush();
            if (line.trim()) blocks.push(<p key={i}>{renderInline(line, i)}</p>);
        }
    });
    flush();

    return <div className={className}>{blocks}</div>;
}

/** An ⓘ button that reveals a short explanation on hover, focus or tap. */
export function InfoTip({ text, label = 'More information', align: preferred, side = 'top' }) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [align, setAlign] = useState(preferred || 'center');
    const ref = useRef(null);

    // Anchor the bubble towards the middle of the screen so it never spills off an edge.
    const place = () => {
        if (preferred || !ref.current) return;
        const { left, right } = ref.current.getBoundingClientRect();
        const width = window.innerWidth;
        setAlign(left < 160 ? 'start' : width - right < 160 ? 'end' : 'center');
    };

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => {
            if (!ref.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [open]);

    return (
        <span className={`infotip infotip--${align} infotip--${side} ${open ? 'is-open' : ''}`} ref={ref} onPointerEnter={place} onFocus={place}>
            <button
                type="button"
                className="infotip__btn"
                aria-label={label}
                aria-describedby={id}
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            >
                <Info aria-hidden="true" />
            </button>
            <span role="tooltip" id={id} className="infotip__bubble">
                {text}
            </span>
        </span>
    );
}

const TOAST_ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info };

export function Toast({ message, type = 'info', onClose }) {
    if (!message) return null;
    const Icon = TOAST_ICONS[type] || Info;
    return (
        <div className={`toast toast--${type}`} role={type === 'error' ? 'alert' : 'status'}>
            <Icon className="toast__icon" aria-hidden="true" />
            <p>{message}</p>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Dismiss notification">
                <X aria-hidden="true" />
            </button>
        </div>
    );
}

/** Apple-style two-tone heading: "All models. Take your pick." */
export function SectionTitle({ strong, soft, info, as: Tag = 'h2' }) {
    return (
        <Tag className="section-title">
            <span>{strong}</span> {soft && <span className="section-title__soft">{soft}</span>}
            {info && <InfoTip text={info} />}
        </Tag>
    );
}

export function Card({ title, info, eyebrow, actions, children, className = '' }) {
    return (
        <section className={`card ${className}`}>
            {(title || eyebrow || actions) && (
                <header className="card__header">
                    <div>
                        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
                        {title && (
                            <h3 className="card__title">
                                {title}
                                {info && <InfoTip text={info} />}
                            </h3>
                        )}
                    </div>
                    {actions}
                </header>
            )}
            {children}
        </section>
    );
}

export function StatTile({ label, value, hint, info, tone }) {
    return (
        <div className={`stat-tile ${tone ? `stat-tile--${tone}` : ''}`}>
            <p className="stat-tile__label">
                {label}
                {info && <InfoTip text={info} />}
            </p>
            <p className="stat-tile__value">{value}</p>
            {hint && <p className="stat-tile__hint">{hint}</p>}
        </div>
    );
}

export function EmptyState({ icon: Icon, title, children }) {
    return (
        <div className="empty-state">
            {Icon && <Icon className="empty-state__icon" aria-hidden="true" />}
            <p className="empty-state__title">{title}</p>
            {children && <div className="empty-state__body">{children}</div>}
        </div>
    );
}

export function Callout({ tone = 'info', title, children }) {
    const Icon = tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
    return (
        <div className={`callout callout--${tone}`}>
            <Icon className="callout__icon" aria-hidden="true" />
            <div>
                {title && <p className="callout__title">{title}</p>}
                <div className="callout__body">{children}</div>
            </div>
        </div>
    );
}

/** Horizontal, scroll-snapping row with previous/next buttons (like the Apple Store shelves). */
export function Carousel({ children, label }) {
    const track = useRef(null);
    const [edges, setEdges] = useState({ start: true, end: true });

    const update = useCallback(() => {
        const el = track.current;
        if (!el) return;
        setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    }, []);

    useEffect(() => {
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [update, children]);

    const scroll = (dir) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: 'smooth' });

    return (
        <div className="carousel">
            <div className="carousel__track" ref={track} onScroll={update} role="list" aria-label={label}>
                {React.Children.map(children, (child) => (
                    <div className="carousel__item" role="listitem">
                        {child}
                    </div>
                ))}
            </div>
            {!edges.start && (
                <button type="button" className="carousel__nav carousel__nav--prev" onClick={() => scroll(-1)} aria-label="Scroll left">
                    <ChevronLeft aria-hidden="true" />
                </button>
            )}
            {!edges.end && (
                <button type="button" className="carousel__nav carousel__nav--next" onClick={() => scroll(1)} aria-label="Scroll right">
                    <ChevronRight aria-hidden="true" />
                </button>
            )}
        </div>
    );
}

export function DataTable({ columns, rows, rowKey }) {
    return (
        <div className="table-wrap">
            <table className="table">
                <thead>
                    <tr>
                        {columns.map((c) => (
                            <th key={c.key} scope="col" className={c.numeric ? 'is-num' : ''}>
                                <span className="th-inner">
                                    {c.label}
                                    {c.info && <InfoTip text={c.info} side="bottom" />}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={rowKey(row)}>
                            {columns.map((c, i) => {
                                const content = c.render ? c.render(row) : row[c.key];
                                return i === 0 ? (
                                    <th key={c.key} scope="row">
                                        {content}
                                    </th>
                                ) : (
                                    <td key={c.key} className={c.numeric ? 'is-num' : ''}>
                                        {content}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
