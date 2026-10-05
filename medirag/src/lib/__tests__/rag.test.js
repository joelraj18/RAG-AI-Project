import { describe, it, expect } from 'vitest';
import { cleanPages } from '../clean.js';
import { chunkPages } from '../chunk.js';
import { buildBM25, searchBM25 } from '../bm25.js';
import { searchVectors, mmr, rrf } from '../vector.js';
import { parseScore, extractCitations, supportAnalysis, citationCheck, heuristicEvaluation } from '../evaluate.js';
import { extractiveAnswer } from '../llm.js';
import { DEMO_TEXT } from '../demo.js';

const pages = DEMO_TEXT.split('\f').map((t, i) => ({
  page: i + 1,
  text: `someone@example.com\nABCD123XYZ\nDemo Handbook Running Header\n${t}`,
}));

describe('cleaning', () => {
  it('removes repeated watermark lines and e-mails', () => {
    const { pages: out, stats } = cleanPages(pages);
    expect(out).toHaveLength(6);
    expect(out[0].text).not.toMatch(/Running Header|example\.com|ABCD123XYZ/);
    expect(stats.removedShare).toBeGreaterThan(0);
  });
});

describe('chunking + BM25', () => {
  const { pages: clean } = cleanPages(pages);
  const chunks = chunkPages(clean, { chunkSize: 120, chunkOverlap: 20 });
  it('keeps page numbers and respects chunk size', () => {
    expect(chunks.length).toBeGreaterThan(6);
    expect(chunks.every((c) => c.page >= 1 && c.page <= 6)).toBe(true);
    expect(Math.max(...chunks.map((c) => c.tokens))).toBeLessThanOrEqual(140);
  });
  it('retrieves the right page for lay-language questions', () => {
    const idx = buildBM25(chunks);
    const top = (q) => chunks[searchBM25(idx, q, 1)[0].idx].page;
    expect(top('appendectomy surgery for appendicitis')).toBe(3);
    expect(top('patchy hair loss bald spots on the scalp')).toBe(4);
    expect(top('vasopressor norepinephrine sepsis')).toBe(2);
  });
});

describe('vector search', () => {
  const dim = 2;
  const m = new Float32Array([1, 0, 0.8, 0.6, 0, 1, 0.99, 0.141]);
  it('ranks by cosine', () => {
    const r = searchVectors(m, dim, new Float32Array([1, 0]), 2);
    expect(r[0].idx).toBe(0);
    expect(r[1].idx).toBe(3);
  });
  it('mmr trades relevance for diversity', () => {
    const cands = searchVectors(m, dim, new Float32Array([1, 0]), 4);
    const out = mmr(m, dim, new Float32Array([1, 0]), cands, 2, 0.3);
    expect(out.map((o) => o.idx)).toContain(0);
    expect(out.map((o) => o.idx)).not.toContain(3);
  });
  it('rrf fuses lists', () => {
    const f = rrf([
      [
        { idx: 1, score: 0.9 },
        { idx: 2, score: 0.5 },
      ],
      [
        { idx: 2, score: 9 },
        { idx: 3, score: 1 },
      ],
    ]);
    expect(f[0].idx).toBe(2);
  });
});

describe('evaluation', () => {
  it('parses judge scores like the notebook', () => {
    expect(parseScore('Score: 4\nJustification: ok')).toBe(4);
    expect(parseScore('**Score:** 5')).toBe(5);
    expect(parseScore('nothing')).toBeNull();
  });
  it('extracts citations and ranges', () => {
    expect(extractCitations('a [PDF p. 175] b [PDF p. 2402, 2403] c [p. 10-12]')).toEqual([10, 11, 12, 175, 2402, 2403]);
  });
  const sources = [
    {
      page: 3,
      text: 'The standard treatment is surgical removal of the appendix (appendectomy), performed by open or laparoscopic technique.',
      tokens: 30,
    },
  ];
  it('flags unsupported claims and invalid citations', () => {
    const a = supportAnalysis(
      '- Treatment is laparoscopic or open appendectomy [PDF p. 3]\n- Drinking herbal tea dissolves the inflamed organ quickly [PDF p. 9]',
      sources
    );
    expect(a.rows[0].status).toBe('supported');
    expect(a.rows[1].status).toBe('unsupported');
    const c = citationCheck('- open appendectomy surgery [PDF p. 3]\n- something else entirely here [PDF p. 9]', sources);
    expect(c.invalid).toEqual([9]);
    expect(c.precision).toBe(0.5);
  });
  it('does not split sentences inside citations', () => {
    const c = citationCheck('Give 30 mL/kg of IV crystalloid within 3 hours [PDF p. 3]. Start antibiotics early [PDF p. 3]', sources);
    expect(c.coverage).toBe(1);
  });
  it('extractive answers are fully supported', () => {
    const ans = extractiveAnswer('What surgery treats appendicitis?', sources);
    const h = heuristicEvaluation({ question: 'What surgery treats appendicitis?', answer: ans.text, sources });
    expect(h.support.share).toBe(1);
    expect(h.citations.precision).toBe(1);
  });
});
