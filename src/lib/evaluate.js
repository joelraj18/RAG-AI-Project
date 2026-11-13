import { tokenize, splitSentences } from './text.js';
import { FALLBACK_ANSWER } from './prompts.js';

// ---------------- judge output parsing ----------------

/** Extract a 1-5 score (same regex as the notebook's parse_score). */
export function parseScore(text) {
  const m = /Score\s*[:-]?\s*\**\s*([1-5])/i.exec(text || '') || /\b([1-5])\b/.exec(text || '');
  return m ? Number(m[1]) : null;
}

export function parseJustification(text) {
  const m = /Justification\s*[:-]?\s*([\s\S]*)/i.exec(text || '');
  return (m ? m[1] : text || '').trim();
}

/** Parse the combined judge's JSON; tolerate code fences, prose and missing keys. */
export function parseCombinedJudge(text) {
  const raw = String(text || '');
  let obj = null;
  const m = /\{[\s\S]*\}/.exec(raw);
  if (m) {
    try {
      obj = JSON.parse(m[0]);
    } catch {
      obj = null;
    }
  }
  const num = (key) => {
    const v = obj?.[key] ?? new RegExp(`"?${key}"?\\s*[:=]\\s*"?([1-5])`, 'i').exec(raw)?.[1];
    const n = Number(v);
    return n >= 1 && n <= 5 ? Math.round(n) : null;
  };
  const list = (key) => (Array.isArray(obj?.[key]) ? obj[key].filter((x) => typeof x === 'string' && x.trim()) : []);
  return {
    groundedness: num('groundedness'),
    relevance: num('relevance'),
    contextRelevance: num('context_relevance'),
    unsupported: list('unsupported_claims'),
    missing: list('missing_parts'),
    justification: typeof obj?.justification === 'string' ? obj.justification : obj ? '' : raw.slice(0, 400),
  };
}

// ---------------- citations ----------------

const BRACKET = /\[([^[\]]{1,800})\]/g; // long enough for multi-document "Sources: […]" lists
const REF = /^(.*?)[\s,]*\bp(?:age|g|p)?\.?\s*(\d[\d,\s–-]*)$/i;
/** Matches a citation bracket, used to strip citations from claim text. */
export const CITE_STRIP = /\[[^[\]]*?\bp(?:age|g|p)?\.?\s*\d[^[\]]*\]/gi;

function expandPages(s) {
  const pages = [];
  for (const part of s.split(/[,\s]+/).filter(Boolean)) {
    const r = part.split(/[–-]/).map(Number).filter(Boolean);
    if (r.length === 1) pages.push(r[0]);
    else if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 20) for (let p = r[0]; p <= r[1]; p++) pages.push(p);
  }
  return pages;
}

/** "[Doc A p. 3; Doc B p. 10-11]" -> [{name:'Doc A', page:3}, {name:'Doc B', page:10}, …] */
export function parseCitations(text) {
  const out = [];
  for (const m of String(text).matchAll(BRACKET)) {
    for (const part of m[1].split(';')) {
      const r = REF.exec(part.trim());
      if (!r) continue;
      const name = r[1].replace(/^(?:PDF|source|doc(?:ument)?)$/i, '').trim();
      for (const page of expandPages(r[2])) out.push({ name, page });
    }
  }
  return out;
}

