import { describe, it, expect } from 'vitest';
import { cleanPages } from '../clean.js';
import { chunkPages, isTocLike, embeddingText } from '../chunk.js';
import { buildBM25, searchBM25 } from '../bm25.js';
import { quantize, dequantizeRow, cosine } from '../quant.js';
import { topK } from '../topk.js';
import { searchVectors, rrf } from '../vector.js';
import { retrieve, formatContext } from '../retrieve.js';
import {
  parseScore,
  parseCombinedJudge,
  parseCitations,
  extractCitations,
  supportAnalysis,
  citationCheck,
  heuristicEvaluation,
  confidence,
  parseExpected,
  retrievalMetrics,
  resolveCitation,
} from '../evaluate.js';
import { extractiveAnswer } from '../llm.js';
import { slimRecord, hydrateRecord, systemPrompt } from '../pipeline.js';
import { paginate, loadText } from '../loaders/text.js';
import { MEDICAL_DEMO_TEXT, RAG_GUIDE_TEXT } from '../demo.js';
import { DEFAULT_SETTINGS } from '../settings.js';

const watermark = (text) =>
  text.split('\f').map((t, i) => ({ page: i + 1, text: `someone@example.com\nABCD123XYZ\nHandbook Running Header\n${t}` }));

const makeKb = (text, opts = { chunkSize: 120, chunkOverlap: 20 }) => {
  const chunks = chunkPages(cleanPages(watermark(text)).pages, opts);
  return { chunks, bm25: buildBM25(chunks), vectors: null };
};

describe('cleaning', () => {
  it('removes repeated watermark lines and e-mails', () => {
    const { pages, stats } = cleanPages(watermark(MEDICAL_DEMO_TEXT));
    expect(pages).toHaveLength(6);
    expect(pages[0].text).not.toMatch(/Running Header|example\.com|ABCD123XYZ/);
    expect(stats.removedShare).toBeGreaterThan(0);
  });
});

