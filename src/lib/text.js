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

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const NON_ASCII = /[^\x00-\x7f]/;

/**
 * Lower-case, stemmed word tokens (used by BM25, claim support and extractive answers).
 * Accents are folded (café -> cafe, ß -> ss), possessives dropped (McBurney's -> mcburney), and a
 * hyphenated term is indexed both joined and as its parts (IL-6 -> il6, il, 6), so the spaced,
 * joined and hyphenated spellings all match.
 */
export function tokenize(text) {
  let t = String(text);
  if (NON_ASCII.test(t)) t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00df/g, 'ss');
  const out = [];
  const add = (w) => {
    if (w.length >= 2 && !STOPWORDS.has(w)) out.push(stem(w));
  };
  for (let w of t.toLowerCase().match(WORD) || []) {
    if (w.includes("'") || w.includes('’')) w = w.replace(/['’]s$/, '').replace(/['’]/g, '');
    if (w.includes('-')) {
      const parts = w.split('-');
      add(parts.join(''));
      parts.forEach(add);
    } else add(w);
  }
  return out;
}

const stems = new Map();
/** Porter stemmer (M. F. Porter, 1980), memoised. Numbers are left as they are. */
export function stem(w) {
  if (w.length <= 2 || /^\d/.test(w)) return w;
  let s = stems.get(w);
  if (s === undefined) {
    s = porter(w);
    if (stems.size > 200000) stems.clear();
    stems.set(w, s);
  }
  return s;
}

const isCons = (w, i) => {
  const c = w[i];
  if (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u') return false;
  return c === 'y' ? i === 0 || !isCons(w, i - 1) : true;
};
/** m: the number of vowel-consonant sequences in a stem. */
function measure(s) {
  let n = 0;
  let i = 0;
  while (i < s.length && isCons(s, i)) i++;
  while (i < s.length) {
    while (i < s.length && !isCons(s, i)) i++;
    if (i >= s.length) break;
    while (i < s.length && isCons(s, i)) i++;
    n++;
  }
  return n;
}
const hasVowel = (s) => {
  for (let i = 0; i < s.length; i++) if (!isCons(s, i)) return true;
  return false;
};
const doubleCons = (s) => s.length >= 2 && s[s.length - 1] === s[s.length - 2] && isCons(s, s.length - 1);
const cvc = (s) => {
  const n = s.length;
  return n >= 3 && isCons(s, n - 1) && !isCons(s, n - 2) && isCons(s, n - 3) && !'wxy'.includes(s[n - 1]);
};

const STEP2 = [['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'], ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble']];
const STEP3 = [['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', '']];
const STEP4 = ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'];

/** The first listed suffix that matches decides (as in Porter's reference implementation). */
function replaceSuffix(w, rules, minM) {
  let best = null;
  for (const r of rules) if (w.endsWith(r[0]) && (!best || r[0].length > best[0].length)) best = r;
  if (!best) return w;
  const stemPart = w.slice(0, -best[0].length);
  return measure(stemPart) > minM ? stemPart + best[1] : w;
}

function porter(word) {
  let w = word;
  // step 1a: plurals
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ies')) w = w.slice(0, -2);
  else if (!w.endsWith('ss') && w.endsWith('s')) w = w.slice(0, -1);
  // step 1b: -eed, -ed, -ing
  if (w.endsWith('eed')) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else {
    const suf = w.endsWith('ed') ? 'ed' : w.endsWith('ing') ? 'ing' : null;
    if (suf && hasVowel(w.slice(0, -suf.length))) {
      w = w.slice(0, -suf.length);
      if (w.endsWith('at') || w.endsWith('bl') || w.endsWith('iz')) w += 'e';
      else if (doubleCons(w) && !/[lsz]$/.test(w)) w = w.slice(0, -1);
      else if (measure(w) === 1 && cvc(w)) w += 'e';
    }
  }
  // step 1c: y -> i
  if (w.endsWith('y') && hasVowel(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;
  // steps 2-4: derivational suffixes
  w = replaceSuffix(w, STEP2, 0);
  w = replaceSuffix(w, STEP3, 0);
  for (const suf of STEP4.filter((x) => w.endsWith(x)).sort((a, b) => b.length - a.length).slice(0, 1)) {
    const stemPart = w.slice(0, -suf.length);
    if (measure(stemPart) > 1 && (suf !== 'ion' || /[st]$/.test(stemPart))) w = stemPart;
  }
  // step 5: final -e and -ll
  if (w.endsWith('e')) {
    const stemPart = w.slice(0, -1);
    const m = measure(stemPart);
    if (m > 1 || (m === 1 && !cvc(stemPart))) w = stemPart;
  }
  if (w.endsWith('ll') && measure(w) > 1) w = w.slice(0, -1);
  return w;
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
