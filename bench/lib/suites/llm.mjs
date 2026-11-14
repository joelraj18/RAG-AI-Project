// In-browser LLM comparison. Each model runs alone in a fresh browser (so its memory reading is its
// own) through the tree's own gen worker: cold load and download size, first token and writing speed
// on fixed prompts, peak browser memory, reading accuracy (short answers to SQuAD questions with the
// right paragraph given) and complete answers through the app's pipeline with its in-browser settings.
import { execFileSync } from 'node:child_process';
import { startMirror } from '../mirror.mjs';
import { serve, launch, openBench, ortInfo, buildTree } from '../browser.mjs';
import { CACHE, half, squad as loadSquad } from '../data.mjs';
import { quantiles, normText, tokenF1 } from '../metrics.mjs';
import { buildCollection, questions } from './squad.mjs';
import { packSets } from './speed.mjs';

/** Candidates: the CPU dtype is q4 for all (the gen worker's default when a model is not in the catalogue). */
export const LLM_CANDIDATES = [
  'onnx-community/Qwen2.5-0.5B-Instruct',
  'onnx-community/LFM2-350M-ONNX',
  'onnx-community/LFM2-700M-ONNX',
  'HuggingFaceTB/SmolLM2-360M-Instruct',
  'onnx-community/gemma-3-270m-it-ONNX',
];

const median = (xs) => quantiles(xs)?.median ?? null;
const contains = (answers, text) => answers.map(normText).some((g) => g && normText(text).includes(g));

/** Fixed questions with their paragraph, every n-th of a SQuAD half. */
export function readingQuestions(sq, split, n) {
  const pool = sq.flatMap((a) => a.paragraphs.flatMap((p) => p.qas.filter((q) => half(q.id) === split).map((q) => ({ id: q.id, question: q.question, answers: q.answers, context: p.context }))));
  const step = Math.max(1, Math.floor(pool.length / n));
  return pool.filter((_, i) => i % step === 0).slice(0, n);
}

/** Chromium processes that did not exist before `before` was taken, with their summed RSS in MB. */
function chromeRssMb(before) {
  const out = execFileSync('ps', ['-eo', 'pid=,rss=,comm='], { encoding: 'utf8' });
  let kb = 0;
  for (const line of out.split('\n')) {
    const [pid, rss, comm] = line.trim().split(/\s+/);
    if (comm && /chrome/.test(comm) && !before.has(pid)) kb += Number(rss) || 0;
  }
  return kb / 1024;
}
const chromePids = () => new Set(execFileSync('ps', ['-eo', 'pid=,comm='], { encoding: 'utf8' }).split('\n').filter((l) => /chrome/.test(l)).map((l) => l.trim().split(/\s+/)[0]));

// the app tree is built once per process and shared by every part
const built = new Map();
const buildOnce = (tree) => {
  if (!built.has(tree)) built.set(tree, buildTree(tree));
  return built.get(tree);
};

/** Each model is measured in parts saved separately, so a restart loses at most one part. */
export const LLM_PARTS = ['speed', 'reading-A', 'reading-B', 'answers'];

