import { useEffect, useMemo, useRef, useState } from 'react';
import { Square, Loader2, Sparkles, Columns2, FileText, Download, Upload, AlertCircle, KeyRound, Gauge, BarChart3, ThumbsUp, ThumbsDown, PanelLeft, ArrowUp, Lock } from 'lucide-react';
import Markdown from '../components/Markdown.jsx';
import EvalPanel, { ConfidenceBadge } from '../components/EvalPanel.jsx';
import Dashboard from '../components/Dashboard.jsx';
import { Badge, Button, Empty, cx, download, ScoreRing, Shelf, LinkButton, useDialog } from '../components/ui.jsx';
import SessionsRail from '../components/SessionsRail.jsx';
import { runQuestion, hydrateRecord, suggestQuestions } from '../lib/pipeline.js';
import { resolveCitation } from '../lib/evaluate.js';
import { providerLabel } from '../lib/llm.js';
import { PROVIDERS, apiKeyOf, llmReady, dataClass } from '../lib/providers.js';
import { preset } from '../lib/presets.js';
import { matchProfile, PROFILES } from '../lib/settings.js';
import { vectorsReady } from '../lib/kb.js';
import { db } from '../lib/db.js';
import { fmtMs, uid } from '../lib/text.js';
import { useStore } from '../state/store.jsx';
import SecretInput from '../components/SecretInput.jsx';
import { AccountStatus } from '../components/HfPanel.jsx';
import { BILLING_URL } from '../lib/hf.js';

const PHASE = {
  retrieving: 'Retrieving relevant passages…',
  generating: 'Generating grounded answer…',
  evaluating: 'Evaluating groundedness & relevance…',
  correcting: 'Weak grounding, rewriting the query and retrying…',
};

function ErrorCard({ rec }) {
  const { setView, setSettings } = useStore();
  const info = rec.errorInfo;
  return (
    <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-semibold">{info?.title || 'Something went wrong'}</div>
          <div className="mt-0.5">{info?.hint || rec.error}</div>
        </div>
      </div>
      {info && (
        <div className="mt-2 flex flex-wrap gap-2 pl-6">
          <Button size="sm" variant="secondary" onClick={() => setView('settings')}>Open settings</Button>
          {info.billing && (
            <a className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium ring-1 ring-rose-200 hover:bg-white dark:ring-rose-800" href={BILLING_URL} target="_blank" rel="noreferrer noopener">
              Check credits
            </a>
          )}
          {(info.billing || info.status === 429) && (
            <Button size="sm" variant="ghost" onClick={() => setSettings({ provider: 'extractive' })}>Switch to Extractive (free, unlimited)</Button>
          )}
        </div>
      )}
    </div>
  );
}

