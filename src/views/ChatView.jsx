import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Square, Loader2, Sparkles, Columns2, FileText, Bot, User, Download, Upload, AlertCircle, KeyRound, Gauge, BarChart3, ThumbsUp, ThumbsDown } from 'lucide-react';
import Markdown from '../components/Markdown.jsx';
import EvalPanel, { ConfidenceBadge } from '../components/EvalPanel.jsx';
import Dashboard from '../components/Dashboard.jsx';
import { Badge, Button, Empty, cx, download, ScoreRing } from '../components/ui.jsx';
import { runQuestion, hydrateRecord, suggestQuestions } from '../lib/pipeline.js';
import { resolveCitation } from '../lib/evaluate.js';
import { providerLabel } from '../lib/llm.js';
import { preset } from '../lib/presets.js';
import { matchProfile, PROFILES } from '../lib/settings.js';
import { vectorsReady } from '../lib/kb.js';
import { db } from '../lib/db.js';
import { fmtMs, uid } from '../lib/text.js';
import { useStore } from '../state/store.jsx';
import SecretInput from '../components/SecretInput.jsx';

const PHASE = {
  retrieving: 'Retrieving relevant passages…',
  generating: 'Generating grounded answer…',
  evaluating: 'Evaluating groundedness & relevance…',
  correcting: 'Weak grounding — rewriting the query and retrying…',
};

function AnswerCard({ rec, title, compact, multiDoc }) {
  const { openPage, docs } = useStore();
  const busy = !['done', 'error'].includes(rec.phase);
  const j = rec.eval?.judge;
  const onCite = (c) => {
    const r = resolveCitation(c, rec.sources, docs);
    if (r) openPage(r.docId, r.page, r.keys);
  };
  return (
    <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge color={rec.kind === 'vanilla' ? 'amber' : 'brand'}>
          <Bot className="h-3 w-3" /> {title}
        </Badge>
        <Badge>{rec.model.split('/').pop()}</Badge>
        {rec.kind === 'rag' && (
          <Badge color="violet">
            {rec.effectiveMode || rec.config.mode} · k={rec.config.k}
            {rec.config.rerank ? ' · rerank' : ''}
          </Badge>
        )}
        {rec.phase === 'done' && rec.timings.total != null && <Badge color="blue">{fmtMs(rec.timings.total)}</Badge>}
        {j?.groundedness != null && <Badge color={j.groundedness >= 4 ? 'green' : 'amber'}>grounded {j.groundedness}/5</Badge>}
        {rec.phase === 'done' && <ConfidenceBadge conf={rec.eval?.confidence} />}
        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {PHASE[rec.phase]}
          </span>
        )}
      </div>
      {rec.error ? (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {rec.error}
        </div>
      ) : (
        <Markdown text={rec.answer || (busy ? '' : '_No answer_')} onCite={onCite} streaming={rec.phase === 'generating'} showNames={multiDoc} />
      )}
      {!compact && (rec.eval || rec.sources.length > 0) && <EvalPanel rec={rec} />}
      {compact && rec.eval && (
        <div className="mt-3 flex items-center justify-around border-t border-slate-100 pt-3 dark:border-slate-800">
          <ScoreRing size={52} score={j?.groundedness ?? null} label="Grounded" />
          <ScoreRing size={52} score={j?.relevance ?? null} label="Relevance" />
          <ScoreRing size={52} score={rec.eval.heuristic.support.rows.length ? rec.eval.heuristic.support.share * 100 : null} max={100} label="Claim support" />
        </div>
      )}
    </div>
  );
}

