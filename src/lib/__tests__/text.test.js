import { describe, it, expect } from 'vitest';
import { stem, tokenize } from '../text.js';

// Reference examples from M. F. Porter, "An algorithm for suffix stripping" (1980).
const PORTER = {
  caresses: 'caress', ponies: 'poni', ties: 'ti', caress: 'caress', cats: 'cat',
  feed: 'feed', agreed: 'agre', plastered: 'plaster', bled: 'bled', motoring: 'motor', sing: 'sing',
  conflated: 'conflat', troubled: 'troubl', sized: 'size', hopping: 'hop', tanned: 'tan', falling: 'fall',
  hissing: 'hiss', fizzed: 'fizz', failing: 'fail', filing: 'file', happy: 'happi', sky: 'sky',
  relational: 'relat', conditional: 'condit', rational: 'ration', valenci: 'valenc', hesitanci: 'hesit',
  digitizer: 'digit', conformabli: 'conform', radicalli: 'radic', differentli: 'differ', vileli: 'vile',
  analogousli: 'analog', vietnamization: 'vietnam', predication: 'predic', operator: 'oper', feudalism: 'feudal',
  decisiveness: 'decis', hopefulness: 'hope', callousness: 'callous', formaliti: 'formal', sensitiviti: 'sensit',
  sensibiliti: 'sensibl', triplicate: 'triplic', formative: 'form', formalize: 'formal', electriciti: 'electr',
  electrical: 'electr', hopeful: 'hope', goodness: 'good', revival: 'reviv', allowance: 'allow', inference: 'infer',
  airliner: 'airlin', gyroscopic: 'gyroscop', adjustable: 'adjust', defensible: 'defens', irritant: 'irrit',
  replacement: 'replac', adjustment: 'adjust', dependent: 'depend', adoption: 'adopt', homologou: 'homolog',
  communism: 'commun', activate: 'activ', angulariti: 'angular', homologous: 'homolog', effective: 'effect',
  bowdlerize: 'bowdler', probate: 'probat', rate: 'rate', cease: 'ceas', controll: 'control', roll: 'roll',
};

describe('Porter stemmer', () => {
  it('matches the reference examples', () => {
    const wrong = Object.entries(PORTER).filter(([w, s]) => stem(w) !== s).map(([w, s]) => `${w}: ${stem(w)} (expected ${s})`);
    expect(wrong).toEqual([]);
  });
  it('maps plural and singular forms together', () => {
    for (const [a, b] of [['treatments', 'treatment'], ['findings', 'finding'], ['injuries', 'injury'], ['cells', 'cell'], ['infections', 'infection']]) expect(stem(a)).toBe(stem(b));
  });
  it('leaves numbers and short words alone', () => {
    expect(stem('1990s')).toBe('1990s');
    expect(stem('ml')).toBe('ml');
  });
});

describe('tokenizer', () => {
  it('folds accents and drops possessives', () => {
    expect(tokenize('café naïve résumé')).toEqual(tokenize('cafe naive resume'));
    expect(tokenize("McBurney's point")).toEqual(tokenize('McBurney point'));
  });
  it('matches hyphenated, spaced and joined spellings', () => {
    const t = new Set(tokenize('IL-6 and cross-encoder re-ranking'));
    for (const w of tokenize('il6 il 6 cross encoder crossencoder reranking')) expect(t.has(w)).toBe(true);
  });
  it('keeps letters from other scripts', () => {
    expect(tokenize('Größe der Straße')).toContain(stem('grosse'));
    expect(tokenize('研究 結果').length).toBe(2);
  });
});