/** Unique cited page numbers (kept for simple single-document use). */
export function extractCitations(text) {
  return [...new Set(parseCitations(text).map((c) => c.page))].sort((a, b) => a - b);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Does a parsed citation point at this source? Names match loosely (prefix either way). */
export function citeMatches(cite, source, singleDoc) {
  if (cite.page !== source.page) return false;
  if (!cite.name || singleDoc) return true;
  const a = norm(cite.name);
  const b = norm(source.docName);
  return !!a && !!b && (a.startsWith(b) || b.startsWith(a));
}

export function citationCheck(answer, sources) {
  const singleDoc = new Set(sources.map((s) => s.docId)).size <= 1;
  const cites = parseCitations(answer);
  const key = (c) => `${norm(c.name)}|${c.page}`;
  const uniq = [...new Map(cites.map((c) => [key(c), c])).values()];
  const valid = uniq.filter((c) => sources.some((s) => citeMatches(c, s, singleDoc)));
  const invalid = uniq.filter((c) => !valid.includes(c));
  const claims = splitSentences(answer).filter(isClaim);
  const withCite = claims.filter((s) => parseCitations(s).length).length;
  return {
    cited: uniq,
    valid,
    invalid,
    precision: uniq.length ? valid.length / uniq.length : null,
    coverage: claims.length ? withCite / claims.length : 0,
  };
}

// ---------------- claim support (judge-free groundedness) ----------------

function isClaim(s) {
  if (/^\s*#{1,6}\s/.test(s) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(s) || /:\s*$/.test(s)) return false;
  const plain = s.replace(CITE_STRIP, '').replace(/[#*_`>]/g, '').trim();
  if (plain.length < 12 || /^sources?\s*:/i.test(plain)) return false;
  return tokenize(plain).length >= 2;
}

// ---------- fact and contradiction checks used by claim support ----------

const fold = (t) => String(t).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const NUMBER = /\d+(?:[.,]\d+)*/g;
// digits glued to a preceding letter belong to a name (Dscam1, CD4, SREBP2), not a quantity
const QUANTITY = /(?<![\p{L}\d.,])\d+(?:[.,]\d+)*/gu;
/**
 * Numbers in a text, normalised ("1,000" -> "1000"). With `quantities: true` only stand-alone
 * numbers count (a claim's "Dscam1" is a name; "BRCA 1" still matches a source's "BRCA1").
 */
export const numbersOf = (t, { quantities = false } = {}) => (fold(t).match(quantities ? QUANTITY : NUMBER) || []).map((n) => n.replace(/,(?=\d{3}(?!\d))/g, ''));
/**
 * Words of the source for name checks: plain words, hyphenated compounds joined (SREBP-2 -> srebp2)
 * and the letter part of letter-digit words (BRCA1 -> brca), so a name written another way counts.
 */
function nameWords(text) {
  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}]+/gu) || [];
  const set = new Set(words);
  for (const m of lower.matchAll(/[\p{L}\p{N}]+(?:[-\u2010\u2013/][\p{L}\p{N}]+)+/gu)) set.add(m[0].replace(/[^\p{L}\p{N}]/gu, ''));
  for (const w of words) {
    const letters = w.replace(/\d+$/, '');
    if (letters.length >= 3) set.add(letters);
  }
  return set;
}
const nameIn = (name, words) => words.has(name) || words.has(name.replace(/\d+$/, ''));
const NAME_STOP = new Set('the a an this that these those it its in on at for and or but if when while after before during with by from to of as is are was were be sources source note yes no however also both each such'.split(' '));
/**
 * Names and acronyms in a claim: capitalised words that do not start a sentence, and all-caps terms.
 * A capitalised first word is skipped because it cannot be told apart from an ordinary sentence opener.
 */
export function namesOf(text) {
  const words = fold(text).replace(/[*_`#>"“”()[\]]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const start = i === 0 || /[.:;!?]$/.test(prev) || /^(?:[-•]|\d+[.)])$/.test(prev);
    // segments split the same way as the source text (Tesla's -> tesla, Mercedes-Benz -> mercedes, benz)
    const segs = w.replace(/['’]s\b/gi, '').match(/[\p{L}\p{N}]+/gu) || [];
    segs.forEach((seg, j) => {
      const acronym = /^[A-Z][A-Z0-9]+$/.test(seg);
      const proper = /^[A-Z][a-z]/.test(seg);
      if (seg.length < 3 || NAME_STOP.has(seg.toLowerCase())) return;
      if (acronym || (proper && !(start && j === 0))) out.add(seg.toLowerCase());
    });
  });
  return [...out];
}
const NEGATION = /\b(?:not|no|never|none|neither|nor|cannot|without|fails?|failed|lacks?|lacking|absence|absent|unable)\b|n't\b/i;
const UP = /\b(?:increas\w*|higher|greater|more|rais\w*|elevat\w*|enhanc\w*|improv\w*|promot\w*|activat\w*|induc\w*|stimulat\w*)\b/i;
const DOWN = /\b(?:decreas\w*|lower|less|fewer|reduc\w*|diminish\w*|inhibit\w*|suppress\w*|impair\w*|worsen\w*|attenuat\w*)\b/i;
const direction = (t) => {
  const u = UP.test(t);
  const d = DOWN.test(t);
  return u && !d ? 1 : d && !u ? -1 : 0;
};

/**
 * For each claim sentence: the share of its content words found in the best-matching retrieved
 * chunk, then two checks that word overlap alone misses (a sentence with one wrong number still
 * shares about 90% of its words with the source):
 *  - facts: numbers and names in the claim must appear in the retrieved text;
 *  - conflicts: negation or direction ("increases" vs "decreases") must agree with the source
 *    sentence that matches the claim best.
 * Fast, reproducible and free of the LLM judge's self-evaluation bias.
 */
// a claim's cited passage must hold at least this share of its words to count as the right citation
const CITE_MIN = 0.3;

export function supportAnalysis(answer, sources, threshold = 0.6, { facts = true, conflicts = true } = {}) {
  const singleDoc = new Set(sources.map((s) => s.docId)).size <= 1;
  const src = sources.map((s) => ({ ...s, set: new Set(tokenize(s.text || '')) }));
  const all = new Set(src.flatMap((s) => [...s.set]));
  const pooledText = fold(src.map((s) => s.text || '').join(' '));
  const srcNumbers = new Set(numbersOf(pooledText));
  const srcWords = nameWords(pooledText);
  let sentences = null; // split lazily: only needed when a claim could conflict
  const rows = splitSentences(answer)
    .filter(isClaim)
    .map((s) => {
      const plainText = s.replace(CITE_STRIP, '');
      const toks = [...new Set(tokenize(plainText))];
      const ratioIn = (x) => toks.filter((t) => x.set.has(t)).length / (toks.length || 1);
      let best = { ratio: 0 };
      for (const x of src) {
        const hit = ratioIn(x);
        if (hit > best.ratio) best = { ratio: hit, page: x.page, docName: x.docName, key: x.key };
      }
      const pooled = toks.filter((t) => all.has(t)).length / (toks.length || 1);
      const ratio = Math.max(best.ratio, pooled * 0.9);
      // citation accuracy: does the passage the claim cites actually contain it?
      const cites = parseCitations(s);
      const cited = src.filter((x) => cites.some((c) => citeMatches(c, x, singleDoc)));
      const citedRatio = cited.length ? Math.max(...cited.map(ratioIn)) : null;
      const misattributed = citedRatio != null && citedRatio < CITE_MIN && best.ratio >= threshold;
      let status = ratio >= threshold ? 'supported' : ratio >= threshold / 2 ? 'partial' : 'unsupported';
      const missing = facts ? [...numbersOf(plainText, { quantities: true }).filter((n) => !srcNumbers.has(n)), ...namesOf(plainText).filter((n) => !nameIn(n, srcWords))] : [];
      let conflict = null;
      if (conflicts && status === 'supported') {
        sentences ||= src.flatMap((x) => splitSentences(x.text || '').map((t) => ({ t, set: new Set(tokenize(t)) })));
        let match = null;
        let top = 0;
        for (const x of sentences) {
          const r = ratioIn(x);
          if (r > top) [top, match] = [r, x.t];
        }
        if (match && top >= 0.5) {
          if (NEGATION.test(plainText) !== NEGATION.test(match)) conflict = 'negation';
          else if (direction(plainText) * direction(match) < 0) conflict = 'direction';
        }
      }
      if (missing.length >= 2) status = 'unsupported';
      else if ((missing.length === 1 || conflict) && status === 'supported') status = 'partial';
      return {
        text: s,
        plain: plainText.replace(/\s+([.,;])/g, '$1').trim(),
        ratio,
        page: best.page,
        docName: best.docName,
        key: best.key,
        citedRatio,
        misattributed,
        missing,
        conflict,
        status,
      };
    });
  const supported = rows.filter((r) => r.status === 'supported').length;
  const partial = rows.filter((r) => r.status === 'partial').length;
  const share = rows.length ? (supported + partial * 0.5) / rows.length : 0;
  const citedRows = rows.filter((r) => r.citedRatio != null);
  const citationAccuracy = citedRows.length ? citedRows.filter((r) => r.citedRatio >= CITE_MIN).length / citedRows.length : null;
  return { rows, share, score: rows.length ? 1 + 4 * share : null, citationAccuracy, misattributed: rows.filter((r) => r.misattributed).length };
}

export function questionCoverage(question, answer) {
  const q = [...new Set(tokenize(question))];
  const a = new Set(tokenize(answer));
  return q.length ? q.filter((t) => a.has(t)).length / q.length : null;
}

export const isFallback = (answer) => String(answer).toLowerCase().includes(FALLBACK_ANSWER.toLowerCase().slice(0, 50));

/** Share of the retrieved (non-neighbour) chunks whose page the answer actually cites. */
export function contextUtilization(answer, sources) {
  const primary = sources.filter((s) => !s.neighbor);
  if (!primary.length) return null;
  const singleDoc = new Set(sources.map((s) => s.docId)).size <= 1;
  const cites = parseCitations(answer);
  return primary.filter((s) => cites.some((c) => citeMatches(c, s, singleDoc))).length / primary.length;
}

export function heuristicEvaluation({ question, answer, sources }) {
  return {
    support: supportAnalysis(answer, sources),
    citations: citationCheck(answer, sources),
    coverage: questionCoverage(question, answer),
    utilization: contextUtilization(answer, sources),
    fallback: isFallback(answer),
  };
}

/** Overall confidence from every available signal; shown as a High/Medium/Low badge. */
export function confidence(ev, sources = []) {
  if (!ev?.heuristic) return null;
  const h = ev.heuristic;
  const j = ev.judge;
  if (h.fallback) return { level: 'Low', score: 0, reasons: ['The documents did not contain an answer.'] };
  const parts = [];
  const reasons = [];
  if (j?.groundedness != null) parts.push([j.groundedness / 5, 0.35]);
  if (h.support.rows.length) parts.push([h.support.share, 0.3]);
  if (h.citations.precision != null) parts.push([h.citations.precision * (h.support.citationAccuracy ?? 1), 0.15]);
  else reasons.push('No citations in the answer.');
  if (j?.contextRelevance != null) parts.push([j.contextRelevance / 5, 0.1]);
  if (j?.relevance != null) parts.push([j.relevance / 5, 0.1]);
  else if (h.coverage != null) parts.push([h.coverage, 0.1]);
  const w = parts.reduce((s, [, x]) => s + x, 0) || 1;
  const score = parts.reduce((s, [v, x]) => s + v * x, 0) / w;
  if (h.support.rows.some((r) => r.status === 'unsupported')) reasons.push('Some claims were not found in the retrieved text.');
  if (h.citations.invalid.length) reasons.push('Some citations point to pages that were not retrieved.');
  if (h.support.misattributed) reasons.push(`${h.support.misattributed} claim(s) cite a passage that does not contain them.`);
  if (j?.groundedness != null && j.groundedness <= 3) reasons.push(`Judge groundedness ${j.groundedness}/5.`);
  if (sources.length && Math.max(...sources.map((s) => s.scores?.cosine ?? 1)) < 0.75) reasons.push('Retrieved passages are only weakly similar to the question.');
  return { level: score >= 0.8 ? 'High' : score >= 0.6 ? 'Medium' : 'Low', score, reasons };
}

// ---------------- retrieval accuracy (Evaluation Lab) ----------------

/** "12, 15-16" or "Guide p. 4; Manual p. 9" -> [{name, page}] */
export function parseExpected(s) {
  if (!s || !s.trim()) return [];
  const asCites = parseCitations(`[${s.replace(/\]/g, '')}]`);
  if (asCites.length) return asCites;
  return expandPages(s.replace(/p\.?/gi, '')).map((page) => ({ name: '', page }));
}

/** hit@k, recall@k and reciprocal rank of the expected pages within retrieved sources. */
export function retrievalMetrics(sources, expected) {
  if (!expected?.length) return null;
  const primary = sources.filter((s) => !s.neighbor);
  const singleDoc = new Set(primary.map((s) => s.docId)).size <= 1;
  let firstRank = null;
  primary.forEach((s, i) => {
    if (firstRank == null && expected.some((e) => citeMatches(e, s, singleDoc))) firstRank = i + 1;
  });
  const found = expected.filter((e) => primary.some((s) => citeMatches(e, s, singleDoc))).length;
  return { hit: firstRank != null ? 1 : 0, recall: found / expected.length, rr: firstRank ? 1 / firstRank : 0, firstRank };
}

/** Map a clicked citation to { docId, page, keys } using the answer's sources. */
export function resolveCitation(cite, sources, docs = []) {
  const singleDoc = new Set(sources.map((s) => s.docId)).size <= 1;
  const hits = sources.filter((s) => citeMatches(cite, s, singleDoc));
  if (hits.length) return { docId: hits[0].docId, page: cite.page, keys: hits.map((h) => h.key) };
  const byName = cite.name && docs.find((d) => norm(d.name).startsWith(norm(cite.name)) || norm(cite.name).startsWith(norm(d.name)));
  const docId = byName?.id || sources[0]?.docId || docs[0]?.id;
  return docId ? { docId, page: cite.page, keys: [] } : null;
}
