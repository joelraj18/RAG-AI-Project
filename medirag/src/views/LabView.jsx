import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Play, Square, Download, Trash2, History, BookOpenCheck, BarChart3, Grid3x3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Button, Card, CardHeader, Badge, Progress, Empty, Modal, cx, download, inputCls } from '../components/ui.jsx';
import EvalPanel from '../components/EvalPanel.jsx';
import Markdown from '../components/Markdown.jsx';
import { runQuestion } from '../lib/pipeline.js';
import { BENCH_CONFIGS } from '../lib/settings.js';
import { NOTEBOOK_QUESTIONS, NOTEBOOK_REFERENCE } from '../lib/prompts.js';
import { providerLabel } from '../lib/llm.js';
import { db } from '../lib/db.js';
import { fmtMs, uid } from '../lib/text.js';

const avg = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const f1 = (x, d = 2) => (x == null ? '–' : x.toFixed(d));

function summarize(run) {
  return run.configs.map((c) => {
    const rs = run.results.filter((r) => r.configId === c.id && r.rec);
    const R = rs.map((r) => r.rec);
    return {
      id: c.id,
      name: c.name,
      n: R.length,
      groundedness: avg(R.map((r) => r.eval?.judge?.groundedness?.score)),
      relevance: avg(R.map((r) => r.eval?.judge?.relevance?.score)),
      support: avg(R.map((r) => (r.eval?.heuristic?.support?.rows?.length ? r.eval.heuristic.support.share * 100 : null))),
      citations: avg(R.map((r) => (r.eval?.heuristic?.citations?.precision != null ? r.eval.heuristic.citations.precision * 100 : null))),
      latency: avg(R.map((r) => r.timings.total / 1000)),
      retrieval: avg(R.map((r) => (r.timings.queryEmbed || 0) + (r.timings.search || 0))),
      generation: avg(R.map((r) => r.timings.generation)),
      evaluation: avg(R.map((r) => r.timings.evaluation)),
      promptTokens: avg(R.map((r) => r.gen?.promptTokens)),
      answerTokens: avg(R.map((r) => r.gen?.completionTokens)),
      truncated: R.filter((r) => r.gen?.truncated).length,
      errors: R.filter((r) => r.error).length,
    };
  });
}