export async function llmPart(E, tree, provider, model, part, { log = () => {}, reading = 100, rag = 24 } = {}) {
  const sq = await loadSquad();
  const ort = ortInfo(tree);
  const mirror = await startMirror({ cacheDir: CACHE, ortDir: ort.dir, ortVersion: ort.version });
  const outDir = await buildOnce(tree);
  const srv = await serve(outDir, true);
  // the collection for complete answers (embeddings come from the cache through the provider)
  const col = part === 'answers' && rag > 0 ? await buildCollection(E, provider, sq, { log }) : null;
  const before = chromePids();
  const chrome = await launch(mirror);
  let peak = 0;
  const sampler = setInterval(() => {
    try {
      peak = Math.max(peak, chromeRssMb(before));
    } catch {
      /* ps not available */
    }
  }, 500);
  const result = { model, part };
  try {
    const page = await openBench(chrome, srv.url);
    // cold load: download (local mirror, empty browser cache) + session creation
    mirror.resetStats();
    result.loadMs = await page.call('load', 'gen', model);
    result.downloadBytes = mirror.stats().bytes;
    result.status = (await page.info()).statuses.gen;
    log(`llm ${model} [${part}]: loaded in ${Math.round(result.loadMs)} ms, ${Math.round(result.downloadBytes / 1e6)} MB, ${JSON.stringify(result.status)}`);

    if (part === 'speed') {
      // first token and writing speed on fixed prompts (the same texts as the speed suite)
      const ctx = sq[3].paragraphs.map((p) => p.context).join('\n\n');
      result.prompts = {};
      for (const [name, chars] of [['short', 1000], ['long', 4000]]) {
        const messages = [
          { role: 'system', content: 'Answer the question using only the context.' },
          { role: 'user', content: `Context:\n${ctx.slice(0, chars)}\n\nQuestion: What is this text about?` },
        ];
        const runs = [];
        for (let r = 0; r < 2; r++) {
          const x = await page.call('generate', model, messages, 64);
          runs.push({ promptTokens: x.promptTokens, completionTokens: x.completionTokens, firstTokenMs: x.firstTokenMs, decodeTokPerSec: (x.completionTokens - 1) / ((x.wallMs - x.firstTokenMs) / 1000) });
        }
        result.prompts[name] = { runs, promptTokens: runs[0].promptTokens, firstTokenMs: median(runs.map((x) => x.firstTokenMs)), decodeTokPerSec: median(runs.map((x) => x.decodeTokPerSec)) };
        log(`llm ${model}: ${name} prompt (${runs[0].promptTokens} tok) first token ${Math.round(result.prompts[name].firstTokenMs)} ms, ${result.prompts[name].decodeTokPerSec.toFixed(2)} tok/s`);
      }
    } else if (part.startsWith('reading-')) {
      // reading accuracy: right paragraph given, short answer, gold text contained
      const split = part.slice(-1);
      const qs = readingQuestions(sq, split, reading);
      const per = [];
      const f1 = [];
      const tokens = [];
      const texts = [];
      const t0 = performance.now();
      for (const q of qs) {
        const x = await page.call('generate', model, [{ role: 'system', content: 'Answer with a short phrase copied from the context.' }, { role: 'user', content: `Context:\n${q.context}\n\nQuestion: ${q.question}` }], 24);
        per.push(contains(q.answers, x.text) ? 1 : 0);
        f1.push(+tokenF1(x.text, q.answers).toFixed(4));
        tokens.push(x.completionTokens);
        texts.push(String(x.text).slice(0, 200));
      }
      const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      result.reading = { split, n: qs.length, accuracy: avg(per), f1: avg(f1), answerTokens: avg(tokens), per, perF1: f1, perTokens: tokens, texts, ids: qs.map((q) => q.id), seconds: (performance.now() - t0) / 1000 };
      log(`llm ${model}: reading ${split} ${(100 * result.reading.accuracy).toFixed(1)}% of ${qs.length}, F1 ${(100 * result.reading.f1).toFixed(1)}, ${result.reading.answerTokens.toFixed(1)} answer tokens`);
    } else if (part === 'answers' && col) {
      // complete answers through the pipeline with the tree's in-browser settings and this model
      await page.call('loadSets', packSets(col));
      const picks = questions(col, 'B', 211).slice(0, rag);
      const answers = [];
      for (const q of picks) {
        const a = await page.call('answer', q.question, { browserModel: model });
        answers.push({ id: q.id, totalMs: a.timings.total, promptTokens: a.gen?.promptTokens ?? null, completionTokens: a.gen?.completionTokens ?? null, gold: contains(q.answers, a.answer) ? 1 : 0, support: a.support, error: a.error });
      }
      result.answers = { n: answers.length, questions: answers, totalMs: quantiles(answers.map((a) => a.totalMs)), gold: answers.reduce((s, a) => s + a.gold, 0) / answers.length, errors: answers.filter((a) => a.error).length };
      log(`llm ${model}: ${answers.length} answers, median ${Math.round(result.answers.totalMs.median / 1000)} s, gold ${(100 * result.answers.gold).toFixed(1)}%`);
    }
    await page.close();
  } finally {
    clearInterval(sampler);
    result.peakMemoryMb = Math.round(peak);
    await chrome.close();
    await srv.close();
    await mirror.close();
  }
  log(`llm ${model} [${part}]: peak browser memory ${result.peakMemoryMb} MB`);
  return result;
}
