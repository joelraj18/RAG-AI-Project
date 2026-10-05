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

const BRACKET = /\[([^[\]]{1,160})\]/g;
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

/**
 * For each claim sentence: the share of its content words found in the best-matching
 * retrieved chunk. Fast, reproducible and free of the LLM judge's self-evaluation bias.
 */
export function supportAnalysis(answer, sources, threshold = 0.6) {
  const singleDoc = new Set(sources.map((s) => s.docId)).size <= 1;
  const src = sources.map((s) => ({ ...s, set: new Set(tokenize(s.text || '')) }));
  const all = new Set(src.flatMap((s) => [...s.set]));
  const rows = splitSentences(answer)
    .filter(isClaim)
    .map((s) => {
      const toks = [...new Set(tokenize(s.replace(CITE_STRIP, '')))];
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
      const misattributed = citedRatio != null && citedRatio < threshold / 2 && best.ratio >= threshold;
      return {
        text: s,
        plain: s.replace(CITE_STRIP, '').replace(/\s+([.,;])/g, '$1').trim(),
        ratio,
        page: best.page,
        docName: best.docName,
        key: best.key,
        citedRatio,
        misattributed,
        status: ratio >= threshold ? 'supported' : ratio >= threshold / 2 ? 'partial' : 'unsupported',
      };
    });
  const supported = rows.filter((r) => r.status === 'supported').length;
  const partial = rows.filter((r) => r.status === 'partial').length;
  const share = rows.length ? (supported + partial * 0.5) / rows.length : 0;
  const citedRows = rows.filter((r) => r.citedRatio != null);
  const citationAccuracy = citedRows.length ? citedRows.filter((r) => r.citedRatio >= threshold / 2).length / citedRows.length : null;
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
