#!/usr/bin/env node
// Builds the README performance tables, the SVG charts in docs/benchmarks/ and the summary the
// Learn page shows (src/lib/benchmarks.json) from bench/results/<before|after>/*.json.
//
//   node bench/report.mjs [--before before] [--after after]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BENCH_DIR } from './lib/data.mjs';
import { pairedBootstrap } from './lib/metrics.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const ROOT = join(BENCH_DIR, '..');
const load = (label, suite) => {
  const f = join(BENCH_DIR, 'results', label, `${suite}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
const B = (s) => load(args.before || 'before', s);
const A = (s) => load(args.after || 'after', s);

// ---------- metric catalogue ----------
// quality: higher is better unless `lower`; per() gives the per-question values for the bootstrap
const QUALITY = [
  { id: 'page1', label: 'Right page ranked first', note: 'SQuAD, app defaults', suite: 'squad-B', get: (r) => r.configs.default.hit1, per: (r) => r.configs.default.per.hit1 },
  { id: 'pageK', label: 'Right page in the top 4', note: 'SQuAD, app defaults', suite: 'squad-B', get: (r) => r.configs.default.hitK, per: (r) => r.configs.default.per.hitK },
  { id: 'ctx', label: 'Answer text reaches the prompt', note: 'SQuAD, retrieved context', suite: 'squad-B', get: (r) => r.configs.default.goldInContext, per: (r) => r.configs.default.per.ctx },
  { id: 'first', card: true, label: 'Answer in the first bullet', note: 'SQuAD, no-LLM answer', suite: 'squad-B', get: (r) => r.configs.default.answerFirst, per: (r) => r.configs.default.per.first },
  { id: 'top3', card: true, label: 'Answer in the top 3 bullets', note: 'SQuAD, no-LLM answer', suite: 'squad-B', get: (r) => r.configs.default.answerTop3, per: (r) => r.configs.default.per.top3 },
  { id: 'kw', card: true, label: 'Keyword search accuracy', note: 'SciFact nDCG@10', suite: 'scifact-test', get: (r) => r.configs.bm25.ndcg10, per: (r) => r.configs.bm25.per.ndcg10 },
  { id: 'hyb', card: true, label: 'Hybrid search accuracy', note: 'SciFact nDCG@10, app default', suite: 'scifact-test', get: (r) => r.configs['hybrid-gte'].ndcg10, per: (r) => r.configs['hybrid-gte'].per.ndcg10 },
  { id: 'rr', label: 'Hybrid search with reranker', note: 'SciFact nDCG@10, Best quality profile', suite: 'scifact-test', get: (r) => r.configs['hybrid-gte-rerank'].ndcg10, per: (r) => r.configs['hybrid-gte-rerank'].per.ndcg10 },
  { id: 'nfKw', label: 'Keyword search, unseen data', note: 'NFCorpus nDCG@10, never used for tuning', suite: 'nfcorpus-test', get: (r) => r.configs.bm25.ndcg10, per: (r) => r.configs.bm25.per.ndcg10 },
  { id: 'nfHyb', card: true, label: 'Hybrid search, unseen data', note: 'NFCorpus nDCG@10, never used for tuning', suite: 'nfcorpus-test', get: (r) => r.configs['hybrid-gte'].ndcg10, per: (r) => r.configs['hybrid-gte'].per.ndcg10 },
  { id: 'swap', card: true, label: 'Swapped facts caught', note: 'claim check, SQuAD sentences', suite: 'claims-B', get: (r) => r.squad.swapCaught, per: (r) => r.squad.per.caught },
  { id: 'true', label: 'True sentences passed', note: 'claim check, SQuAD sentences', suite: 'claims-B', get: (r) => r.squad.truePass, per: (r) => r.squad.per.truePass },
  { id: 'near', label: 'Near misses passed', note: 'claim check, true sentence against the wrong paragraph, lower is better', lower: true, suite: 'claims-B', get: (r) => r.nearMiss.passed, per: (r) => r.nearMiss.per.passed },
  { id: 'sciSup', card: true, label: 'Supported claims passed', note: 'claim check, SciFact claims, higher is better', suite: 'claims-B', get: (r) => r.scifact.supportedPass, per: (r) => r.scifact.per.pass.filter((_, i) => r.scifact.per.label[i] === 'S') },
  { id: 'sciCon', card: true, label: 'Contradicted claims passed', note: 'claim check, SciFact claims, lower is better', lower: true, suite: 'claims-B', get: (r) => r.scifact.contradictedPass, per: (r) => r.scifact.per.pass.filter((_, i) => r.scifact.per.label[i] === 'C') },
];
const SPEED = [
  { id: 'cold', label: 'First document, from a cold start', unit: 's', get: (r) => r.indexing?.firstDocMs / 1000, fmt: (v) => v.toFixed(1) },
  { id: 'index', label: 'Indexing a document', unit: 'chunks/s', get: (r) => r.indexing?.chunksPerSec, higher: true, fmt: (v) => v.toFixed(1) },
  { id: 'query', label: 'Embedding a question', unit: 'ms', get: (r) => r.queryEmbedMs?.median, fmt: (v) => Math.round(v) },
  { id: 'rerank', label: 'Reranking 20 passages', unit: 's', get: (r) => r.rerank20Ms?.median / 1000, fmt: (v) => v.toFixed(2) },
  { id: 'first', label: 'In-browser LLM, first token', unit: 's', get: (r) => r.llm?.prompts?.long?.firstTokenMs / 1000, fmt: (v) => v.toFixed(1) },
  { id: 'decode', label: 'In-browser LLM, writing speed', unit: 'tokens/s', get: (r) => r.llm?.prompts?.long?.decodeTokPerSec, higher: true, fmt: (v) => v.toFixed(1) },
  { id: 'answer', label: 'In-browser LLM, full answer', unit: 's', get: (r) => r.answers?.totalMs?.median / 1000, fmt: (v) => v.toFixed(1) },
];

const pct = (v) => (v == null ? 'n/a' : `${(100 * v).toFixed(1)}%`);
const pts = (d) => {
  const v = Number((100 * d).toFixed(1));
  return v === 0 ? '0.0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
};
// measurably better: the whole confidence interval, as printed (0.1 pt), is on the good side of zero
const shown = (d) => Number((100 * d).toFixed(1));
const better = (r) => (r.lower ? shown(r.ci.hi) < 0 : shown(r.ci.lo) > 0);

// the paired bootstrap needs the same questions, in the same order, on both sides
const questionIds = (r) => JSON.stringify(r.qids ?? [r.squad?.ids, r.scifact?.ids, r.nearMiss?.ids]);

function qualityRows() {
  return QUALITY.map((m) => {
    const b = B(m.suite)?.result;
    const a = A(m.suite)?.result;
    if (!b || !a) return null;
    if (questionIds(b) !== questionIds(a)) throw new Error(`${m.suite}: before and after were measured on different questions`);
    const ci = pairedBootstrap(m.per(b), m.per(a));
    return { ...m, before: m.get(b), after: m.get(a), ci };
  }).filter(Boolean);
}

// before = the old site as served (not isolated, one thread); after = the new site, isolated.
// The other two cells separate the effect of the headers from the effect of the code changes.
function speedRows() {
  const before = B('speed-off')?.result;
  const after = A('speed-on')?.result;
  const beforeOn = B('speed-on')?.result;
  const afterOff = A('speed-off')?.result;
  if (!before || !after) return [];
  const get = (m, r) => {
    const v = r ? m.get(r) : null;
    return v == null || Number.isNaN(v) ? null : v;
  };
  return SPEED.map((m) => {
    const b = get(m, before);
    const a = get(m, after);
    if (b == null || a == null) return null;
    return { ...m, before: b, after: a, beforeOn: get(m, beforeOn), afterOff: get(m, afterOff), factor: m.higher ? a / b : b / a };
  }).filter(Boolean);
}

// ---------- SVG charts (dumbbell for quality on one % axis; speed-up bars indexed to 1x) ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const STYLE = `
  <style>
    .surface { fill: #fcfcfb; } .ink { fill: #0b0b0b; } .ink2 { fill: #52514e; } .muted { fill: #898781; }
    .grid { stroke: #e1e0d9; } .axis { stroke: #c3c2b7; } .before { fill: #86b6ef; } .after { fill: #256abf; }
    .link { stroke: #86b6ef; } .bar { fill: #2a78d6; } .ring { stroke: #fcfcfb; }
    text { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .num { font-variant-numeric: tabular-nums; }
    @media (prefers-color-scheme: dark) {
      .surface { fill: #1a1a19; } .ink { fill: #f0efec; } .ink2 { fill: #c3c2b7; } .muted { fill: #898781; }
      .grid { stroke: #2c2c2a; } .axis { stroke: #383835; } .before { fill: #1c5cab; } .after { fill: #86b6ef; }
      .link { stroke: #1c5cab; } .bar { fill: #3987e5; } .ring { stroke: #1a1a19; }
    }
  </style>`;

function dumbbell(rows, title, subtitle) {
  const W = 860;
  const left = 290;
  const right = 170;
  const plotW = W - left - right;
  const top = 86;
  const rowH = 38;
  const H = top + rows.length * rowH + 44;
  const x = (v) => left + v * plotW;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${STYLE}
  <rect class="surface" width="${W}" height="${H}" rx="12"/>
  <text class="ink" x="24" y="34" font-size="18" font-weight="600">${esc(title)}</text>
  <text class="ink2" x="24" y="56" font-size="13">${esc(subtitle)}</text>
  <circle class="before" cx="${W - 236}" cy="30" r="5"/><text class="ink2" x="${W - 226}" y="34" font-size="12">Before</text>
  <circle class="after" cx="${W - 160}" cy="30" r="5"/><text class="ink2" x="${W - 150}" y="34" font-size="12">After</text>`;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top - 8}" y2="${top + rows.length * rowH}" stroke-width="1"/>`;
    s += `<text class="muted num" x="${x(t)}" y="${top + rows.length * rowH + 18}" font-size="11" text-anchor="middle">${Math.round(t * 100)}%</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    s += `<text class="ink" x="24" y="${y - 2}" font-size="13">${esc(r.label)}</text><text class="muted" x="24" y="${y + 13}" font-size="11">${esc(r.note)}</text>`;
    s += `<line class="link" x1="${x(Math.min(r.before, r.after))}" x2="${x(Math.max(r.before, r.after))}" y1="${y}" y2="${y}" stroke-width="2" stroke-linecap="round"/>`;
    s += `<circle class="before ring" cx="${x(r.before)}" cy="${y}" r="5" stroke-width="2"><title>Before: ${pct(r.before)}</title></circle>`;
    s += `<circle class="after ring" cx="${x(r.after)}" cy="${y}" r="5" stroke-width="2"><title>After: ${pct(r.after)}</title></circle>`;
    s += `<text class="ink num" x="${W - 24}" y="${y + 4}" font-size="13" text-anchor="end">${pct(r.before)} → ${pct(r.after)}</text>`;
  });
  return `${s}\n</svg>\n`;
}

function speedBars(rows, title, subtitle) {
  const W = 860;
  const left = 290;
  const right = 90;
  const plotW = W - left - right;
  const top = 80;
  const rowH = 36;
  const max = Math.max(2, Math.ceil(Math.max(...rows.map((r) => r.factor))));
  const H = top + rows.length * rowH + 44;
  const x = (v) => left + (v / max) * plotW;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${STYLE}
  <rect class="surface" width="${W}" height="${H}" rx="12"/>
  <text class="ink" x="24" y="34" font-size="18" font-weight="600">${esc(title)}</text>
  <text class="ink2" x="24" y="56" font-size="13">${esc(subtitle)}</text>`;
  for (let t = 0; t <= max; t++) {
    s += `<line class="${t === 1 ? 'axis' : 'grid'}" x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${top + rows.length * rowH}" stroke-width="1"/>`;
    s += `<text class="muted num" x="${x(t)}" y="${top + rows.length * rowH + 18}" font-size="11" text-anchor="middle">${t}×</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const w = Math.max(2, x(r.factor) - left);
    s += `<text class="ink" x="24" y="${y + 4}" font-size="13">${esc(r.label)}</text>`;
    s += `<path class="bar" d="M${left},${y - 9} h${w - 4} a4,4 0 0 1 4,4 v10 a4,4 0 0 1 -4,4 h-${w - 4} z"><title>${esc(r.label)}: ${r.fmt(r.before)} → ${r.fmt(r.after)} ${r.unit}</title></path>`;
    s += `<text class="ink num" x="${left + w + 8}" y="${y + 4}" font-size="13">${r.factor.toFixed(1)}×</text>`;
  });
  return `${s}\n</svg>\n`;
}

// ---------- markdown ----------
function qualityTable(rows) {
  const head = '| What we measured | Before | After | Change (95% CI) |\n|---|---|---|---|';
  const after = (r) => (better(r) ? `**${pct(r.after)}**` : pct(r.after));
  return [head, ...rows.map((r) => `| ${r.label} (${r.note}) | ${pct(r.before)} | ${after(r)} | ${pts(r.ci.delta)} pts (${pts(r.ci.lo)} to ${pts(r.ci.hi)}) |`)].join('\n');
}
function speedTable(rows) {
  const head = '| What we timed | Before, one thread (as served) | Before, isolated | After, one thread | After, isolated (as served) | Faster by |\n|---|---|---|---|---|---|';
  const cell = (r, v) => (v == null ? 'n/a' : r.fmt(v));
  return [head, ...rows.map((r) => `| ${r.label} (${r.unit}) | ${cell(r, r.before)} | ${cell(r, r.beforeOn)} | ${cell(r, r.afterOff)} | **${cell(r, r.after)}** | ${r.factor.toFixed(1)}× |`)].join('\n');
}

// ---------- plain-language summary (text by hand, numbers from the results) ----------
const val = (rows, id, k = 'after') => rows.find((r) => r.id === id)?.[k];
function plainTable(q, sp) {
  const P = (v) => (v == null ? 'n/a' : `${(100 * v).toFixed(1)}%`);
  const X = (id) => {
    const r = sp.find((x) => x.id === id);
    return r ? `${r.factor.toFixed(1)}×` : 'n/a';
  };
  // new code against old code, both on one thread: what the code changes give without isolation
  const oneThread = (id) => {
    const r = sp.find((x) => x.id === id);
    return r?.afterOff ? `${(r.higher ? r.afterOff / r.before : r.before / r.afterOff).toFixed(1)}×` : 'n/a';
  };
  const rows = [
    ['Search understands word forms', "Keyword search treated *treatments* and *treatment*, *IL-6* and *IL 6*, or *café* and *cafe* as different words.", 'A Porter stemmer, accent folding and hyphen handling make them match.', `Keyword search accuracy on SciFact ${P(val(q, 'kw', 'before'))} → **${P(val(q, 'kw'))}**, on unseen NFCorpus ${P(val(q, 'nfKw', 'before'))} → ${P(val(q, 'nfKw'))}`],
    ['The answer comes first', 'Answers without an LLM listed sentences in reading order, so the one that answers the question was often in the middle.', 'The most relevant sentence comes first, and rare question words count more than common ones.', `Answer in the first bullet ${P(val(q, 'first', 'before'))} → **${P(val(q, 'first'))}**`],
    ['Wrong numbers and names are caught', 'The claim check only counted shared words, so a sentence with one wrong number or name still passed.', 'Numbers and names must appear in the sources, and negation or direction must agree with the matching sentence.', `Swapped facts caught ${P(val(q, 'swap', 'before'))} → **${P(val(q, 'swap'))}**, true sentences passed ${P(val(q, 'true'))}. On real science claims it is stricter both ways: contradicted claims pass ${P(val(q, 'sciCon', 'before'))} → ${P(val(q, 'sciCon'))}, supported ones ${P(val(q, 'sciSup', 'before'))} → ${P(val(q, 'sciSup'))}`],
    ['The reranker, measured on both kinds of text', 'It replaced the search order, which helped everyday questions but made scientific ones worse.', 'Its order is now combined with the search order. It stays off by default and is part of the Best quality profile, because on scientific text search alone still scores higher.', `SciFact with reranker ${P(val(q, 'rr', 'before'))} → **${P(val(q, 'rr'))}** (search alone ${P(val(q, 'hyb'))}); SQuAD half A right page first 73.7% → 80.3% with it (tuning data)`],
    ['Local models use several cores', 'Embeddings, the reranker and the in-browser LLM ran on a single CPU thread.', 'Cross-origin isolation (Space headers, a small service worker on GitHub Pages) lets them use every core, and documents are embedded in batches of similar length so less work goes to padding.', `Indexing ${X('index')} faster, questions embedded ${X('query')} faster, the in-browser model's first token ${X('first')} sooner`],
    ['Smaller downloads without a GPU', 'Every device downloaded the 26.9 MB WebAssembly runtime built for WebGPU support.', 'Devices without WebGPU get the plain 14.3 MB runtime.', '12.6 MB less to download on first use'],
    ['In-browser answers read less', 'The in-browser model read every retrieved passage in full and then ran a second full pass as its own judge.', 'Passages are trimmed to their most relevant sentences, and the slow self-judge is off by default when you pick the in-browser model (the checks that need no LLM still run).', `Full answer ${X('answer')} faster with every core, and ${oneThread('answer')} faster on one thread`],
  ];
  return ['| What | Before | After | Measured |', '|---|---|---|---|', ...rows.map((r) => `| **${r[0]}** | ${r[1]} | ${r[2]} | ${r[3]} |`)].join('\n');
}

// ---------- in-browser model comparison (bench/results/models/llm-*.json) ----------
const MODEL_INFO = {
  'onnx-community/Qwen2.5-0.5B-Instruct': { name: 'Qwen2.5 0.5B Instruct', licence: 'Apache 2.0' },
  'onnx-community/LFM2-350M-ONNX': { name: 'LFM2 350M', licence: 'LFM Open License v1.0' },
  'onnx-community/LFM2-700M-ONNX': { name: 'LFM2 700M', licence: 'LFM Open License v1.0' },
  'HuggingFaceTB/SmolLM2-360M-Instruct': { name: 'SmolLM2 360M Instruct', licence: 'Apache 2.0' },
  'onnx-community/gemma-3-270m-it-ONNX': { name: 'Gemma 3 270M', licence: 'Gemma terms of use' },
};
const BASE_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
function modelRows() {
  const dir = join(BENCH_DIR, 'results', 'models');
  if (!existsSync(dir)) return [];
  // each model is measured in parts (speed, reading-A, reading-B, answers); merge them per model
  const byModel = new Map();
  for (const f of readdirSync(dir).filter((x) => /^llm-.*\.json$/.test(x))) {
    const { meta, result } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const m = byModel.get(result.model) || { model: result.model, reading: {}, peakMemoryMb: 0, commit: meta.commit };
    if (result.part === 'speed') Object.assign(m, { loadMs: result.loadMs, downloadBytes: result.downloadBytes, status: result.status, prompts: result.prompts });
    if (result.reading) m.reading[result.reading.split] = result.reading;
    if (result.answers) m.answers = result.answers;
    m.peakMemoryMb = Math.max(m.peakMemoryMb, result.peakMemoryMb || 0);
    byModel.set(result.model, m);
  }
  // a model without reading results was stopped after its speed part (slower than the default)
  const rows = [...byModel.values()].filter((r) => r.prompts);
  const base = rows.find((r) => r.model === BASE_MODEL);
  const paired = (r, split) => (base && r !== base && r.reading[split] && JSON.stringify(r.reading[split].ids) === JSON.stringify(base.reading[split]?.ids) ? pairedBootstrap(base.reading[split].per, r.reading[split].per) : null);
  // fastest first token first
  return rows.map((r) => ({ ...r, readingCi: paired(r, 'B'), readingCiA: paired(r, 'A') })).sort((a, b) => a.prompts.long.firstTokenMs - b.prompts.long.firstTokenMs);
}
function modelTable(rows, defaultModel) {
  const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
  const head = '| In-browser model (licence) | Download without WebGPU | First token, ~930-token prompt | Writing speed | Reading: answer found / F1 (SQuAD half B) | Full answer: median time, answer found |\n|---|---|---|---|---|---|';
  return [
    head,
    ...rows.map((r) => {
      const info = MODEL_INFO[r.model] || { name: r.model, licence: 'see model card' };
      const name = `${info.name}${r.model === defaultModel ? ' **(default)**' : ''} (${info.licence})`;
      const b = r.reading.B;
      const reading = b ? `${(100 * b.accuracy).toFixed(0)}% / ${(100 * (b.f1 ?? 0)).toFixed(0)}, ${b.answerTokens?.toFixed(0) ?? '?'} tokens per answer${r.readingCi ? ` (found: ${pts(r.readingCi.delta)} pts vs Qwen, ${pts(r.readingCi.lo)} to ${pts(r.readingCi.hi)})` : ''}` : 'not measured (slower than the default)';
      const answers = r.answers ? `${(r.answers.totalMs.median / 1000).toFixed(0)} s, ${(100 * r.answers.gold).toFixed(0)}% of ${r.answers.n}` : 'not measured';
      return `| ${name} | ${mb(r.downloadBytes)} | ${(r.prompts.long.firstTokenMs / 1000).toFixed(1)} s | ${r.prompts.long.decodeTokPerSec.toFixed(1)} tokens/s | ${reading} | ${answers} |`;
    }),
  ].join('\n');
}

const q = qualityRows();
const sp = speedRows();
mkdirSync(join(ROOT, 'docs', 'benchmarks'), { recursive: true });
if (q.length) writeFileSync(join(ROOT, 'docs', 'benchmarks', 'quality.svg'), dumbbell(q, 'Answer and retrieval quality, before and after', 'Held-out data only: SQuAD half B, SciFact test questions and claims, NFCorpus'));
if (sp.length) writeFileSync(join(ROOT, 'docs', 'benchmarks', 'speed.svg'), speedBars(sp, 'Local models: how many times faster', 'Headless Chromium on 4 vCPU, no GPU; old site as served (one thread) against the new one (isolated, every core)'));

const block = [
  '<!-- bench:start -->',
  '<!-- Generated by `npm run bench:report` from bench/results. Do not edit by hand. -->',
  q.length ? '![Answer and retrieval quality, before and after](docs/benchmarks/quality.svg)\n\n' + qualityTable(q) : '',
  sp.length ? '\n![Local model speed-ups](docs/benchmarks/speed.svg)\n\n' + speedTable(sp) : '',
  '<!-- bench:end -->',
].join('\n');
const readme = join(ROOT, 'README.md');
let text = readFileSync(readme, 'utf8');
if (text.includes('<!-- bench:start -->')) text = text.replace(/<!-- bench:start -->[\s\S]*?<!-- bench:end -->/, block);
else console.log('README has no <!-- bench:start --> marker yet; block not inserted');
if (q.length && sp.length && text.includes('<!-- plain:start -->')) text = text.replace(/<!-- plain:start -->[\s\S]*?<!-- plain:end -->/, `<!-- plain:start -->\n${plainTable(q, sp)}\n<!-- plain:end -->`);
const models = modelRows();
if (models.length && text.includes('<!-- models:start -->')) {
  const { DEFAULT_SETTINGS } = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'settings.js')).href);
  const defaultModel = DEFAULT_SETTINGS.browserModel;
  text = text.replace(/<!-- models:start -->[\s\S]*?<!-- models:end -->/, `<!-- models:start -->\n<!-- Generated by \`npm run bench:report\` from bench/results/models (one file per model and part). Do not edit by hand. -->\n${modelTable(models, defaultModel)}\n<!-- models:end -->`);
}
writeFileSync(readme, text);

const summary = {
  generated: new Date().toISOString().slice(0, 10),
  hardware: A('speed-on')?.meta ? `${A('speed-on').meta.cpu.replace(/\((R|TM)\)|\s+(Processor|CPU)\b/g, '').replace(/\s+/g, ' ').trim()}, ${A('speed-on').meta.cores} vCPU, no GPU` : null,
  quality: q.map(({ id, label, note, before, after, ci, lower, card }) => ({ id, label, note, before, after, delta: ci.delta, lower: !!lower, card: !!card })),
  speed: sp.map(({ id, label, unit, before, after, factor, higher }) => ({ id, label, unit, before, after, factor, higher: !!higher })),
};
writeFileSync(join(ROOT, 'src', 'lib', 'benchmarks.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(`report: ${q.length} quality rows, ${sp.length} speed rows`);
