#!/usr/bin/env node
// Builds the README performance tables, the SVG charts in docs/benchmarks/ and the summary the
// Learn page shows (src/lib/benchmarks.json) from bench/results/<before|after>/*.json.
//
//   node bench/report.mjs [--before before] [--after after]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  { id: 'first', label: 'Answer in the first bullet', note: 'SQuAD, no-LLM answer', suite: 'squad-B', get: (r) => r.configs.default.answerFirst, per: (r) => r.configs.default.per.first },
  { id: 'top3', label: 'Answer in the top 3 bullets', note: 'SQuAD, no-LLM answer', suite: 'squad-B', get: (r) => r.configs.default.answerTop3, per: (r) => r.configs.default.per.top3 },
  { id: 'kw', label: 'Keyword search accuracy', note: 'SciFact nDCG@10', suite: 'scifact-test', get: (r) => r.configs.bm25.ndcg10, per: (r) => r.configs.bm25.per.ndcg10 },
  { id: 'hyb', label: 'Hybrid search accuracy', note: 'SciFact nDCG@10, app default', suite: 'scifact-test', get: (r) => r.configs['hybrid-gte'].ndcg10, per: (r) => r.configs['hybrid-gte'].per.ndcg10 },
  { id: 'swap', label: 'Swapped facts caught', note: 'claim check, SQuAD sentences', suite: 'claims-B', get: (r) => r.squad.swapCaught, per: (r) => r.squad.per.caught },
  { id: 'true', label: 'True sentences passed', note: 'claim check, SQuAD sentences', suite: 'claims-B', get: (r) => r.squad.truePass, per: (r) => r.squad.per.truePass },
];
const SPEED = [
  { id: 'index', label: 'Indexing a document', unit: 'chunks/s', get: (r) => r.indexing?.chunksPerSec, higher: true, fmt: (v) => v.toFixed(1) },
  { id: 'query', label: 'Embedding a question', unit: 'ms', get: (r) => r.queryEmbedMs?.median, fmt: (v) => Math.round(v) },
  { id: 'rerank', label: 'Reranking 20 passages', unit: 'ms', get: (r) => r.rerank20Ms?.median, fmt: (v) => Math.round(v) },
  { id: 'first', label: 'In-browser LLM, first token', unit: 'ms', get: (r) => r.llm?.prompts?.long?.firstTokenMs, fmt: (v) => Math.round(v) },
  { id: 'decode', label: 'In-browser LLM, writing speed', unit: 'tokens/s', get: (r) => r.llm?.prompts?.long?.decodeTokPerSec, higher: true, fmt: (v) => v.toFixed(1) },
  { id: 'answer', label: 'In-browser LLM, full answer', unit: 's', get: (r) => r.answers?.totalMs?.median / 1000, fmt: (v) => v.toFixed(1) },
  { id: 'download', label: 'In-browser LLM, download', unit: 'MB', get: (r) => r.llm?.downloadBytes / 1e6, fmt: (v) => Math.round(v) },
];

const pct = (v) => (v == null ? 'n/a' : `${(100 * v).toFixed(1)}%`);
const pts = (d) => `${d >= 0 ? '+' : ''}${(100 * d).toFixed(1)}`;

function qualityRows() {
  return QUALITY.map((m) => {
    const b = B(m.suite)?.result;
    const a = A(m.suite)?.result;
    if (!b || !a) return null;
    const ci = pairedBootstrap(m.per(b), m.per(a));
    return { ...m, before: m.get(b), after: m.get(a), ci };
  }).filter(Boolean);
}

