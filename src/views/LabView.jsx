import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Play, Square, Download, Trash2, History, BookOpenCheck, BarChart3, Grid3x3, Save, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Button, Card, CardHeader, Badge, Progress, Empty, Modal, cx, download, inputCls, Toggle, PageHeader, LinkButton, useDialog } from '../components/ui.jsx';
import EvalPanel from '../components/EvalPanel.jsx';
import Markdown from '../components/Markdown.jsx';
import { runQuestion, slimRecord, hydrateRecord } from '../lib/pipeline.js';
import { parseExpected, retrievalMetrics } from '../lib/evaluate.js';
import { BENCH_CONFIGS } from '../lib/settings.js';
import { preset } from '../lib/presets.js';
import { providerLabel } from '../lib/llm.js';
import { vectorsReady } from '../lib/kb.js';
import { db } from '../lib/db.js';
import { fmtMs, uid, mean } from '../lib/text.js';
import { useStore } from '../state/store.jsx';
import { estimateLabCalls } from '../lib/hf.js';
import { PROVIDERS, llmReady, dataClass } from '../lib/providers.js';

const f2 = (x) => (x == null ? '–' : x.toFixed(2));
const pctS = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

/** "question | expected pages" per line */
function parseQuestions(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [q, exp] = l.split('|');
      return { question: q.trim(), expectedRaw: (exp || '').trim(), expected: parseExpected(exp || '') };
    });
}

function summarize(run) {
  return run.configs.map((c) => {
    const rows = run.results.filter((r) => r.configId === c.id && r.rec);
    const R = rows.map((r) => r.rec);
    const rm = rows.map((r) => r.retrieval).filter(Boolean);
    return {
      id: c.id,
      name: c.name,
      n: R.length,
      groundedness: mean(R.map((r) => r.eval?.judge?.groundedness)),
      relevance: mean(R.map((r) => r.eval?.judge?.relevance)),
      contextRel: mean(R.map((r) => r.eval?.judge?.contextRelevance)),
      support: mean(R.map((r) => (r.eval?.heuristic?.support?.rows?.length ? r.eval.heuristic.support.share : null))),
      citations: mean(R.map((r) => r.eval?.heuristic?.citations?.precision)),
      hit: rm.length ? mean(rm.map((m) => m.hit)) : null,
      recall: rm.length ? mean(rm.map((m) => m.recall)) : null,
      mrr: rm.length ? mean(rm.map((m) => m.rr)) : null,
      latency: mean(R.map((r) => r.timings.total / 1000)),
      retrieval: mean(R.map((r) => (r.timings.queryEmbed || 0) + (r.timings.search || 0) + (r.timings.rerank || 0) + (r.timings.expand || 0))),
      generation: mean(R.map((r) => r.timings.generation)),
      evaluation: mean(R.map((r) => r.timings.evaluation)),
      promptTokens: mean(R.map((r) => r.gen?.promptTokens)),
      answerTokens: mean(R.map((r) => r.gen?.completionTokens)),
      truncated: R.filter((r) => r.gen?.truncated).length,
      errors: R.filter((r) => r.error).length,
    };
  });
}

