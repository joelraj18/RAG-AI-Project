// LLM usage meter: calls and tokens for this visit and for the current month (this browser),
// split by purpose (answer, judge, rewrite…). Only counts are stored, never prompts or keys.

const KEY = 'rag-ai-studio.usage.v1';
const listeners = new Set();
const month = () => new Date().toISOString().slice(0, 7);
const empty = () => ({ calls: 0, promptTokens: 0, completionTokens: 0, failed: 0, byPurpose: {} });

let visit = empty();
let monthly = load();

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (j?.month === month()) return j;
  } catch {
    /* unavailable */
  }
  return { month: month(), ...empty() };
}

function add(target, { purpose, promptTokens = 0, completionTokens = 0, failed = false }) {
  if (failed) target.failed++;
  else {
    target.calls++;
    target.promptTokens += promptTokens;
    target.completionTokens += completionTokens;
  }
  const p = (target.byPurpose[purpose] ||= { calls: 0, tokens: 0 });
  if (!failed) {
    p.calls++;
    p.tokens += promptTokens + completionTokens;
  }
}

/** Record one LLM call (only for providers that bill per call: Hugging Face and remote APIs). */
export function recordUsage(entry) {
  if (monthly.month !== month()) monthly = { month: month(), ...empty() };
  add(visit, entry);
  add(monthly, entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(monthly));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const getUsage = () => ({ visit, monthly });

export function onUsage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetMonthlyUsage() {
  monthly = { month: month(), ...empty() };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
