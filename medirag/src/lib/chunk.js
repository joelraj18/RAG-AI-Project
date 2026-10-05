import { estimateTokens } from './text.js';

// Recursive splitter equivalent to LangChain's RecursiveCharacterTextSplitter
// (separators: paragraph -> line -> sentence -> word), sized in tokens like the
// notebook's from_tiktoken_encoder(chunk_size=400, chunk_overlap=50).

const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

function splitRecursive(text, size, seps) {
  if (estimateTokens(text) <= size) return [text];
  const [sep, ...rest] = seps;
  if (sep === undefined || sep === '') {
    const charSize = size * 4;
    const out = [];
    for (let i = 0; i < text.length; i += charSize) out.push(text.slice(i, i + charSize));
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
      // keep a tail of pieces as overlap
      while (cur.length && (curTok > overlap || curTok + t > size)) {
        curTok -= estimateTokens(cur[0]);
        cur.shift();
      }
    }
    cur.push(p);
    curTok += t;
  }
  if (cur.length) chunks.push(cur.join('').trim());
  return chunks.filter((c) => c.length > 0);
}

/** Chunk cleaned pages; every chunk keeps its source page number for citations. */
export function chunkPages(pages, { chunkSize = 400, chunkOverlap = 50, minTokens = 8 } = {}) {
  const chunks = [];
  for (const p of pages) {
    const pieces = splitRecursive(p.text, chunkSize, SEPARATORS);
    for (const text of merge(pieces, chunkSize, chunkOverlap)) {
      const tokens = estimateTokens(text);
      if (tokens < minTokens) continue;
      chunks.push({ id: chunks.length, page: p.page, text, tokens });
    }
  }
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
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    max: toks[toks.length - 1],
  };
}
