// Small text utilities shared by the chunker, BM25 index and evaluator.

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other
  our ours ourselves out over own same she should so some such than that the their theirs them themselves then there
  these they this those through to too under until up very was we were what when where which while who whom why will
  with would you your yours yourself yourselves also may might must shall usually often e g eg ie etc p see table fig
  figure chapter page pdf one two use used using include includes including`.split(/\s+/)
);

/** Lower-case word tokens with light stemming (enough for BM25 + overlap metrics). */
export function tokenize(text) {
  const out = [];
  const words = String(text).toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
  for (const w of words) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Tiny suffix-stripping stemmer: maps "fractures/fractured/fracturing" -> "fractur". */
export function stem(w) {
  if (w.length <= 4 || /^\d/.test(w)) return w;
  return w
    .replace(/(ational|ization|fulness|iveness)$/, '')
    .replace(/(ies)$/, 'y')
    .replace(/(ing|edly|ed|es|ly|ment|ness|s)$/, '')
    .replace(/e$/, '');
}

/** Rough token estimate compatible with cl100k for English/medical prose (~4 chars per token). */
export function estimateTokens(text) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  return Math.max(Math.round(text.length / 4), Math.round(words * 1.25));
}

/** Split prose into sentences / bullet items. */
export function splitSentences(text) {
  return String(text)
    .replace(/\r/g, '')
    .split(/(?<=[.!?\]])(?<!\b(?:p|pp|vs|e\.g|i\.e|Dr|Fig|approx|al|No)\.)\s+(?=[A-Z0-9(•-])|\n+\s*(?:[-•*]|\d+[.)])\s+|\n{2,}/)
    .map((s) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim())
    .filter((s) => s.length > 0);
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

export function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function fmtBytes(b) {
  if (b == null) return '–';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

/** FNV-1a 32-bit hash, used to drop duplicate chunks. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function percentile(values, p) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}

export const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function fmtNum(n) {
  return n == null ? '–' : Number(n).toLocaleString();
}
