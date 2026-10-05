import { tokenize, splitSentences } from './text.js';
import { FALLBACK_ANSWER } from './prompts.js';

/** Extract the 1-5 score from a judge reply (same regex as the notebook's parse_score). */
export function parseScore(text) {
  const m =
    /Score\s*[:-]?\s*\**\s*([1-5])/i.exec(text || '') || /\b([1-5])\b/.exec(text || '');
  return m ? Number(m[1]) : null;
}

export function parseJustification(text) {
  const m = /Justification\s*[:-]?\s*([\s\S]*)/i.exec(text || '');
  return (m ? m[1] : text || '').trim();
}

const CITE_RE = /\[(?:PDF\s*)?p(?:age|g)?\.?\s*([\d,\s–-]+)\]/gi;

/** Pages cited in an answer, e.g. "[PDF p. 175]" or "[PDF p. 2402, 2403]". */
export function extractCitations(text) {
  const pages = new Set();
  for (const m of String(text).matchAll(CITE_RE)) {
    for (const part of m[1].split(/[,\s]+/)) {
      const range = part.split(/[–-]/).map(Number).filter(Boolean);
      if (range.length === 1) pages.add(range[0]);
      else if (range.length === 2 && range[1] - range[0] < 20)
        for (let p = range[0]; p <= range[1]; p++) pages.add(p);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function isClaim(s) {
  if (/^\s*#{1,6}\s/.test(s) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(s) || /:\s*$/.test(s)) return false; // headings
  const plain = s.replace(CITE_RE, '').replace(/[#*_`>]/g, '').trim();
  if (plain.length < 12) return false; // headings like "Treatment:" or "Sources"
  if (/^sources?\s*:/i.test(plain)) return false;
  return tokenize(plain).length >= 2;
}

/**
 * Deterministic, judge-free groundedness: for each claim sentence, the share of its
 * content words found in the best-matching retrieved chunk. Fast, reproducible and
 * immune to the self-evaluation bias the notebook flags for the LLM judge.
 */
export function supportAnalysis(answer, sources, threshold = 0.6) {
  const srcTokens = sources.map((s) => ({ page: s.page, set: new Set(tokenize(s.text)) }));
  const all = new Set(srcTokens.flatMap((s) => [...s.set]));
  const sentences = splitSentences(answer).filter(isClaim);
  const rows = sentences.map((s) => {
    const toks = [...new Set(tokenize(s.replace(CITE_RE, '')))];
    let best = { page: null, ratio: 0 };
    for (const src of srcTokens) {
      const hit = toks.filter((t) => src.set.has(t)).length / (toks.length || 1);
      if (hit > best.ratio) best = { page: src.page, ratio: hit };
    }
    const pooled = toks.filter((t) => all.has(t)).length / (toks.length || 1);
    const ratio = Math.max(best.ratio, pooled * 0.9);
    return {
      text: s,
      ratio,
      page: best.page,
      status: ratio >= threshold ? 'supported' : ratio >= threshold / 2 ? 'partial' : 'unsupported',
    };
  });
  const supported = rows.filter((r) => r.status === 'supported').length;
  const partial = rows.filter((r) => r.status === 'partial').length;
  const share = rows.length ? (supported + partial * 0.5) / rows.length : 0;
  return { rows, share, score: rows.length ? 1 + 4 * share : null };
}

/** Do the [PDF p. N] citations point at pages that were actually retrieved? */
export function citationCheck(answer, sources) {
  const cited = extractCitations(answer);
  const retrieved = new Set(sources.map((s) => s.page));
  const valid = cited.filter((p) => retrieved.has(p));
  const claimSentences = splitSentences(answer).filter(isClaim);
  const withCite = claimSentences.filter((s) => extractCitations(s).length).length;
  return {
    cited,
    valid,
    invalid: cited.filter((p) => !retrieved.has(p)),
    precision: cited.length ? valid.length / cited.length : null,
    coverage: claimSentences.length ? withCite / claimSentences.length : 0,
  };
}

/** Share of the question's content words that the answer touches (cheap relevance proxy). */
export function questionCoverage(question, answer) {
  const q = [...new Set(tokenize(question))];
  const a = new Set(tokenize(answer));
  if (!q.length) return null;
  return q.filter((t) => a.has(t)).length / q.length;
}

export function isFallback(answer) {
  return String(answer).toLowerCase().includes(FALLBACK_ANSWER.toLowerCase().slice(0, 60));
}

/** Run every judge-free metric for one answer. */
export function heuristicEvaluation({ question, answer, sources }) {
  const support = supportAnalysis(answer, sources);
  return {
    support,
    citations: citationCheck(answer, sources),
    coverage: questionCoverage(question, answer),
    fallback: isFallback(answer),
    retrieval: sources.length
      ? {
          topScore: Math.max(...sources.map((s) => s.score ?? 0)),
          pages: [...new Set(sources.map((s) => s.page))].sort((a, b) => a - b),
          contextTokens: sources.reduce((s, c) => s + (c.tokens || 0), 0),
        }
      : null,
  };
}
