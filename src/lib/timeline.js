// Rolls per-day totals up into weeks, months or years for timeline charts.
// Empty periods are kept (count 0, average null) so gaps are visible rather than silently skipped.

import { civilFromDays, daysFromCivil } from '../engine/csv';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_POINTS = 1500;

const iso = (day) => {
    const { y, m, d } = civilFromDays(day);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** "1 Jan 2024" for chart labels; `start` keeps the ISO date for CSV exports. */
const pretty = (day) => {
    const { y, m, d } = civilFromDays(day);
    return `${d} ${MONTHS[m - 1]} ${y}`;
};

const GRANULARITIES = {
    day: { key: (d) => d, next: (k) => k + 1, start: (k) => k, label: (k) => pretty(k), title: (k) => pretty(k) },
    // Weeks start on Monday (day 0, 1970-01-01, was a Thursday).
    week: { key: (d) => d - ((d + 3) % 7), next: (k) => k + 7, start: (k) => k, label: (k) => pretty(k), title: (k) => `Week of ${pretty(k)}` },
    month: {
        key: (d) => {
            const { y, m } = civilFromDays(d);
            return y * 12 + (m - 1);
        },
        next: (k) => k + 1,
        start: (k) => daysFromCivil(Math.floor(k / 12), (k % 12) + 1, 1),
        label: (k) => `${MONTHS[k % 12]} ${Math.floor(k / 12)}`,
        title: (k) => `${MONTHS[k % 12]} ${Math.floor(k / 12)}`,
    },
    year: { key: (d) => civilFromDays(d).y, next: (k) => k + 1, start: (k) => daysFromCivil(k, 1, 1), label: (k) => String(k), title: (k) => String(k) },
};

export const GRANULARITY_OPTIONS = ['auto', 'day', 'week', 'month', 'year'];

export function autoGranularity(spanDays) {
    if (spanDays <= 92) return 'day';
    if (spanDays <= 730) return 'week';
    if (spanDays <= 365 * 12) return 'month';
    return 'year';
}

/**
 * @param timeline  { days, counts, measures: [{ column, sums, ns }] } from the analysis
 * @param measure   null for record counts, or a numeric column name for its average
 */
export function aggregateTimeline(timeline, granularity, measure) {
    const { days, counts } = timeline;
    if (!days.length) return { points: [], granularity: 'day' };
    const span = days[days.length - 1] - days[0] + 1;
    let gran = granularity === 'auto' ? autoGranularity(span) : granularity;
    // Too many periods to draw meaningfully: step up to a coarser unit.
    const order = ['day', 'week', 'month', 'year'];
    const periods = { day: span, week: span / 7, month: span / 30.4, year: span / 365 };
    while (periods[gran] > MAX_POINTS && gran !== 'year') gran = order[order.indexOf(gran) + 1];

    const g = GRANULARITIES[gran];
    const m = measure ? timeline.measures.find((x) => x.column === measure) : null;
    const buckets = new Map();
    days.forEach((day, i) => {
        const k = g.key(day);
        let b = buckets.get(k);
        if (!b) buckets.set(k, (b = { count: 0, sum: 0, n: 0 }));
        b.count += counts[i];
        if (m) {
            b.sum += m.sums[i];
            b.n += m.ns[i];
        }
    });

    const points = [];
    const last = g.key(days[days.length - 1]);
    for (let k = g.key(days[0]); k <= last; k = g.next(k)) {
        const b = buckets.get(k) || { count: 0, sum: 0, n: 0 };
        points.push({
            key: k,
            start: iso(g.start(k)),
            label: g.label(k),
            title: g.title(k),
            value: m ? (b.n ? b.sum / b.n : null) : b.count,
            n: m ? b.n : b.count,
        });
    }
    return { points, granularity: gran };
}
