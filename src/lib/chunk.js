import { estimateTokens, hashString } from './text.js';

// Recursive splitter equivalent to LangChain's RecursiveCharacterTextSplitter
// (paragraph -> line -> sentence -> word), sized in tokens like the notebook's
// from_tiktoken_encoder(chunk_size=400, chunk_overlap=50). On top of that:
//  - "## heading" lines become section titles carried by every chunk (also across pages)
//  - table-of-contents / index-like chunks and exact duplicates are dropped

const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];
const HEADING = /^##\s+(.+)$/;

function splitRecursive(text, size, seps) {
  if (estimateTokens(text) <= size) return [text];
  const [sep, ...rest] = seps;
  if (sep === undefined || sep === '') {
    const out = [];
    for (let i = 0; i < text.length; i += size * 4) out.push(text.slice(i, i + size * 4));
    return out;
  }
  const parts = text.split(sep);
  if (parts.length === 1) return splitRecursive(text, size, rest);
  const pieces = [];
  parts.forEach((p, i) => {
    const piece = i < parts.length - 1 ? p + sep : p;
    if (!piece.trim()) return;
    if (estimateTokens(piece) > size) pieces.push(...splitRecursive(piece, size, rest));
    else pieces.push(piece);
  });
  return pieces;
}

function merge(pieces, size, overlap) {
  const chunks = [];
  let cur = [];
  let curTok = 0;
  for (const p of pieces) {
    const t = estimateTokens(p);
    if (curTok + t > size && cur.length) {
      chunks.push(cur.join('').trim());
      while (cur.length && (curTok > overlap || curTok + t > size)) {
        curTok -= estimateTokens(cur[0]);
        cur.shift();
      }
    }
    cur.push(p);
    curTok += t;
  }
  if (cur.length) chunks.push(cur.join('').trim());
  return chunks.filter(Boolean);
}

/** Index-like text: dotted leaders or mostly numbers (tables of contents, indexes). */
export function isTocLike(text) {
  const leaders = (text.match(/\.{5,}|…{2,}|(?:\. ){4,}/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  return leaders >= 3 || digits / Math.max(1, text.length) > 0.3;
}

/** Split page text into segments that start at "## heading" lines. */
function segments(pageText, section) {
  const segs = [];
  let cur = { section, lines: [] };
  for (const line of pageText.split('\n')) {
    const h = HEADING.exec(line.trim());
    if (h) {
      if (cur.lines.join('').trim()) segs.push(cur);
      cur = { section: h[1].trim().slice(0, 120), lines: [] }; // title kept as metadata, not repeated in text
    } else cur.lines.push(line);
  }
  if (cur.lines.join('').trim()) segs.push(cur);
  return { segs, section: cur.section };
}

/** Chunk cleaned pages. Each chunk keeps its page number (for citations) and section. */
export function chunkPages(pages, { chunkSize = 400, chunkOverlap = 50, minTokens = 8 } = {}) {
  const chunks = [];
  const seen = new Set();
  let section = '';
  let dropped = 0;
  for (const p of pages) {
    const r = segments(p.text, section);
    section = r.section;
    for (const seg of r.segs) {
      const text = seg.lines.join('\n');
      for (const c of merge(splitRecursive(text, chunkSize, SEPARATORS), chunkSize, chunkOverlap)) {
        const tokens = estimateTokens(c);
        const h = hashString(c.replace(/\s+/g, ' ').toLowerCase());
        if (tokens < minTokens || isTocLike(c) || seen.has(h)) {
          dropped++;
          continue;
        }
        seen.add(h);
        chunks.push({ id: chunks.length, page: p.page, section: seg.section || '', text: c, tokens });
      }
    }
  }
  chunks.dropped = dropped;
  return chunks;
}

export function describeChunks(chunks) {
  if (!chunks.length) return { count: 0 };
  const toks = chunks.map((c) => c.tokens).sort((a, b) => a - b);
  const q = (f) => toks[Math.min(toks.length - 1, Math.floor(f * toks.length))];
  return {
    count: chunks.length,
    mean: Math.round(toks.reduce((s, t) => s + t, 0) / toks.length),
    min: toks[0],
    median: q(0.5),
    max: toks[toks.length - 1],
    sections: new Set(chunks.map((c) => c.section).filter(Boolean)).size,
    dropped: chunks.dropped || 0,
  };
}

/** Text that is embedded for a chunk: contextual header (doc › section) + body. */
export function embeddingText(docName, chunk) {
  const head = [docName, chunk.section].filter(Boolean).join(' › ');
  return head ? `${head}\n${chunk.text}` : chunk.text;
}
