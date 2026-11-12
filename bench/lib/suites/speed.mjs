// Speed of the local models in headless Chromium (WASM, no GPU), always through the tree's own code:
// document indexing (ingestFile + EmbedJob with IndexedDB), query embedding, reranking, the
// in-browser LLM (load, prefill, decode) and complete answers with that tree's in-browser defaults.
import { startMirror } from '../mirror.mjs';
import { buildTree, serve, launch, openBench, ortInfo } from '../browser.mjs';
import { CACHE, squad as loadSquad } from '../data.mjs';
import { quantiles, normText } from '../metrics.mjs';
import { buildCollection, questions } from './squad.mjs';

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
const median = (xs) => quantiles(xs)?.median ?? null;

export async function speedSuite(E, tree, { isolated, provider, log = () => {}, reps = 3, ragQuestions = 8 }) {
  const S = E.settings.DEFAULT_SETTINGS;
  const sq = await loadSquad();
  const ort = ortInfo(tree);
  const mirror = await startMirror({ cacheDir: CACHE, ortDir: ort.dir, ortVersion: ort.version });
  const outDir = await buildTree(tree);
  const srv = await serve(outDir, isolated);
  const chrome = await launch(mirror);
  const result = { isolated, reps };
  try {
    // ---------- 1. document indexing (cold start per rep) ----------
    const files = sq.slice(0, 10).map((a) => ({ name: `${a.title}.txt`, text: a.paragraphs.map((p) => p.context).join('\n\n') }));
    const runs = [];
    let warm = null;
    for (let r = 0; r < reps; r++) {
      mirror.resetStats();
      const b = await openBench(chrome, srv.url);
      const docs = await b.call('indexDocs', files, { chunkSize: S.chunkSize, chunkOverlap: S.chunkOverlap, embedModel: S.embedModel });
      const info = await b.info();
      const rest = docs.slice(1);
      const chunks = rest.reduce((s, d) => s + d.chunks, 0);
      runs.push({
        firstDocMs: docs[0].ingestMs + docs[0].embedMs,
        chunksPerSec: chunks / (rest.reduce((s, d) => s + d.embedMs, 0) / 1000),
        ingestMs: docs.reduce((s, d) => s + d.ingestMs, 0),
        chunks: docs.reduce((s, d) => s + d.chunks, 0),
        downloadBytes: mirror.stats().bytes,
        device: info.statuses.embed,
        crossOriginIsolated: info.crossOriginIsolated,
        warnings: b.warnings,
      });
      log(`speed(${isolated ? 'isolated' : 'not isolated'}) index rep ${r + 1}: ${runs.at(-1).chunksPerSec.toFixed(1)} chunks/s, first doc ${Math.round(runs.at(-1).firstDocMs)} ms, ${JSON.stringify(info.statuses.embed)}`);
      if (r < reps - 1) await b.close();
      else warm = b;
    }
    result.indexing = { runs, chunksPerSec: median(runs.map((x) => x.chunksPerSec)), firstDocMs: median(runs.map((x) => x.firstDocMs)), ingestMs: median(runs.map((x) => x.ingestMs)), chunks: runs[0].chunks, downloadBytes: runs[0].downloadBytes };

    // ---------- 2. query embedding latency (warm, unique questions) ----------
    const qs = questions({ docs: sq.map((a) => ({ name: a.title, paragraphs: a.paragraphs.map((p) => ({ ...p, page: 1 })) })) }, 'B', 97).slice(0, 40);
    const qms = await warm.call('timeQueries', S.embedModel, qs.map((q) => `${q.question} (${q.id})`));
    result.queryEmbedMs = quantiles(qms);

    // ---------- 3. rerank latency (20 passages) ----------
    const passages = sq.slice(10, 30).map((a) => a.paragraphs[0].context);
    mirror.resetStats();
    const t0 = performance.now();
    await warm.call('rerank', 'warm up', ['warm up']);
    result.rerankLoadMs = performance.now() - t0;
    result.rerankDownloadBytes = mirror.stats().bytes;
    const rms = [];
    for (const q of qs.slice(0, 10)) rms.push((await warm.call('rerank', q.question, passages)).ms);
    result.rerank20Ms = quantiles(rms);
    log(`speed: query embed p50 ${Math.round(result.queryEmbedMs.median)} ms, rerank 20 p50 ${Math.round(result.rerank20Ms.median)} ms`);
    await warm.close();

    // ---------- 4. in-browser LLM: cold load, then prefill / decode with fixed prompts ----------
    const model = S.browserModel;
    mirror.resetStats();
    const g = await openBench(chrome, srv.url);
    const loadMs = await g.call('load', 'gen', model);
    result.llm = { model, loadMs, downloadBytes: mirror.stats().bytes, prompts: {} };
    const ctx = sq[3].paragraphs.map((p) => p.context).join('\n\n');
    for (const [name, chars] of [['short', 1000], ['long', 4000]]) {
      const messages = [
        { role: 'system', content: 'Answer the question using only the context.' },
        { role: 'user', content: `Context:\n${ctx.slice(0, chars)}\n\nQuestion: What is this text about?` },
      ];
      const rs = [];
      for (let r = 0; r < 2; r++) rs.push(await g.call('generate', model, messages, 64));
      const best = rs.map((x) => ({ promptTokens: x.promptTokens, completionTokens: x.completionTokens, firstTokenMs: x.firstTokenMs, decodeTokPerSec: (x.completionTokens - 1) / ((x.wallMs - x.firstTokenMs) / 1000), wallMs: x.wallMs, device: x.device }));
      result.llm.prompts[name] = { runs: best, promptTokens: best[0].promptTokens, firstTokenMs: median(best.map((x) => x.firstTokenMs)), decodeTokPerSec: median(best.map((x) => x.decodeTokPerSec)) };
      log(`speed: LLM ${name} prompt (${best[0].promptTokens} tok): first token ${Math.round(result.llm.prompts[name].firstTokenMs)} ms, decode ${result.llm.prompts[name].decodeTokPerSec.toFixed(1)} tok/s`);
    }
    result.llm.statuses = (await g.info()).statuses;

    // ---------- 5. complete answers with this tree's in-browser defaults ----------
    if (ragQuestions > 0 && provider) {
      const col = await buildCollection(E, provider, sq, { log });
      await g.call(
        'loadSets',
        col.docs.map((d) => ({ id: d.id, name: d.name, model: col.model, dim: d.vectors.dim, chunks: d.chunks, q: b64(d.vectors.q), scales: b64(d.vectors.scales) }))
      );
      const picks = questions(col, 'B', 211).slice(0, ragQuestions);
      const answers = [];
      for (const q of picks) {
        const a = await g.call('answer', q.question);
        const gold = q.answers.map(normText);
        answers.push({ id: q.id, totalMs: a.timings.total, generationMs: a.timings.generation, evaluationMs: a.timings.evaluation, judged: a.judged, promptTokens: a.gen?.promptTokens ?? null, completionTokens: a.gen?.completionTokens ?? null, contextTokens: a.contextTokens, goldInAnswer: gold.some((x) => normText(a.answer).includes(x)) ? 1 : 0, support: a.support, error: a.error, config: a.config });
        log(`speed: answer ${answers.length}/${picks.length} in ${Math.round(a.timings.total)} ms (${a.gen?.promptTokens} prompt tokens, judge ${a.judged ? 'on' : 'off'})${a.error ? ` ERROR ${a.error}` : ''}`);
      }
      result.answers = { questions: answers, totalMs: quantiles(answers.map((a) => a.totalMs)), goldInAnswer: answers.reduce((s, a) => s + a.goldInAnswer, 0) / answers.length, promptTokens: quantiles(answers.map((a) => a.promptTokens)) };
    }
    await g.close();
    result.browser = { crossOriginIsolated: runs[0].crossOriginIsolated, embed: runs[0].device, gen: result.llm.statuses?.gen || null };
    result.unexpectedRequests = mirror.stats().unexpected;
  } finally {
    await chrome.close();
    await srv.close();
    await mirror.close();
  }
  return result;
}
