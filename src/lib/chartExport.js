// Exports a rendered chart as a standalone SVG or PNG image, or its underlying numbers as CSV.
// The image contains only the plot (plus title, subtitle and legend) — no hover states,
// tooltips, page chrome or CSS filters — on a plain white background.

import Papa from 'papaparse';
import { downloadBlob, downloadFile } from './exporters';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
const PAD = 28;
const PNG_SCALE = 2;

// Interaction-only layers that must not appear in an exported image.
const TRANSIENT = '.recharts-tooltip-cursor, .recharts-active-dot, .recharts-tooltip-wrapper, [data-export="skip"]';

// Readable file names: keep letters, digits and spaces; drop characters file systems reject.
const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'chart';

function textNode(text, x, y, { size = 13, weight = 400, fill = '#1d1d1f', anchor = 'start' } = {}) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('font-size', size);
    t.setAttribute('font-weight', weight);
    t.setAttribute('fill', fill);
    t.setAttribute('text-anchor', anchor);
    t.textContent = text;
    return t;
}

/** Builds the export SVG string from the first chart SVG inside `element`. */
export function buildChartSvg(element, { title, subtitle, legend = [] }) {
    const source = element.querySelector('svg.recharts-surface') || element.querySelector('svg');
    if (!source) throw new Error('No chart to export yet.');
    const rect = source.getBoundingClientRect();
    const width = Math.round(Number(source.getAttribute('width')) || rect.width || 640);
    const height = Math.round(Number(source.getAttribute('height')) || rect.height || 320);

    const plot = source.cloneNode(true);
    plot.querySelectorAll(TRANSIENT).forEach((n) => n.remove());
    plot.removeAttribute('class');
    plot.removeAttribute('style');
    plot.setAttribute('width', width);
    plot.setAttribute('height', height);
    if (!plot.getAttribute('viewBox')) plot.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const headerHeight = (title ? 30 : 0) + (subtitle ? 22 : 0);
    // Narrow plots (e.g. a donut) still need room for the title, subtitle and legend.
    const textWidth = Math.max((title || '').length * 11, (subtitle || '').length * 7.2, ...legend.map((l) => 40 + (l.label.length + (l.value || '').length + 2) * 7));
    const totalWidth = Math.ceil(Math.max(width, textWidth, 360) + PAD * 2);
    plot.setAttribute('x', PAD + Math.max(0, (totalWidth - PAD * 2 - width) / 2));
    plot.setAttribute('y', PAD + headerHeight);

    // Legend: swatch + label, wrapped onto rows.
    const legendItems = [];
    let lx = PAD;
    let ly = PAD + headerHeight + height + 24;
    for (const item of legend) {
        const label = `${item.label}${item.value ? `  ${item.value}` : ''}`;
        const itemWidth = 22 + label.length * 7 + 18;
        if (lx + itemWidth > totalWidth - PAD && lx > PAD) {
            lx = PAD;
            ly += 22;
        }
        legendItems.push({ ...item, label, x: lx, y: ly });
        lx += itemWidth;
    }
    const totalHeight = (legendItems.length ? ly + 16 : PAD + headerHeight + height) + PAD;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', totalWidth);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
    svg.setAttribute('font-family', FONT);

    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);

    if (title) svg.appendChild(textNode(title, PAD, PAD + 18, { size: 19, weight: 600 }));
    if (subtitle) svg.appendChild(textNode(subtitle, PAD, PAD + (title ? 42 : 16), { size: 13, fill: '#6e6e73' }));
    svg.appendChild(plot);

    for (const item of legendItems) {
        const swatch = document.createElementNS(SVG_NS, 'rect');
        swatch.setAttribute('x', item.x);
        swatch.setAttribute('y', item.y - 10);
        swatch.setAttribute('width', 12);
        swatch.setAttribute('height', 12);
        swatch.setAttribute('rx', item.shape === 'dot' ? 6 : 3);
        swatch.setAttribute('fill', item.color);
        svg.appendChild(swatch);
        svg.appendChild(textNode(item.label, item.x + 18, item.y, { size: 12, fill: '#3a3a3c' }));
    }

    // Recharts text inherits its font from page CSS; pin it so the file renders the same anywhere.
    svg.querySelectorAll('text').forEach((t) => {
        if (!t.getAttribute('font-family')) t.setAttribute('font-family', FONT);
    });

    return { markup: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`, width: totalWidth, height: totalHeight };
}

export function exportChartSvg(element, options) {
    const { markup } = buildChartSvg(element, options);
    downloadFile(`${safeName(options.filename)}.svg`, markup, 'image/svg+xml');
}

export function exportChartPng(element, options) {
    const { markup, width, height } = buildChartSvg(element, options);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width * PNG_SCALE;
            canvas.height = height * PNG_SCALE;
            const ctx = canvas.getContext('2d');
            ctx.scale(PNG_SCALE, PNG_SCALE);
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (!blob) return reject(new Error('Could not render the image.'));
                downloadBlob(`${safeName(options.filename)}.png`, blob);
                return resolve();
            }, 'image/png');
        };
        img.onerror = () => reject(new Error('Could not render the image.'));
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
}

export function exportChartCsv(rows, filename) {
    downloadFile(`${safeName(filename)}.csv`, Papa.unparse(rows), 'text/csv');
}
