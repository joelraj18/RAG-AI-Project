// Shared helpers for reading an analysis produced by the streaming engine (src/engine).

export { pairKey, STRONG_CORRELATION } from '../engine/finalize';

export const NOTABLE_CORRELATION = 0.5;

/** Look up r for an unordered pair of numeric columns. */
export const correlationBetween = (correlations, a, b) => {
    if (a === b) return 1;
    const hit = correlations.find((c) => (c.col1 === a && c.col2 === b) || (c.col1 === b && c.col2 === a));
    return hit ? hit.correlation : 0;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2024-01-31" → "31 Jan 2024" for display; anything else is returned unchanged. */
export function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** The column's name in the original file (display names replace underscores with spaces). */
export function sourceName(analysis, column) {
    const i = analysis.columns.indexOf(column);
    return analysis.meta.sourceColumns?.[i] ?? column;
}

/** A file name for headings: no extension, and underscores or hyphens shown as spaces. */
export const displayName = (fileName = '') =>
    fileName
        .replace(/\.(csv|tsv|txt)$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || fileName;

/** Human friendly number formatting shared across the app. */
export function formatNumber(value, digits = 2) {
    if (value == null || Number.isNaN(value)) return 'n/a';
    if (!Number.isFinite(value)) return '∞';
    if (Math.abs(value) < 0.5 * 10 ** -digits) value = 0; // never print "-0"
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-4)) return value.toExponential(2);
    return value.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(value) ? 0 : digits });
}

export const formatPct = (value, digits = 1) => (value == null || Number.isNaN(value) ? 'n/a' : `${value.toFixed(digits)}%`);

/** 1.2K, 3.4M, 1.0B — for counters and axis ticks. */
export function formatCompact(value) {
    if (value == null || Number.isNaN(value)) return 'n/a';
    return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
    return `${(bytes / 1000 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'n/a';
    const s = Math.round(ms / 1000);
    if (s < 1) return 'under a second';
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Prefix for statistics estimated by the streaming sketch rather than computed exactly. */
export const approx = (exact) => (exact === false ? '≈ ' : '');