function toCSV(run) {
  const head = ['config', 'question', 'expected', 'hit', 'recall', 'reciprocal_rank', 'groundedness', 'relevance', 'context_relevance', 'claim_support', 'citation_validity', 'confidence', 'total_ms', 'retrieval_ms', 'generation_ms', 'evaluation_ms', 'prompt_tokens', 'answer_tokens', 'finish_reason', 'sources', 'answer'];
  const rows = run.results.map(({ configId, question, expectedRaw, retrieval: m, rec: r }) => [
    configId,
    question,
    expectedRaw,
    m?.hit ?? '',
    m?.recall ?? '',
    m?.rr ?? '',
    r?.eval?.judge?.groundedness ?? '',
    r?.eval?.judge?.relevance ?? '',
    r?.eval?.judge?.contextRelevance ?? '',
    r?.eval ? r.eval.heuristic.support.share.toFixed(3) : '',
    r?.eval?.heuristic?.citations?.precision ?? '',
    r?.eval?.confidence?.level ?? '',
    Math.round(r?.timings.total || 0),
    Math.round((r?.timings.queryEmbed || 0) + (r?.timings.search || 0) + (r?.timings.rerank || 0)),
    Math.round(r?.timings.generation || 0),
    Math.round(r?.timings.evaluation || 0),
    r?.gen?.promptTokens ?? '',
    r?.gen?.completionTokens ?? '',
    r?.gen?.finishReason ?? r?.error ?? '',
    r?.sources?.filter((s) => !s.neighbor).map((s) => `${s.docName} p.${s.page}`).join('; '),
    r?.answer,
  ]);
  return [head, ...rows].map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

const cellColor = (s) => (s == null ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : s >= 4.5 ? 'bg-emerald-500 text-white' : s >= 3.5 ? 'bg-brand-500 text-white' : s >= 2.5 ? 'bg-amber-400 text-white' : 'bg-rose-500 text-white');

export default function LabView() {
  const { settings, activeCollection, activeDocs, sets, kbLoading, kbOf, effectivePlan, setView } = useStore();
  const dialog = useDialog();
  const p = preset(settings.preset);
  const [questions, setQuestions] = useState('');
  const [selected, setSelected] = useState(['V', 'C1', 'C2', 'C3', 'C4', 'C5', 'H4']);
  const [retrievalOnly, setRetrievalOnly] = useState(false);
  const [run, setRun] = useState(null);
  const [progress, setProgress] = useState(null);
  const [history, setHistory] = useState([]);
  const [detail, setDetail] = useState(null);
  const abortRef = useRef(null);
  const llm = llmReady(settings) && !(settings.confidential && dataClass(settings) === 'cloud');

  useEffect(() => {
    db.listBenchmarks().then(setHistory);
  }, []);
  useEffect(() => {
    if (!activeCollection) return;
    (async () => {
      // saved set → preset samples → the suggested questions already generated for these documents
      let q = await db.getKV(`questions:${activeCollection.id}`);
      if (!q && p.sampleQuestions) q = p.sampleQuestions.join('\n');
      if (!q) {
        const lines = [];
        for (const id of activeCollection.docIds.slice(0, 3)) {
          const r = (await db.getKV(`suggest:${id}:llm`)) || (await db.getKV(`suggest:${id}:x`));
          lines.push(...(r?.questions || []).slice(0, 3));
        }
        q = lines.join('\n');
      }
      setQuestions(q || '');
    })();
    // keyed on the id so background refreshes (e.g. embedding finished) never wipe what you typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCollection?.id, p.sampleQuestions]);

  const summary = useMemo(() => (run ? summarize(run) : []), [run]);
  const hasLabels = run?.results.some((r) => r.retrieval);

  if (!activeCollection || !activeDocs.length) return <Empty icon={FlaskConical} title="Add a document first">The Evaluation Lab benchmarks retrieval and generation settings on your documents.</Empty>;
  const semanticReady = sets.length > 0 && sets.every((s) => vectorsReady(s.doc, s.kb));

  const runnable = BENCH_CONFIGS.filter((c) => selected.includes(c.id) && (llm || !c.needsLLM) && !(retrievalOnly && c.needsLLM));
  const qCount = parseQuestions(questions).length;
  const estCalls = estimateLabCalls(settings, runnable, qCount, retrievalOnly);
  const hfFree = settings.provider === 'hf' && effectivePlan === 'free';
  const callLimit = settings.provider === 'hf' ? (effectivePlan === 'pro' ? 400 : 40) : PROVIDERS[settings.provider]?.group === 'key' ? 150 : Infinity;

  async function start() {
    const qs = parseQuestions(questions);
    const configs = runnable;
    if (!qs.length || !configs.length || !sets.length) return;
    if (
      estCalls > callLimit &&
      !(await dialog.confirm(
        `This experiment will make about ${estCalls} LLM calls${hfFree ? ', which can use a large part of the free monthly Hugging Face credits' : PROVIDERS[settings.provider]?.group === 'key' ? `, billed to your ${PROVIDERS[settings.provider].label} account` : ''}. Tip: use “Retrieval only” to tune search for free, select fewer configurations, or turn the judge off.`,
        { title: 'Large experiment', confirmLabel: 'Run anyway' }
      ))
    )
      return;
    db.putKV(`questions:${activeCollection.id}`, questions);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // no usable LLM (extractive, missing key or Confidential mode): run with extractive answers
    const runSettings = llm ? settings : { ...settings, provider: 'extractive' };
    const r = {
      id: uid(),
      createdAt: Date.now(),
      collection: activeCollection.name,
      docs: activeDocs.map((d) => d.name),
      provider: retrievalOnly ? 'retrieval only' : providerLabel(runSettings),
      retrievalOnly,
      semantic: semanticReady,
      questions: qs.map((q) => q.question),
      configs: configs.map(({ id, name, cfg }) => ({ id, name, cfg })),
      results: [],
    };
    setRun({ ...r });
    const total = qs.length * configs.length;
    let n = 0;
    const t0 = performance.now();
    for (const c of configs) {
      for (const q of qs) {
        if (ctrl.signal.aborted) break;
        setProgress({ n, total, label: `${c.id} · ${q.question.slice(0, 70)}`, elapsed: performance.now() - t0 });
        const rec = await runQuestion({ question: q.question, sets, settings: runSettings, cfg: { ...c.cfg, corrective: false, retrievalOnly }, signal: ctrl.signal });
        const retrieval = c.cfg.vanilla ? null : retrievalMetrics(rec.sources, q.expected);
        r.results.push({ configId: c.id, question: q.question, expectedRaw: q.expectedRaw, retrieval, rec: slimRecord(rec) });
        n++;
        setRun({ ...r, results: [...r.results] });
      }
    }
    r.durationMs = performance.now() - t0;
    setRun({ ...r });
    setProgress(null);
    await db.putBenchmark(r);
    setHistory(await db.listBenchmarks());
  }

  const chartData = summary.map((s) => ({
    name: s.id,
    Groundedness: s.groundedness != null ? +s.groundedness.toFixed(2) : null,
    Relevance: s.relevance != null ? +s.relevance.toFixed(2) : null,
    'Claim support (×5)': s.support != null ? +(s.support * 5).toFixed(2) : null,
    'Hit@k (×5)': s.hit != null ? +(s.hit * 5).toFixed(2) : null,
  }));
  const latencyData = summary.map((s) => ({
    name: s.id,
    Retrieval: +((s.retrieval || 0) / 1000).toFixed(2),
    Generation: +((s.generation || 0) / 1000).toFixed(2),
    Evaluation: +((s.evaluation || 0) / 1000).toFixed(2),
  }));
  // quality = retrieval hit rate (if labelled) + judge groundedness (or claim support on the same 0–5 scale)
  const qualityOf = (s) => (s.hit ?? 0) * 5 + (s.groundedness ?? (s.support != null ? s.support * 5 : 0));
  const best = summary.length ? [...summary].sort((a, b) => qualityOf(b) - qualityOf(a) || a.latency - b.latency)[0] : null;
  const fastest = summary.length ? [...summary].sort((a, b) => a.latency - b.latency)[0] : null;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-8 px-4 pb-16 sm:px-6">
        <PageHeader
          title="Evaluation Lab"
          tagline="The best way to choose your settings"
          links={
            <>
              <span className="text-sm text-slate-500">Vanilla vs RAG · judged quality · retrieval accuracy · time per stage</span>
              <LinkButton onClick={() => setView('learn')}>Reading the metrics ↗</LinkButton>
            </>
          }
        />

        <Card>
          <CardHeader icon={FlaskConical} title="Experiment setup" subtitle={`${activeCollection.name} (${activeDocs.length} docs) · ${providerLabel(settings)}`} />
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Questions: one per line, optionally “question | expected pages”</label>
              <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={9} placeholder={'What is hybrid search? | 6\nHow is groundedness measured? | Guide p. 8'} className={cx(inputCls, 'mt-1 font-mono text-xs')} />
              <p className="mt-1 text-xs text-slate-500">
                <Target className="mr-1 inline h-3 w-3" />
                Adding the pages where the answer is (e.g. <code>12, 15</code> or <code>Manual p. 12</code>) enables retrieval accuracy: hit@k, recall@k and MRR.
              </p>
              <Button size="sm" variant="ghost" icon={Save} onClick={() => db.putKV(`questions:${activeCollection.id}`, questions)}>Save question set</Button>
            </div>
            <div>
              <label className="text-sm font-medium">Configurations</label>
              <div className="mt-1 grid gap-1.5">
                {BENCH_CONFIGS.map((c) => {
                  const disabled = (c.needsLLM && !llm) || (retrievalOnly && c.needsLLM);
                  return (
                    <label key={c.id} className={cx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm dark:border-slate-800', disabled && 'opacity-40')}>
                      <input type="checkbox" className="accent-brand-600" disabled={disabled} checked={selected.includes(c.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
                      <Badge color="brand">{c.id}</Badge> {c.name}
                      {c.needsLLM && !llm && <span className="ml-auto text-[11px]">needs LLM</span>}
                    </label>
                  );
                })}
              </div>
              <div className="mt-3">
                <Toggle checked={retrievalOnly} onChange={setRetrievalOnly} label="Retrieval only (instant, no LLM)" hint="Tune k and search modes quickly with hit@k / recall / MRR; skips generation and judging." />
              </div>
              {!semanticReady && <p className="mt-2 text-xs text-amber-600">Semantic index not ready for every document. Semantic, MMR and hybrid/configs fall back to keyword search there.</p>}
              {!llm && !retrievalOnly && <p className="mt-2 text-xs text-amber-600">No language model ready (Extractive, a missing key or Confidential mode): answers are extractive and only judge-free metrics are computed.</p>}
              {qCount > 0 && (
                <p className={`mt-3 text-xs ${estCalls > callLimit ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500'}`}>
                  {retrievalOnly || !llm
                    ? `${runnable.length} configs × ${qCount} questions, no LLM calls.`
                    : `${runnable.length} configs × ${qCount} questions ≈ ${estCalls} LLM calls${settings.provider === 'hf' ? ` (${effectivePlan === 'pro' ? 'PRO' : 'Free'} plan)` : ''}.${estCalls > callLimit ? ' That is a lot for your plan, so consider fewer configs or Retrieval only.' : ''}`}
                </p>
              )}
              <div className="mt-4">
                {progress ? <Button variant="secondary" icon={Square} onClick={() => abortRef.current?.abort()}>Stop</Button> : <Button icon={Play} onClick={start} disabled={kbLoading || !questions.trim()}>Run experiment</Button>}
              </div>
            </div>
          </div>
          {progress && (
            <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span className="truncate">Running {progress.label}…</span>
                <span>{progress.n}/{progress.total} · {fmtMs(progress.elapsed)}</span>
              </div>
              <Progress value={progress.n / progress.total} />
            </div>
          )}
        </Card>

        {run && summary.length > 0 && (
          <>
            <Card>
              <CardHeader
                icon={BarChart3}
                title="Results by configuration"
                subtitle={`${run.questions.length} questions · ${run.provider}${run.durationMs ? ` · finished in ${fmtMs(run.durationMs)}` : ''}`}
                right={
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => download(new Blob([toCSV(run)], { type: 'text/csv' }), 'rag-benchmark.csv')}>CSV</Button>
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => download(new Blob([JSON.stringify(run)], { type: 'application/json' }), 'rag-benchmark.json')}>JSON</Button>
                  </div>
                }
              />
              {best && !progress && (
                <div className="mx-5 mt-4 flex flex-wrap gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-900/30 dark:text-brand-100">
                  <span>🎯 Best quality: <b>{best.id}</b> ({best.name})</span>
                  <span>⚡ Fastest: <b>{fastest.id}</b> ({fastest.latency.toFixed(2)} s/question)</span>
                </div>
              )}
              <div className="overflow-x-auto p-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase dark:border-slate-800">
                      <th className="py-2 pr-3">Config</th>
                      {hasLabels && <th className="px-2" title="Share of questions where an expected page was retrieved">Hit@k</th>}
                      {hasLabels && <th className="px-2">Recall</th>}
                      {hasLabels && <th className="px-2" title="Mean reciprocal rank of the first correct page">MRR</th>}
                      {!run.retrievalOnly && <th className="px-2">Grounded</th>}
                      {!run.retrievalOnly && <th className="px-2">Relevance</th>}
                      {!run.retrievalOnly && <th className="px-2">Claim support</th>}
                      {!run.retrievalOnly && <th className="px-2">Citations</th>}
                      <th className="px-2">Avg latency</th>
                      <th className="px-2">Retrieval</th>
                      {!run.retrievalOnly && <th className="px-2">Tokens in / out</th>}
                      {!run.retrievalOnly && <th className="px-2">Truncated</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="py-2 pr-3"><Badge color="brand">{s.id}</Badge> <span className="text-slate-600 dark:text-slate-300">{s.name}</span></td>
                        {hasLabels && <td className="px-2 font-semibold tabular-nums">{pctS(s.hit)}</td>}
                        {hasLabels && <td className="px-2 tabular-nums">{pctS(s.recall)}</td>}
                        {hasLabels && <td className="px-2 tabular-nums">{f2(s.mrr)}</td>}
                        {!run.retrievalOnly && <td className="px-2 font-semibold tabular-nums">{f2(s.groundedness)}</td>}
                        {!run.retrievalOnly && <td className="px-2 tabular-nums">{f2(s.relevance)}</td>}
                        {!run.retrievalOnly && <td className="px-2 tabular-nums">{pctS(s.support)}</td>}
                        {!run.retrievalOnly && <td className="px-2 tabular-nums">{pctS(s.citations)}</td>}
                        <td className="px-2 tabular-nums">{s.latency != null ? `${s.latency.toFixed(2)} s` : '–'}</td>
                        <td className="px-2 tabular-nums">{fmtMs(s.retrieval)}</td>
                        {!run.retrievalOnly && <td className="px-2 tabular-nums">{s.promptTokens != null ? `${Math.round(s.promptTokens)} / ${Math.round(s.answerTokens)}` : '–'}</td>}
                        {!run.retrievalOnly && (
                          <td className="px-2 tabular-nums">
                            {s.truncated}/{s.n}
                            {s.errors ? <Badge color="red" className="ml-1">{s.errors} err</Badge> : null}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-6 px-5 pb-5 lg:grid-cols-2">
                <div className="h-64">
                  <h4 className="mb-1 text-xs font-semibold text-slate-500 uppercase">Quality (0–5)</h4>
                  <ResponsiveContainer>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis domain={[0, 5]} fontSize={12} />
                      <Tooltip cursor={{ fill: 'rgba(120,120,128,0.08)' }} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '2px 4px 16px rgba(0,0,0,0.12)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Groundedness" fill="#0071e3" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Relevance" fill="#5e5ce6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Claim support (×5)" fill="#ff9f0a" radius={[4, 4, 0, 0]} />
                      {hasLabels && <Bar dataKey="Hit@k (×5)" fill="#ff375f" radius={[4, 4, 0, 0]} />}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-64">
                  <h4 className="mb-1 text-xs font-semibold text-slate-500 uppercase">Average time per question (s)</h4>
                  <ResponsiveContainer>
                    <BarChart data={latencyData}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip cursor={{ fill: 'rgba(120,120,128,0.08)' }} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '2px 4px 16px rgba(0,0,0,0.12)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Retrieval" stackId="t" fill="#5e5ce6" />
                      <Bar dataKey="Generation" stackId="t" fill="#0071e3" />
                      <Bar dataKey="Evaluation" stackId="t" fill="#ff9f0a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={Grid3x3} title="Per-question heatmap" subtitle="Judge groundedness (or claim support ×5 without a judge; hit/miss in retrieval-only mode). Click a cell to inspect." />
              <div className="overflow-x-auto p-5">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th />
                      {run.questions.map((q, i) => (
                        <th key={i} className="px-1 pb-2 text-xs font-medium text-slate-500" title={q}>Q{i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {run.configs.map((c) => (
                      <tr key={c.id}>
                        <td className="pr-3 text-xs font-semibold">{c.id}</td>
                        {run.questions.map((q, i) => {
                          const row = run.results.find((x) => x.configId === c.id && x.question === q);
                          const r = row?.rec;
                          const s = run.retrievalOnly ? (row?.retrieval ? row.retrieval.hit * 5 : null) : r?.eval?.judge?.groundedness ?? (r?.eval ? 1 + 4 * r.eval.heuristic.support.share : null);
                          return (
                            <td key={i} className="p-0.5">
                              <button disabled={!r} onClick={() => setDetail({ rec: hydrateRecord(r, kbOf), config: c, row })} className={cx('h-10 w-14 rounded-md text-xs font-semibold transition hover:scale-105', cellColor(s))}>
                                {s == null ? '·' : run.retrievalOnly ? (row.retrieval.hit ? 'hit' : 'miss') : s.toFixed(r?.eval?.judge ? 0 : 1)}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {p.reference && (
          <Card>
            <CardHeader icon={BookOpenCheck} title="Reference: Colab notebook results" subtitle="Mistral-7B-Instruct Q4 on a T4 GPU, gte-large + ChromaDB, Merck Manual 19th ed. (shown for the Medical preset)" />
            <div className="overflow-x-auto p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase dark:border-slate-800">
                    <th className="py-2">Approach</th>
                    <th>Groundedness</th>
                    <th>Relevance</th>
                    <th>Avg latency</th>
                    <th>Truncated</th>
                  </tr>
                </thead>
                <tbody>
                  {p.reference.map((r) => (
                    <tr key={r.approach} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className="py-1.5">{r.approach}</td>
                      <td className="font-semibold">{r.groundedness.toFixed(1)}</td>
                      <td>{r.relevance.toFixed(1)}</td>
                      <td>{r.latency} s</td>
                      <td>{r.truncated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {history.length > 0 && (
          <Card>
            <CardHeader icon={History} title="Saved experiments" subtitle="Stored in this browser (chunk references only, to save space)" />
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                  <button className="font-medium hover:text-brand-700" onClick={() => setRun(h)}>{new Date(h.createdAt).toLocaleString()}</button>
                  <span className="text-xs text-slate-500">
                    {h.collection} · {h.provider} · {h.questions.length}Q × {h.configs.length} configs
                  </span>
                  <button
                    className="ml-auto text-slate-400 hover:text-rose-600"
                    aria-label="Delete run"
                    onClick={async () => {
                      await db.deleteBenchmark(h.id);
                      setHistory(await db.listBenchmarks());
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.config.id} · ${detail.rec.question}` : ''} wide>
        {detail && (
          <div className="p-5">
            {detail.row?.retrieval && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                <Badge color={detail.row.retrieval.hit ? 'green' : 'red'}>{detail.row.retrieval.hit ? `hit at rank ${detail.row.retrieval.firstRank}` : 'expected page not retrieved'}</Badge>
                <Badge>expected: {detail.row.expectedRaw}</Badge>
              </div>
            )}
            {detail.rec.error ? <p className="text-rose-600">{detail.rec.error}</p> : detail.rec.answer && <Markdown text={detail.rec.answer} />}
            <EvalPanel rec={detail.rec} />
          </div>
        )}
      </Modal>
    </div>
  );
}