export default function ChatView() {
  const store = useStore();
  const { settings, setSettings, activeCollection, activeDocs, sets, kbLoading, embedStatus, setView, newSession, saveSession, kbOf, importSession, sessions, activeSessionId } = store;
  const session = sessions.find((s) => s.id === activeSessionId) || null;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState(false);
  const [dash, setDash] = useState(false);
  const [suggested, setSuggested] = useState([]);
  const [editingToken, setEditingToken] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const importRef = useRef(null);

  const messages = useMemo(
    () => (session?.messages || []).map((m) => ({ ...m, rag: hydrateRecord(m.rag, kbOf), vanilla: hydrateRecord(m.vanilla, kbOf) })),
    [session, kbOf, sets] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const last = messages[messages.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, last?.rag?.phase]);

  // starter questions: preset samples, cached per document, or generated once
  const p = preset(settings.preset);
  const docKey = activeDocs.map((d) => d.id).join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (p.sampleQuestions) return setSuggested(p.sampleQuestions);
      const out = [];
      for (const s of sets.slice(0, 3)) {
        const key = `suggest:${s.doc.id}:${settings.provider === 'extractive' ? 'x' : 'llm'}`;
        let qs = await db.getKV(key);
        if (!qs) {
          qs = await suggestQuestions(settings, s.doc, s.kb);
          if (qs.length) await db.putKV(key, qs);
        }
        out.push(...qs.slice(0, sets.length > 1 ? 2 : 5));
      }
      if (!cancelled) setSuggested(out.slice(0, 6));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, sets.length, settings.provider, settings.preset]);

  if (!activeCollection || !activeDocs.length) {
    return (
      <Empty icon={FileText} title="Add a document to start">
        Upload a PDF, Word, HTML, Markdown or text file in <b>Documents</b>, or load the built-in guide to RAG. Files are parsed, cleaned, chunked and indexed in your browser and stay stored for future sessions.
        <div className="mt-4">
          <Button onClick={() => setView('library')}>Open Documents</Button>
        </div>
      </Empty>
    );
  }

  const semanticReady = sets.length > 0 && sets.every((s) => vectorsReady(s.doc, s.kb));
  const embedding = activeDocs.map((d) => embedStatus[d.id]).filter((e) => e?.running);
  const profile = matchProfile(settings);
  const noGpu = typeof navigator !== 'undefined' && !('gpu' in navigator);

  async function ask(q) {
    const question = (q ?? input).trim();
    if (!question || busy || kbLoading || !sets.length) return;
    setInput('');
    setEditingToken(false);
    setBusy(true);
    let s = session || newSession();
    if (s.title === 'New session') s = { ...s, title: question.length > 60 ? question.slice(0, 57) + '…' : question };
    const history = messages.map((m) => m.rag).filter(Boolean);
    const idx = s.messages.length;
    s = saveSession({ ...s, messages: [...s.messages, { id: uid(), question, rag: null, vanilla: null }] });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const phases = {};
    const patch = (key) => (rec) => {
      const msgs = [...s.messages];
      msgs[idx] = { ...msgs[idx], [key]: rec };
      s = { ...s, messages: msgs };
      // persist only when the phase changes (≈5 writes per answer instead of one per token)
      const changed = phases[key] !== rec.phase;
      phases[key] = rec.phase;
      saveSession(s, changed);
    };
    const tasks = [() => runQuestion({ question, sets, settings, history, onUpdate: patch('rag'), signal: ctrl.signal })];
    if (compare && settings.provider !== 'extractive')
      tasks.push(() => runQuestion({ question, sets, settings, cfg: { vanilla: true, corrective: false, judgeMode: settings.judgeMode === 'off' ? 'off' : 'combined' }, onUpdate: patch('vanilla'), signal: ctrl.signal }));
    if (settings.provider === 'browser') for (const t of tasks) await t();
    else await Promise.all(tasks.map((t) => t()));
    setBusy(false);
  }

  function setFeedback(i, value) {
    const msgs = [...session.messages];
    msgs[i] = { ...msgs[i], feedback: msgs[i].feedback === value ? null : value };
    saveSession({ ...session, messages: msgs });
  }

  function exportMarkdown() {
    const lines = [`# ${session.title}`, `Documents: ${activeDocs.map((d) => d.name).join(', ')}`, ''];
    messages.forEach((m, i) => {
      const r = m.rag;
      lines.push(`## Q${i + 1}. ${m.question}`, '', r?.answer || '', '');
      if (r?.eval) {
        const j = r.eval.judge;
        const h = r.eval.heuristic;
        lines.push(
          `- Time: ${fmtMs(r.timings.total)} (retrieval ${fmtMs((r.timings.queryEmbed || 0) + (r.timings.search || 0) + (r.timings.rerank || 0))}, generation ${fmtMs(r.timings.generation)}, evaluation ${fmtMs(r.timings.evaluation)})`,
          `- Groundedness: ${j?.groundedness ?? 'n/a'}/5 · Relevance: ${j?.relevance ?? 'n/a'}/5 · Confidence: ${r.eval.confidence?.level ?? 'n/a'}`,
          `- Claim support: ${Math.round(h.support.share * 100)}% · Citation validity: ${h.citations.precision != null ? Math.round(h.citations.precision * 100) + '%' : 'n/a'}`,
          `- Sources: ${r.sources.filter((x) => !x.neighbor).map((x) => `${x.docName} p.${x.page}`).join(', ')}`,
          ''
        );
      }
    });
    download(new Blob([lines.join('\n')], { type: 'text/markdown' }), `${session.title.replace(/[^\w]+/g, '_').slice(0, 40)}.md`);
  }

  const exportJSON = () => download(new Blob([JSON.stringify(session)], { type: 'application/json' }), `${session.title.replace(/[^\w]+/g, '_').slice(0, 40)}.session.json`);
  const multiDoc = activeDocs.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/80 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mr-auto min-w-0">
          <h2 className="truncate font-semibold">{session?.title || 'New session'}</h2>
          <p className="truncate text-xs text-slate-500">
            {activeCollection.name}: {activeDocs.map((d) => d.name).join(', ')} · {providerLabel(settings)}
          </p>
        </div>
        <button onClick={() => setView('settings')} className="rounded-full" title={profile === 'custom' ? 'Custom settings' : PROFILES[profile].why}>
          <Badge color="brand">profile: {profile === 'custom' ? 'custom' : PROFILES[profile].label}</Badge>
        </button>
        <Badge color={semanticReady ? 'green' : 'amber'} title="Semantic embeddings build in the background; keyword search works immediately">
          <Gauge className="h-3 w-3" />
          {semanticReady ? `${settings.retrievalMode} retrieval` : embedding.length ? `embedding ${Math.round((embedding.reduce((a, e) => a + e.done, 0) / embedding.reduce((a, e) => a + e.total, 0)) * 100)}% · keyword meanwhile` : 'keyword search (semantic index not ready)'}
        </Badge>
        <button
          onClick={() => setCompare(!compare)}
          disabled={settings.provider === 'extractive'}
          className={cx('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition disabled:opacity-40', compare ? 'bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-200' : 'ring-slate-200 dark:ring-slate-700')}
          title="Answer each question with RAG and with the plain LLM, then judge both against the documents"
        >
          <Columns2 className="h-3.5 w-3.5" /> RAG vs vanilla
        </button>
        {session?.messages.length > 0 && (
          <>
            <Button size="sm" variant="secondary" icon={BarChart3} onClick={() => setDash(true)}>Dashboard</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportMarkdown} title="Export as Markdown report">MD</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportJSON} title="Export session (re-importable)">JSON</Button>
          </>
        )}
        <Button size="sm" variant="ghost" icon={Upload} onClick={() => importRef.current?.click()} title="Import a session JSON" />
        <input
          ref={importRef}
          type="file"
          accept=".json"
          hidden
          onChange={async (e) => {
            try {
              await importSession(JSON.parse(await e.target.files[0].text()));
            } catch (err) {
              alert(String(err.message || err));
            }
            e.target.value = '';
          }}
        />
      </header>

      {settings.provider === 'extractive' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Extractive mode quotes the best sentences (instant, no LLM). For written answers and the LLM judge, add a free Hugging Face token — the recommended option for the best quality.
          </span>
          <button className="font-semibold underline" onClick={() => setView('settings')}>Open settings</button>
        </div>
      )}
      {settings.provider === 'hf' && (!settings.hfToken || editingToken) && (
        <div className="border-b border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-900/20">
          <div className="mx-auto max-w-3xl">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-900 dark:text-brand-100">
              <KeyRound className="h-4 w-4" /> Enter your Hugging Face token to start (needed once per visit)
            </div>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <SecretInput
                  value={settings.hfToken}
                  onChange={(v) => {
                    setEditingToken(true);
                    setSettings({ hfToken: v });
                  }}
                />
              </div>
              <Button disabled={!settings.hfToken} onClick={() => setEditingToken(false)}>Use token</Button>
            </div>
          </div>
        </div>
      )}
      {settings.provider === 'browser' && noGpu && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          No WebGPU in this browser: the in-browser model runs on the CPU and will be slow. Hugging Face Inference is much faster.
        </div>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-5xl space-y-8">
          {!messages.length && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 w-fit rounded-2xl bg-brand-50 p-4 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                <Sparkles className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Ask {multiDoc ? `${activeDocs.length} documents` : activeDocs[0].name}</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
                Answers are grounded in retrieved passages, cite them as <Badge color="brand">p.12</Badge> (click to open the page), and come with timing, groundedness, relevance and a confidence rating.
              </p>
              {kbLoading && <p className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading indexes…</p>}
              <div className="mx-auto mt-6 grid max-w-3xl gap-2 text-left sm:grid-cols-2">
                {suggested.map((q) => (
                  <button key={q} onClick={() => ask(q)} className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 transition hover:border-brand-400 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id} className="space-y-3">
              <div className="flex justify-end">
                <div className="flex max-w-3xl items-start gap-2 rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm">
                  <span>{m.question}</span>
                  <User className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                </div>
              </div>
              {m.vanilla ? (
                <>
                  <div className="flex flex-col gap-3 lg:flex-row">
                    {m.rag && <AnswerCard rec={m.rag} title="RAG answer" compact multiDoc={multiDoc} />}
                    <AnswerCard rec={m.vanilla} title="Vanilla LLM (no retrieval)" compact />
                  </div>
                  {m.rag && (
                    <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <summary className="cursor-pointer text-sm font-medium">Full RAG trace & evaluation</summary>
                      <EvalPanel rec={m.rag} />
                    </details>
                  )}
                </>
              ) : (
                m.rag && <AnswerCard rec={m.rag} title="RAG answer" multiDoc={multiDoc} />
              )}
              {m.rag?.phase === 'done' && (
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  Was this answer useful?
                  <button onClick={() => setFeedback(i, 'up')} className={cx('rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800', m.feedback === 'up' && 'text-emerald-600')} aria-label="Helpful">
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setFeedback(i, 'down')} className={cx('rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800', m.feedback === 'down' && 'text-rose-600')} aria-label="Not helpful">
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <form
          className="mx-auto flex max-w-5xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            rows={Math.min(5, Math.max(1, input.split('\n').length))}
            placeholder={kbLoading ? 'Loading indexes…' : `Ask about ${multiDoc ? 'these documents' : activeDocs[0].name}…`}
            disabled={kbLoading}
            className="flex-1 resize-none rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950"
          />
          {busy ? (
            <Button type="button" variant="secondary" size="lg" icon={Square} onClick={() => abortRef.current?.abort()}>Stop</Button>
          ) : (
            <Button type="submit" size="lg" icon={Send} disabled={!input.trim() || kbLoading}>Ask</Button>
          )}
        </form>
        <div className="mx-auto mt-1.5 flex max-w-5xl flex-wrap gap-3 text-[11px] text-slate-400">
          <span>k={settings.k}</span>
          <span>temp {settings.temperature}</span>
          <span>max {settings.maxTokens} tok</span>
          <span>judge {settings.judgeMode}</span>
          {[
            ['rerank', 'rerank (better order, +23 MB once)'],
            ['corrective', 'corrective retry'],
            ['hyde', 'HyDE'],
          ].map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={settings[k]} onChange={(e) => setSettings({ [k]: e.target.checked })} className="accent-brand-600" />
              {label}
            </label>
          ))}
        </div>
      </div>
      <Dashboard session={session} open={dash} onClose={() => setDash(false)} />
    </div>
  );
}