function speedRows() {
  const before = B('speed-off')?.result;
  const after = A('speed-on')?.result;
  const afterOff = A('speed-off')?.result;
  if (!before || !after) return [];
  return SPEED.map((m) => {
    const b = m.get(before);
    const a = m.get(after);
    const o = afterOff ? m.get(afterOff) : null;
    if (b == null || a == null || Number.isNaN(b) || Number.isNaN(a)) return null;
    return { ...m, before: b, after: a, afterOff: o, factor: m.higher ? a / b : b / a };
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
  return [head, ...rows.map((r) => `| ${r.label} (${r.note}) | ${pct(r.before)} | **${pct(r.after)}** | ${pts(r.ci.delta)} pts (${pts(r.ci.lo)} to ${pts(r.ci.hi)}) |`)].join('\n');
}
function speedTable(rows) {
  const head = '| What we timed | Before (1 thread) | After (isolated) | After, not isolated | Faster by |\n|---|---|---|---|---|';
  return [head, ...rows.map((r) => `| ${r.label} (${r.unit}) | ${r.fmt(r.before)} | **${r.fmt(r.after)}** | ${r.afterOff == null || Number.isNaN(r.afterOff) ? 'n/a' : r.fmt(r.afterOff)} | ${r.factor.toFixed(1)}× |`)].join('\n');
}

// ---------- plain-language summary (text by hand, numbers from the results) ----------
const val = (rows, id, k = 'after') => rows.find((r) => r.id === id)?.[k];
function plainTable(q, sp) {
  const P = (v) => (v == null ? 'n/a' : `${(100 * v).toFixed(1)}%`);
  const X = (id) => {
    const r = sp.find((x) => x.id === id);
    return r ? `${r.factor.toFixed(1)}×` : 'n/a';
  };
  const rows = [
    ['Search understands word forms', "Keyword search treated *treatments* and *treatment*, *IL-6* and *IL 6*, or *café* and *cafe* as different words.", 'A Porter stemmer, accent folding and hyphen handling make them match.', `Keyword search accuracy on SciFact ${P(val(q, 'kw', 'before'))} → **${P(val(q, 'kw'))}**`],
    ['The answer comes first', 'Answers without an LLM listed sentences in reading order, so the one that answers the question was often in the middle.', 'The most relevant sentence comes first, and rare question words count more than common ones.', `Answer in the first bullet ${P(val(q, 'first', 'before'))} → **${P(val(q, 'first'))}**`],
    ['Wrong numbers and names are caught', 'The claim check only counted shared words, so a sentence with one wrong number or name still passed.', 'Numbers and names must appear in the sources, and negation or direction must agree with the matching sentence.', `Swapped facts caught ${P(val(q, 'swap', 'before'))} → **${P(val(q, 'swap'))}**, true sentences passed ${P(val(q, 'true'))}`],
    ['Local models use several cores', 'Embeddings, the reranker and the in-browser LLM ran on a single CPU thread.', 'Cross-origin isolation (Space headers, a small service worker on GitHub Pages) lets them use all cores but one.', `Indexing ${X('index')} faster, questions embedded ${X('query')} faster`],
    ['Smaller downloads without a GPU', 'Every device downloaded the 26.9 MB WebAssembly runtime built for WebGPU support.', 'Devices without WebGPU get the plain 14.3 MB runtime.', '12.6 MB less to download on first use'],
    ['In-browser answers read less', 'The in-browser model read every retrieved passage in full and then ran a second full pass as its own judge.', 'Passages are trimmed to their most relevant sentences, and the slow self-judge is off for in-browser models (the judge-free checks still run).', `Full answer ${X('answer')} faster, first token ${X('first')} faster`],
  ];
  return ['| What | Before | After | Measured |', '|---|---|---|---|', ...rows.map((r) => `| **${r[0]}** | ${r[1]} | ${r[2]} | ${r[3]} |`)].join('\n');
}

const q = qualityRows();
const sp = speedRows();
mkdirSync(join(ROOT, 'docs', 'benchmarks'), { recursive: true });
if (q.length) writeFileSync(join(ROOT, 'docs', 'benchmarks', 'quality.svg'), dumbbell(q, 'Answer and retrieval quality, before and after', 'Held-out questions only: SQuAD half B, SciFact test, claim check on SQuAD half B'));
if (sp.length) writeFileSync(join(ROOT, 'docs', 'benchmarks', 'speed.svg'), speedBars(sp, 'Local models: how many times faster', 'Headless Chromium on 4 vCPU, no GPU; before = one thread, after = cross-origin isolated'));

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
writeFileSync(readme, text);

const summary = {
  generated: new Date().toISOString().slice(0, 10),
  hardware: A('speed-on')?.meta ? `${A('speed-on').meta.cpu}, ${A('speed-on').meta.cores} vCPU, no GPU` : null,
  quality: q.map(({ id, label, note, before, after, ci }) => ({ id, label, note, before, after, delta: ci.delta })),
  speed: sp.map(({ id, label, unit, before, after, factor, higher }) => ({ id, label, unit, before, after, factor, higher: !!higher })),
};
writeFileSync(join(ROOT, 'src', 'lib', 'benchmarks.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(`report: ${q.length} quality rows, ${sp.length} speed rows`);