function AnswerCard({ rec, title, compact, multiDoc }) {
  const { openPage, docs } = useStore();
  const busy = !['done', 'error'].includes(rec.phase);
  const j = rec.eval?.judge;
  const onCite = (c) => {
    const r = resolveCitation(c, rec.sources, docs);
    if (r) openPage(r.docId, r.page, r.keys);
  };
  return (
    <div className="min-w-0 flex-1 rounded-[22px] bg-white p-5 shadow-card md:p-6 dark:bg-slate-900 dark:shadow-none dark:ring-1 dark:ring-slate-800">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="eyebrow mr-1">{title}</span>
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
        <ErrorCard rec={rec} />
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
  const [rail, setRail] = useState(false);
  const dialog = useDialog();
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

  // starter questions: preset samples, else from section titles (free). AI-written ones cost one
  // LLM call per document, so they are generated only when asked for (or enabled in Settings).
  const p = preset(settings.preset);
  const docKey = activeDocs.map((d) => d.id).join('|');
  const llmOn = llmReady(settings) && !(settings.confidential && dataClass(settings) === 'cloud');
  const keyProvider = PROVIDERS[settings.provider]?.group === 'key' ? PROVIDERS[settings.provider] : null;
  const [aiRequested, setAiRequested] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestedAI, setSuggestedAI] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (p.sampleQuestions) return setSuggested(p.sampleQuestions);
      const useLLM = llmOn && (settings.aiSuggestions || aiRequested);
      if (useLLM) setAiBusy(true);
      const out = [];
      let ai = false;
      for (const s of sets.slice(0, 3)) {
        let r = useLLM ? await db.getKV(`suggest:${s.doc.id}:llm`) : null;
        if (!r) r = await db.getKV(`suggest:${s.doc.id}:x`);
        if (!r || (useLLM && !r.ai)) {
          r = await suggestQuestions(settings, s.doc, s.kb, useLLM);
          if (r.questions.length) await db.putKV(`suggest:${s.doc.id}:${r.ai ? 'llm' : 'x'}`, r);
        }
        ai ||= !!r.ai;
        out.push(...(r.questions || r).slice(0, sets.length > 1 ? 2 : 5));
      }
      if (!cancelled) {
        setSuggested(out.slice(0, 6));
        setSuggestedAI(ai);
        setAiBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, sets.length, llmOn, settings.preset, settings.aiSuggestions, aiRequested]);

  if (!activeCollection || !activeDocs.length) {
    return (
      <Empty icon={FileText} title="Chat with any document">
        Add a PDF, Word, HTML, Markdown or text file, or start with the built-in guide to RAG. Everything is processed and stored privately in your browser.
        <div className="mt-6">
          <Button size="lg" onClick={() => setView('library')}>Add a document</Button>
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

  const chip = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition';
  const retrievalLabel = semanticReady
    ? `${settings.retrievalMode} search`
    : embedding.length
      ? `indexing ${Math.round((embedding.reduce((a, e) => a + e.done, 0) / embedding.reduce((a, e) => a + e.total, 0)) * 100)}% · keyword search meanwhile`
      : 'keyword search';

  return (
    <div className="flex h-full min-h-0">
      <SessionsRail open={rail} onClose={() => setRail(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[980px] px-4 pb-10 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 pt-6 pb-5">
              <button onClick={() => setRail(true)} className={cx(chip, 'bg-white shadow-card lg:hidden dark:bg-slate-900')} aria-label="Show sessions">
                <PanelLeft className="h-3.5 w-3.5" /> Sessions
              </button>
              <div className="mr-auto min-w-0">
                <h1 className="headline truncate text-2xl md:text-[28px]">{session?.title || 'New session'}</h1>
                <p className="truncate text-sm text-slate-500">
                  {activeCollection.name} · {activeDocs.map((d) => d.name).join(', ')} · {providerLabel(settings)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => setView('settings')} className={cx(chip, 'bg-white text-ink shadow-card dark:bg-slate-900 dark:text-slate-100')} title={profile === 'custom' ? 'Custom settings' : PROFILES[profile].why}>
                  {profile === 'custom' ? 'Custom' : PROFILES[profile].label} profile
                </button>
                <span className={cx(chip, 'bg-white shadow-card dark:bg-slate-900', semanticReady ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')} title="Semantic embeddings build in the background; keyword search works immediately">
                  <Gauge className="h-3.5 w-3.5" /> {retrievalLabel}
                </span>
                <button
                  onClick={() => setCompare(!compare)}
                  disabled={settings.provider === 'extractive'}
                  aria-pressed={compare}
                  className={cx(chip, 'shadow-card disabled:opacity-40', compare ? 'bg-ink text-white dark:bg-white dark:text-ink' : 'bg-white dark:bg-slate-900')}
                  title="Answer each question with RAG and with the plain LLM, then judge both against the documents"
                >
                  <Columns2 className="h-3.5 w-3.5" /> RAG vs vanilla
                </button>
                {session?.messages.length > 0 && (
                  <>
                    <button className={cx(chip, 'bg-white shadow-card dark:bg-slate-900')} onClick={() => setDash(true)}>
                      <BarChart3 className="h-3.5 w-3.5" /> Dashboard
                    </button>
                    <button className={cx(chip, 'bg-white shadow-card dark:bg-slate-900')} onClick={exportMarkdown} title="Export as a Markdown report">
                      <Download className="h-3.5 w-3.5" /> Report
                    </button>
                    <button className={cx(chip, 'bg-white shadow-card dark:bg-slate-900')} onClick={exportJSON} title="Export session (re-importable JSON)">
                      <Download className="h-3.5 w-3.5" /> JSON
                    </button>
                  </>
                )}
                <button className={cx(chip, 'bg-white shadow-card dark:bg-slate-900')} onClick={() => importRef.current?.click()} title="Import a session JSON">
                  <Upload className="h-3.5 w-3.5" /> Import
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json"
                  hidden
                  onChange={async (e) => {
                    try {
                      await importSession(JSON.parse(await e.target.files[0].text()));
                      dialog.toast('Session imported');
                    } catch (err) {
                      dialog.toast(String(err.message || err), 'error');
                    }
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            {settings.provider === 'hf' && (!settings.hfToken || editingToken) && (
              <div className="mb-6 rounded-[22px] bg-white p-5 shadow-card dark:bg-slate-900">
                <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
                  <KeyRound className="h-4 w-4" /> Enter your Hugging Face token to start
                  <span className="font-normal text-slate-500">Needed once per visit. It is never saved.</span>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-[240px] flex-1">
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
                <div className="mt-2">
                  <AccountStatus compact />
                </div>
              </div>
            )}
            {keyProvider && (!apiKeyOf(settings) || editingToken) && (
              <div className="mb-6 rounded-[22px] bg-white p-5 shadow-card dark:bg-slate-900">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  <KeyRound className="h-4 w-4" /> Enter your {keyProvider.label} API key to start
                  <span className="font-normal text-slate-500">Needed once per visit. It is never saved.</span>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-[240px] flex-1">
                    <SecretInput
                      value={apiKeyOf(settings)}
                      onChange={(v) => {
                        setEditingToken(true);
                        setSettings({ apiKeys: { ...settings.apiKeys, [settings.provider]: v } });
                      }}
                      placeholder={keyProvider.keyPrefix ? `${keyProvider.keyPrefix}…` : 'API key'}
                      label={`${keyProvider.label} API key`}
                      provider={settings.provider}
                    />
                  </div>
                  <Button disabled={!apiKeyOf(settings)} onClick={() => setEditingToken(false)}>Use key</Button>
                </div>
                <p className="mt-2 text-xs text-slate-500">Questions and the retrieved excerpts will be sent to {keyProvider.company}. Your files stay on this device.</p>
              </div>
            )}
            {settings.confidential && dataClass(settings) === 'cloud' && (
              <p className="mb-6 flex flex-wrap items-center gap-2 rounded-[18px] bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
                <Lock className="h-4 w-4" /> Confidential mode is on, so {PROVIDERS[settings.provider].label} is blocked and nothing will be sent. Choose Extractive, the in-browser model or a local model.
                <LinkButton onClick={() => setView('settings')}>Open Settings ›</LinkButton>
              </p>
            )}
            {settings.provider === 'browser' && noGpu && (
              <p className="mb-6 rounded-[18px] bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                No WebGPU in this browser: the in-browser model runs on the CPU and will be slow. Hugging Face Inference is much faster.
              </p>
            )}

            {!messages.length && (
              <div className="pt-4">
                <h2 className="headline text-3xl leading-tight sm:text-4xl md:text-5xl">
                  Ask {multiDoc ? `${activeDocs.length} documents` : activeDocs[0].name}
                  <span className="ml-3 text-slate-500 dark:text-slate-400">Every answer cites its pages and shows how it was made</span>
                </h2>
                {kbLoading && (
                  <p className="mt-5 flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading indexes…
                  </p>
                )}
                {suggested.length > 0 && (
                  <>
                    <div className="mt-10 mb-4 flex flex-wrap items-end justify-between gap-2">
                      <h3 className="headline text-xl">
                        Try asking<span className="ml-3 text-slate-500 dark:text-slate-400">{suggestedAI ? 'Written by AI for these documents' : 'Based on the document’s sections'}</span>
                      </h3>
                      {llmOn && !p.sampleQuestions && !suggestedAI && (
                        <LinkButton onClick={() => setAiRequested(true)} disabled={aiBusy} className="text-sm disabled:opacity-50">
                          {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Suggest with AI ({Math.min(3, sets.length)} LLM call{sets.length > 1 ? 's' : ''})
                        </LinkButton>
                      )}
                    </div>
                    <Shelf>
                      {suggested.map((q, i) => (
                        <button
                          key={q}
                          onClick={() => ask(q)}
                          className="flex h-48 w-72 flex-col rounded-[18px] bg-white p-6 text-left shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover dark:bg-slate-900"
                        >
                          <span className="eyebrow">{i === 0 ? 'Start here' : 'Suggested'}</span>
                          <span className="headline mt-2 line-clamp-4 text-[17px] leading-snug">{q}</span>
                          <span className="mt-auto text-sm text-brand-700 dark:text-brand-400">Ask ›</span>
                        </button>
                      ))}
                    </Shelf>
                  </>
                )}
              </div>
            )}

            <div className="space-y-10">
              {messages.map((m, i) => (
                <div key={m.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-2xl rounded-[22px] rounded-br-md bg-brand-600 px-5 py-3 text-[15px] text-white">{m.question}</div>
                  </div>
                  {m.vanilla ? (
                    <>
                      <div className="flex flex-col gap-4 lg:flex-row">
                        {m.rag && <AnswerCard rec={m.rag} title="RAG answer" compact multiDoc={multiDoc} />}
                        <AnswerCard rec={m.vanilla} title="Vanilla LLM · no retrieval" compact />
                      </div>
                      {m.rag && (
                        <details className="rounded-[22px] bg-white p-5 shadow-card dark:bg-slate-900">
                          <summary className="cursor-pointer text-sm font-medium">Full RAG trace & evaluation</summary>
                          <EvalPanel rec={m.rag} />
                        </details>
                      )}
                    </>
                  ) : (
                    m.rag && <AnswerCard rec={m.rag} title="Answer" multiDoc={multiDoc} />
                  )}
                  {m.rag?.phase === 'done' && (
                    <div className="flex items-center gap-1 pl-2 text-xs text-slate-500">
                      Was this helpful?
                      <button onClick={() => setFeedback(i, 'up')} aria-pressed={m.feedback === 'up'} className={cx('rounded-full p-1.5 hover:bg-white dark:hover:bg-slate-800', m.feedback === 'up' && 'text-emerald-600')} aria-label="Helpful">
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setFeedback(i, 'down')} aria-pressed={m.feedback === 'down'} className={cx('rounded-full p-1.5 hover:bg-white dark:hover:bg-slate-800', m.feedback === 'down' && 'text-rose-600')} aria-label="Not helpful">
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div ref={endRef} />
          </div>
        </div>

        <div className="glass border-t border-black/5 px-4 pt-3 pb-4 dark:border-white/10">
          <form
            className="mx-auto flex max-w-[980px] items-end gap-2 rounded-[26px] bg-white py-1.5 pr-1.5 pl-5 shadow-card ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-brand-600 dark:bg-slate-900 dark:ring-white/10"
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
              placeholder={kbLoading ? 'Loading indexes…' : multiDoc ? 'Ask these documents…' : activeDocs[0].name.length > 28 ? 'Ask this document…' : `Ask ${activeDocs[0].name}…`}
              disabled={kbLoading}
              aria-label="Your question"
              className="max-h-40 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-slate-400"
            />
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-ink hover:bg-slate-300 dark:bg-slate-700 dark:text-white" aria-label="Stop">
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button type="submit" disabled={!input.trim() || kbLoading} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-500 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800" aria-label="Ask">
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </form>
          <div className="mx-auto mt-2 flex max-w-[980px] flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-slate-500">
            <span>k = {settings.k}</span>
            <span>temperature {settings.temperature}</span>
            <span>max {settings.maxTokens} tokens</span>
            <span>judge: {settings.judgeMode}</span>
            {[
              ['rerank', 'Rerank'],
              ['corrective', 'Corrective retry'],
              ['hyde', 'HyDE'],
            ].map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={settings[k]} onChange={(e) => setSettings({ [k]: e.target.checked })} className="h-3.5 w-3.5 accent-brand-600" />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <Dashboard session={session} open={dash} onClose={() => setDash(false)} />
    </div>
  );
}