describe('chunking', () => {
  const kb = makeKb(MEDICAL_DEMO_TEXT);
  it('keeps page numbers, sections and size limits', () => {
    expect(kb.chunks.length).toBeGreaterThan(6);
    expect(kb.chunks.every((c) => c.page >= 1 && c.page <= 6)).toBe(true);
    expect(Math.max(...kb.chunks.map((c) => c.tokens))).toBeLessThanOrEqual(140);
    expect(kb.chunks.find((c) => c.page === 3).section).toBe('Appendicitis');
  });
  it('carries a section across page breaks and builds contextual embedding text', () => {
    const chunks = chunkPages([
      { page: 1, text: '## Alpha topic\nFirst page text about alpha that is long enough to be a chunk.' },
      { page: 2, text: 'Continuation of alpha on the next page with enough words to count.' },
    ]);
    expect(chunks[1].section).toBe('Alpha topic');
    expect(embeddingText('Doc', chunks[1])).toMatch(/^Doc › Alpha topic\n/);
  });
  it('drops table-of-contents chunks and exact duplicates', () => {
    expect(isTocLike('Chapter 1 ........ 12\nChapter 2 ........ 19\nChapter 3 ........ 27')).toBe(true);
    const dup = 'Repeated paragraph that appears on two pages of the same document verbatim.';
    const chunks = chunkPages([
      { page: 1, text: dup },
      { page: 2, text: dup },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks.dropped).toBe(1);
  });
});

describe('BM25', () => {
  const kb = makeKb(MEDICAL_DEMO_TEXT);
  const top = (q) => kb.chunks[searchBM25(kb.bm25, q, 1)[0].idx].page;
  it('retrieves the right page', () => {
    expect(top('appendectomy surgery for appendicitis')).toBe(3);
    expect(top('patchy hair loss bald spots on the scalp')).toBe(4);
    expect(top('vasopressor norepinephrine sepsis')).toBe(2);
  });
  it('matches through section titles', () => {
    expect(top('traumatic brain injury')).toBe(5);
  });
});

describe('int8 vectors and top-k', () => {
  const dim = 64;
  const n = 300;
  const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const r = rnd(42);
  const f32 = new Float32Array(n * dim).map(() => r());
  for (let i = 0; i < n; i++) {
    let norm = 0;
    for (let j = 0; j < dim; j++) norm += f32[i * dim + j] ** 2;
    for (let j = 0; j < dim; j++) f32[i * dim + j] /= Math.sqrt(norm);
  }
  const { q, scales } = quantize(f32, dim);
  const index = { q, scales, dim, count: n };
  it('quantisation keeps cosine error below 0.01 and is 4x smaller', () => {
    for (const row of [0, 17, 299]) {
      const orig = f32.subarray(row * dim, (row + 1) * dim);
      expect(1 - cosine(orig, dequantizeRow(q, scales, dim, row))).toBeLessThan(0.01);
    }
    expect(q.byteLength * 4).toBe(f32.byteLength);
  });
  it('heap top-k equals a full sort', () => {
    const vals = Array.from({ length: 1000 }, (_, i) => Math.sin(i * 7.1));
    const expected = vals.map((v, i) => ({ idx: i, score: v })).sort((a, b) => b.score - a.score).slice(0, 10);
    expect(topK(vals.length, 10, (i) => vals[i]).map((x) => x.idx)).toEqual(expected.map((x) => x.idx));
  });
  it('int8 search finds the query row first', () => {
    const query = f32.slice(5 * dim, 6 * dim);
    expect(searchVectors(index, query, 3)[0].idx).toBe(5);
  });
  it('rrf fuses by key', () => {
    const f = rrf([[{ key: 'a:1', score: 0.9 }, { key: 'b:2', score: 0.5 }], [{ key: 'b:2', score: 9 }, { key: 'a:3', score: 1 }]], 60, (x) => x.key);
    expect(f[0].key).toBe('b:2');
  });
});

describe('multi-document retrieval', () => {
  const med = { doc: { id: 'm', name: 'Clinical Handbook', embedModel: 'x' }, kb: makeKb(MEDICAL_DEMO_TEXT) };
  const guide = { doc: { id: 'g', name: 'RAG Guide', embedModel: 'x' }, kb: makeKb(RAG_GUIDE_TEXT) };
  it('searches all documents, keeps doc ids and labels the context', async () => {
    const r1 = await retrieve([med, guide], 'appendicitis appendectomy', { mode: 'hybrid', k: 2 });
    expect(r1.effectiveMode).toBe('bm25'); // no vectors yet -> keyword fallback
    expect(r1.sources[0].docId).toBe('m');
    const r2 = await retrieve([med, guide], 'reciprocal rank fusion hybrid search', { k: 2 });
    expect(r2.sources[0].docName).toBe('RAG Guide');
    expect(formatContext(r2.sources)).toMatch(/^\[RAG Guide p\. \d+\]/);
  });
  it('neighbour expansion adds adjacent chunks of the same section', async () => {
    const r = await retrieve([med], 'appendicitis treatment appendectomy', { mode: 'bm25', k: 1, neighbors: true, contextBudget: 2000 });
    expect(r.sources.some((s) => s.neighbor)).toBe(true);
  });
});

describe('evaluation', () => {
  it('parses notebook-style and combined JSON judge output', () => {
    expect(parseScore('Score: 4\nJustification: ok')).toBe(4);
    expect(parseScore('nothing')).toBeNull();
    const j = parseCombinedJudge('```json\n{"groundedness": 4, "relevance": 5, "context_relevance": 3, "unsupported_claims": ["x"], "justification": "fine"}\n```');
    expect(j).toMatchObject({ groundedness: 4, relevance: 5, contextRelevance: 3, unsupported: ['x'], justification: 'fine' });
    expect(parseCombinedJudge('groundedness: 2, relevance: 3').groundedness).toBe(2);
  });
  it('parses citations with document names and ranges', () => {
    expect(parseCitations('a [Guide p. 3; Manual p. 10-11] b [PDF p. 7]')).toEqual([
      { name: 'Guide', page: 3 },
      { name: 'Manual', page: 10 },
      { name: 'Manual', page: 11 },
      { name: '', page: 7 },
    ]);
    expect(extractCitations('x [p. 2402, 2403]')).toEqual([2402, 2403]);
  });
  const sources = [
    { key: 'm:1', docId: 'm', docName: 'Handbook', page: 3, text: 'The standard treatment is surgical removal of the appendix (appendectomy), performed by open or laparoscopic technique.', tokens: 30, score: 1 },
    { key: 'g:4', docId: 'g', docName: 'Guide', page: 6, text: 'Hybrid search merges BM25 and semantic rankings with Reciprocal Rank Fusion.', tokens: 20, score: 0.8 },
  ];
  it('flags unsupported claims and invalid / wrong-document citations', () => {
    const a = supportAnalysis('- Treatment is laparoscopic or open appendectomy [Handbook p. 3]\n- Drinking herbal tea dissolves the inflamed organ quickly [Handbook p. 9]', sources);
    expect(a.rows.map((r) => r.status)).toEqual(['supported', 'unsupported']);
    const c = citationCheck('- open appendectomy [Handbook p. 3]\n- fusion of rankings [Handbook p. 6]', sources);
    expect(c.invalid).toEqual([{ name: 'Handbook', page: 6 }]); // page 6 belongs to Guide
    expect(c.precision).toBe(0.5);
    expect(citationCheck('Give fluids within 3 hours [Handbook p. 3]. Start antibiotics early [Handbook p. 3]', sources).coverage).toBe(1);
  });
  it('detects claims that cite the wrong passage', () => {
    const a = supportAnalysis('- Hybrid search merges BM25 and semantic rankings with Reciprocal Rank Fusion [Handbook p. 3]', sources);
    expect(a.rows[0].status).toBe('supported');
    expect(a.rows[0].misattributed).toBe(true);
    expect(a.citationAccuracy).toBe(0);
    expect(a.rows[0].plain).not.toMatch(/\[/);
  });
  it('resolves a clicked citation to the right document', () => {
    expect(resolveCitation({ name: 'Guide', page: 6 }, sources)).toMatchObject({ docId: 'g', page: 6, keys: ['g:4'] });
  });
  it('extractive answers are fully supported and highly confident', () => {
    const q = 'What surgery treats appendicitis?';
    const ans = extractiveAnswer(q, sources.slice(0, 1));
    const h = heuristicEvaluation({ question: q, answer: ans.text, sources });
    expect(h.support.share).toBe(1);
    expect(h.citations.precision).toBe(1);
    expect(confidence({ heuristic: h }).level).toBe('High');
  });
  it('computes retrieval accuracy (hit, recall, MRR)', () => {
    const ranked = [
      { docId: 'm', docName: 'Handbook', page: 2 },
      { docId: 'm', docName: 'Handbook', page: 3 },
      { docId: 'm', docName: 'Handbook', page: 5 },
    ];
    expect(parseExpected('3, 7')).toEqual([{ name: '', page: 3 }, { name: '', page: 7 }]);
    expect(retrievalMetrics(ranked, parseExpected('3, 7'))).toMatchObject({ hit: 1, recall: 0.5, rr: 0.5, firstRank: 2 });
    expect(retrievalMetrics(ranked, parseExpected('9')).hit).toBe(0);
  });
});

describe('storage helpers and prompts', () => {
  it('slims saved records to chunk references and hydrates them back', () => {
    const rec = { question: 'q', prompt: [{}], sources: [{ key: 'm:0', docId: 'm', idx: 0, page: 1, text: 'hello' }] };
    const slim = slimRecord(rec);
    expect(slim.prompt).toBeUndefined();
    expect(slim.sources[0].text).toBeUndefined();
    const back = hydrateRecord(slim, () => ({ chunks: [{ text: 'hello' }] }));
    expect(back.sources[0].text).toBe('hello');
  });
  it('builds a domain-aware system prompt for several documents', () => {
    const p = systemPrompt({ ...DEFAULT_SETTINGS, preset: 'legal' }, ['Contract', 'Policy']);
    expect(p).toMatch(/legal and policy research assistant/);
    expect(p).toMatch(/"Contract", "Policy"/);
    expect(p).toMatch(/\[Contract p\. 12\]/);
    expect(p).toMatch(/not legal advice/);
  });
});

describe('loaders', () => {
  it('paginates long text on paragraph boundaries and before headings', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(30)).join('\n\n');
    const pages = paginate(text, 1000);
    expect(pages.length).toBeGreaterThan(3);
    expect(pages.every((p) => p.text.length <= 1300)).toBe(true);
  });
  it('loads markdown keeping headings as sections', async () => {
    const f = new File(['# Title\n\nIntro text.\n\n### Setup\n\nInstall [the tool](http://x) now.'], 'notes.md');
    const { pages, title } = await loadText(f);
    expect(title).toBe('Title');
    expect(pages[0].text).toMatch(/## Setup/);
    expect(pages[0].text).toMatch(/Install the tool now/);
  });
});
