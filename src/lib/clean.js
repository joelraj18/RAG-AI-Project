import { estimateTokens } from './text.js';

// Mirrors the notebook's cleaning step, but generalised: instead of hard-coding the
// licence watermark, any line that repeats on a large share of pages (watermarks,
// running headers/footers, licence codes) is detected and removed automatically.

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const LEGAL = [
  /This file is meant for personal use by \S+ only\.?/gi,
  /Sharing or publishing the contents in part or full is liable for legal action\.?/gi,
];

function normLine(l) {
  return l.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}

/** Find lines that appear on >= minShare of pages (and at least 3 pages). */
export function detectBoilerplate(pages, minShare = 0.3) {
  const counts = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const raw of p.text.split('\n')) {
      const l = normLine(raw);
      if (l.length < 4 || l.length > 160 || seen.has(l)) continue;
      seen.add(l);
      counts.set(l, (counts.get(l) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * minShare));
  return new Set([...counts].filter(([, c]) => c >= threshold).map(([l]) => l));
}

export function cleanPageText(text, boiler) {
  let t = text;
  for (const re of LEGAL) t = t.replace(re, ' ');
  t = t
    .split('\n')
    .filter((line) => !boiler.has(normLine(line)))
    .join('\n');
  t = t.replace(EMAIL, ' ');
  t = t.replace(/-\n(?=[a-z])/g, ''); // re-join hyphenated line breaks
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n\s*\n+/g, '\n\n');
  return t.trim();
}

/** Clean all pages. Returns cleaned pages plus stats shown in the UI. */
export function cleanPages(pages, { minShare = 0.3, minChars = 50 } = {}) {
  const boiler = pages.length >= 5 ? detectBoilerplate(pages, minShare) : new Set();
  const before = pages.reduce((s, p) => s + p.text.length, 0);
  const cleaned = pages
    .map((p) => ({ page: p.page, text: cleanPageText(p.text, boiler) }))
    .filter((p) => p.text.length > minChars);
  const after = cleaned.reduce((s, p) => s + p.text.length, 0);
  return {
    pages: cleaned,
    stats: {
      pagesIn: pages.length,
      pagesKept: cleaned.length,
      charsBefore: before,
      charsRemoved: before - after,
      removedShare: before ? (before - after) / before : 0,
      boilerplateLines: [...boiler].slice(0, 20),
      tokens: cleaned.reduce((s, p) => s + estimateTokens(p.text), 0),
    },
  };
}