function toCSV(run) {
  const head = ['config', 'question', 'groundedness', 'relevance', 'lexical_support_pct', 'citation_validity_pct', 'total_ms', 'retrieval_ms', 'generation_ms', 'evaluation_ms', 'prompt_tokens', 'answer_tokens', 'finish_reason', 'pages', 'answer'];
  const rows = run.results.map(({ configId, question, rec: r }) => [
    configId,
    question,
    r?.eval?.judge?.groundedness?.score ?? '',
    r?.eval?.judge?.relevance?.score ?? '',
    r?.eval ? Math.round(r.eval.heuristic.support.share * 100) : '',
    r?.eval?.heuristic?.citations?.precision != null ? Math.round(r.eval.heuristic.citations.precision * 100) : '',
    Math.round(r?.timings.total || 0),
    Math.round((r?.timings.queryEmbed || 0) + (r?.timings.search || 0)),
    Math.round(r?.timings.generation || 0),
    Math.round(r?.timings.evaluation || 0),
    r?.gen?.promptTokens ?? '',
    r?.gen?.completionTokens ?? '',
    r?.gen?.finishReason ?? r?.error ?? '',
    r?.sources?.map((s) => s.page).join(' '),
    r?.answer,
  ]);
  return [head, ...rows].map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

const cellColor = (s) =>
  s == null ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : s >= 4.5 ? 'bg-emerald-500 text-white' : s >= 3.5 ? 'bg-teal-400 text-white' : s >= 2.5 ? 'bg-amber-400 text-white' : 'bg-rose-500 text-white';

export default function LabView({ settings, activeManual, kb, openPage, embedStatus }) {
  const [questions, setQuestions] = useState(NOTEBOOK_QUESTIONS.join('\n'));
  const [selected, setSelected] = useState(['V', 'C1', 'C2', 'C3', 'C4', 'C5', 'H3']);
  const [run, setRun] = useState(null);
  const [progress, setProgress] = useState(null);
  const [history, setHistory] = useState([]);
  const [detail, setDetail] = useState(null);
  const abortRef = useRef(null);
  const llm = settings.provider !== 'extractive';

  useEffect(() => {
    db.listBenchmarks().then(setHistory);
  }, []);

  const summary = useMemo(() => (run ? summarize(run) : []), [run]);

  if (!activeManual) return <Empty icon={FlaskConical} title="Add a manual first">The Evaluation Lab benchmarks retrieval and generation settings on your manual.</Empty>;

  const semanticReady = activeManual.embedDone >= activeManual.chunkStats?.count || embedStatus[activeManual.id]?.finished;

  async function start() {
    const qs = questions.split('\n').map((q) => q.trim()).filter(Boolean);
    const configs = BENCH_CONFIGS.filter((c) => selected.includes(c.id) && (llm || !c.needsLLM));
    if (!qs.length || !configs.length || !kb) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const r = {
      id: uid(),
      createdAt: Date.now(),
      manual: activeManual.name,
      manualId: activeManual.id,
      provider: providerLabel(settings),
      judge: settings.judgeEnabled && llm,
      semantic: !!semanticReady,
      questions: qs,
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
        setProgress({ n, total, label: `${c.id} · ${q.slice(0, 70)}`, elapsed: performance.now() - t0 });
        const rec = await runQuestion({ question: q, manual: activeManual, kb, settings, cfg: { ...c.cfg, corrective: false }, signal: ctrl.signal });
        r.results.push({ configId: c.id, question: q, rec });
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
    'Lexical support (÷20)': s.support != null ? +(s.support / 20).toFixed(2) : null,
  }));
  const latencyData = summary.map((s) => ({
    name: s.id,
    Retrieval: s.retrieval != null ? +(s.retrieval / 1000).toFixed(2) : 0,
    Generation: s.generation != null ? +(s.generation / 1000).toFixed(2) : 0,
    Evaluation: s.evaluation != null ? +(s.evaluation / 1000).toFixed(2) : 0,
  }));

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Evaluation Lab</h1>
          <p className="text-sm text-slate-500">
            Reproduce the notebook's experiment on any manual: vanilla vs. RAG configurations C1–C5, scored by LLM-as-a-judge plus judge-free metrics, with timing per stage.
          </p>
        </div>

        <Card>
          <CardHeader icon={FlaskConical} title="Experiment setup" subtitle={`${activeManual.name} · ${providerLabel(settings)}`} />
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Questions (one per line)</label>
              <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={8} className={cx(inputCls, 'mt-1 font-mono text-xs')} />
            </div>
            <div>
              <label className="text-sm font-medium">Configurations</label>
              <div className="mt-1 grid gap-1.5">
                {BENCH_CONFIGS.map((c) => {
                  const disabled = c.needsLLM && !llm;
                  return (
                    <label key={c.id} className={cx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm dark:border-slate-800', disabled && 'opacity-40')}>
                      <input
                        type="checkbox"
                        className="accent-brand-600"
                        disabled={disabled}
                        checked={selected.includes(c.id)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))}
                      />
                      <Badge color="brand">{c.id}</Badge> {c.name}
                      {disabled && <span className="ml-auto text-[11px]">needs LLM</span>}
                    </label>
                  );
                })}
              </div>
              {!semanticReady && <p className="mt-2 text-xs text-amber-600">Semantic index not ready yet — semantic/MMR/hybrid configs fall back to BM25 until embeddings finish.</p>}
              {!llm && <p className="mt-2 text-xs text-amber-600">Extractive provider: no LLM judge, only judge-free metrics. Add an LLM in Settings for the full evaluation.</p>}
              <div className="mt-4 flex gap-2">
                {progress ? (
                  <Button variant="secondary" icon={Square} onClick={() => abortRef.current?.abort()}>Stop</Button>
                ) : (
                  <Button icon={Play} onClick={start} disabled={!kb}>Run experiment</Button>
                )}
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
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => download(new Blob([toCSV(run)], { type: 'text/csv' }), 'medirag-benchmark.csv')}>CSV</Button>
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => download(new Blob([JSON.stringify(run, null, 1)], { type: 'application/json' }), 'medirag-benchmark.json')}>JSON</Button>
                  </div>
                }
              />
              <div className="overflow-x-auto p-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase dark:border-slate-800">
                      <th className="py-2 pr-3">Config</th>
                      <th className="px-2">Groundedness</th>
                      <th className="px-2">Relevance</th>
                      <th className="px-2">Lexical support</th>
                      <th className="px-2">Citation validity</th>
                      <th className="px-2">Avg latency</th>
                      <th className="px-2">Retrieval</th>
                      <th className="px-2">Prompt / answer tok</th>
                      <th className="px-2">Truncated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="py-2 pr-3"><Badge color="brand">{s.id}</Badge> <span className="text-slate-600 dark:text-slate-300">{s.name}</span></td>
                        <td className="px-2 font-semibold tabular-nums">{f1(s.groundedness)}</td>
                        <td className="px-2 font-semibold tabular-nums">{f1(s.relevance)}</td>
                        <td className="px-2 tabular-nums">{s.support != null ? `${Math.round(s.support)}%` : '–'}</td>
                        <td className="px-2 tabular-nums">{s.citations != null ? `${Math.round(s.citations)}%` : '–'}</td>
                        <td className="px-2 tabular-nums">{s.latency != null ? `${s.latency.toFixed(1)} s` : '–'}</td>
                        <td className="px-2 tabular-nums">{fmtMs(s.retrieval)}</td>
                        <td className="px-2 tabular-nums">{s.promptTokens != null ? `${Math.round(s.promptTokens)} / ${Math.round(s.answerTokens)}` : '–'}</td>
                        <td className="px-2 tabular-nums">{s.truncated}/{s.n}{s.errors ? <Badge color="red" className="ml-1">{s.errors} err</Badge> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-6 px-5 pb-5 lg:grid-cols-2">
                <div className="h-64">
                  <h4 className="mb-1 text-xs font-semibold text-slate-500 uppercase">Quality (1–5)</h4>
                  <ResponsiveContainer>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis domain={[0, 5]} fontSize={12} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Groundedness" fill="#0d9488" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Relevance" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Lexical support (÷20)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
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
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Retrieval" stackId="t" fill="#8b5cf6" />
                      <Bar dataKey="Generation" stackId="t" fill="#14b8a6" />
                      <Bar dataKey="Evaluation" stackId="t" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={Grid3x3} title="Per-question heatmap" subtitle="Judge groundedness (or lexical support when no judge). Click a cell to inspect the answer and its evaluation." />
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
                          const r = run.results.find((x) => x.configId === c.id && x.question === q)?.rec;
                          const s = r?.eval?.judge?.groundedness?.score ?? (r?.eval ? 1 + 4 * r.eval.heuristic.support.share : null);
                          return (
                            <td key={i} className="p-0.5">
                              <button
                                disabled={!r}
                                onClick={() => setDetail({ rec: r, config: c })}
                                className={cx('h-10 w-14 rounded-md text-xs font-semibold transition hover:scale-105', cellColor(s))}
                              >
                                {s != null ? s.toFixed(r?.eval?.judge ? 0 : 1) : '·'}
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

        <Card>
          <CardHeader icon={BookOpenCheck} title="Reference: your Colab notebook results" subtitle="Mistral-7B-Instruct Q4 on a T4 GPU, gte-large + ChromaDB, Merck Manual 19th ed." />
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
                {NOTEBOOK_REFERENCE.map((r) => (
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

        {history.length > 0 && (
          <Card>
            <CardHeader icon={History} title="Saved experiments" subtitle="Stored in this browser" />
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                  <button className="font-medium hover:text-brand-700" onClick={() => setRun(h)}>
                    {new Date(h.createdAt).toLocaleString()}
                  </button>
                  <span className="text-xs text-slate-500">
                    {h.manual} · {h.provider} · {h.questions.length}Q × {h.configs.length} configs
                  </span>
                  <button className="ml-auto text-slate-400 hover:text-rose-600" aria-label="Delete run" onClick={async () => { await db.deleteBenchmark(h.id); setHistory(await db.listBenchmarks()); }}>
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
            {detail.rec.error ? <p className="text-rose-600">{detail.rec.error}</p> : <Markdown text={detail.rec.answer} onCite={(p) => openPage(p)} />}
            <EvalPanel rec={detail.rec} onOpenPage={(p, h) => openPage(p, h)} />
          </div>
        )}
      </Modal>
    </div>
  );
}
