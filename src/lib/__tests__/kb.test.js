import { describe, it, expect } from 'vitest';
import { batchPlan } from '../kb.js';

describe('embedding batch plan', () => {
  it('covers every row once, shortest first, in batches of the given size', () => {
    const lengths = [900, 10, 400, 30, 880, 20, 410, 5, 600];
    const plan = batchPlan(lengths, 4);
    expect(plan.flat().sort((a, b) => a - b)).toEqual(lengths.map((_, i) => i));
    expect(plan.every((b) => b.length <= 4)).toBe(true);
    const order = plan.flat().map((i) => lengths[i]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

import { wantsIsolationWorker } from '../isolation.js';

describe('isolation service worker', () => {
  const base = { prod: true, isolated: false, hasServiceWorker: true, secure: true, topLevel: true, optOut: false };
  it('registers only for a production, top-level, not yet isolated page', () => {
    expect(wantsIsolationWorker(base)).toBe(true);
    for (const k of ['prod', 'hasServiceWorker', 'secure', 'topLevel']) expect(wantsIsolationWorker({ ...base, [k]: false })).toBe(false);
    expect(wantsIsolationWorker({ ...base, isolated: true })).toBe(false);
    expect(wantsIsolationWorker({ ...base, optOut: true })).toBe(false);
  });
});
