import { useEffect, useRef, useState } from 'react';
import { Send, Square, Loader2, Sparkles, Columns2, BookMarked, Bot, User, Download, AlertCircle, KeyRound, Gauge } from 'lucide-react';
import Markdown from '../components/Markdown.jsx';
import EvalPanel from '../components/EvalPanel.jsx';
import { Badge, Button, Empty, cx, download, ScoreRing } from '../components/ui.jsx';
import { runQuestion } from '../lib/pipeline.js';
import { NOTEBOOK_QUESTIONS } from '../lib/prompts.js';
import { providerLabel } from '../lib/llm.js';
import { fmtMs } from '../lib/text.js';

const PHASE = {
  retrieving: 'Retrieving relevant pages…',
  generating: 'Generating grounded answer…',
  evaluating: 'Evaluating groundedness & relevance…',
  correcting: 'Weak grounding detected — rewriting query and retrying…',
};

function AnswerCard({ rec, title, onOpenPage, compact }) {
  const busy = !['done', 'error'].includes(rec.phase);
  const j = rec.eval?.judge;
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
          </Badge>
        )}
        {rec.timings.total != null && rec.phase === 'done' && <Badge color="blue">{fmtMs(rec.timings.total)}</Badge>}
        {j?.groundedness?.score != null && <Badge color={j.groundedness.score >= 4 ? 'green' : 'amber'}>grounded {j.groundedness.score}/5</Badge>}
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
        <Markdown text={rec.answer || (busy ? '' : '_No answer_')} onCite={(p) => onOpenPage(p, rec.sources.filter((s) => s.page === p).map((s) => s.id))} streaming={rec.phase === 'generating'} />
      )}
      {!compact && (rec.eval || rec.sources.length > 0) && <EvalPanel rec={rec} onOpenPage={onOpenPage} />}
      {compact && rec.eval && (
        <div className="mt-3 flex items-center justify-around border-t border-slate-100 pt-3 dark:border-slate-800">
          <ScoreRing size={52} score={j?.groundedness?.score ?? null} label="Grounded" />
          <ScoreRing size={52} score={j?.relevance?.score ?? null} label="Relevance" />
          <ScoreRing size={52} score={rec.eval.heuristic.support.rows.length ? rec.eval.heuristic.support.share * 100 : null} max={100} label="Lexical" />
        </div>
      )}
    </div>
  );
}

export default function ChatView({ settings, setSettings, activeManual, kb, embedStatus, openPage, setView, session, newSession, saveSession }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const messages = session?.messages || [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.phase]);

  if (!activeManual) {
    return (
      <Empty icon={BookMarked} title="Add a medical manual to start">
        Upload a PDF (e.g. <em>The Merck Manual of Diagnosis &amp; Therapy</em>) in <b>Manuals</b>. It is parsed, cleaned, chunked and indexed in your
        browser, and stays stored for future sessions.
        <div className="mt-4">
          <Button onClick={() => setView('library')}>Open Manuals</Button>
        </div>
      </Empty>
    );
  }

  const es = embedStatus[activeManual.id];
  const semanticReady = activeManual.embedDone >= activeManual.chunkStats?.count || es?.finished;

  async function ask(q) {
    const question = (q ?? input).trim();
    if (!question || busy || !kb) return;
    setInput('');
    setBusy(true);
    let s = sessionRef.current || newSession();
    if (s.title === 'New session') s = { ...s, title: question.length > 60 ? question.slice(0, 57) + '…' : question };
    const history = s.messages.map((m) => m.rag).filter(Boolean);
    const idx = s.messages.length;
    const entry = { id: crypto.randomUUID?.() || String(Date.now()), question, rag: null, vanilla: null };
    s = saveSession({ ...s, messages: [...s.messages, entry] });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (key) => (rec) => {
      const cur = s;
      const msgs = [...cur.messages];
      msgs[idx] = { ...msgs[idx], [key]: rec };
      s = { ...cur, messages: msgs };
      saveSession(s);
    };
    const tasks = [runQuestion({ question, manual: activeManual, kb, settings, history, onUpdate: patch('rag'), signal: ctrl.signal })];
    if (compare && settings.provider !== 'extractive') {
      tasks.push(
        runQuestion({ question, manual: activeManual, kb, settings, cfg: { vanilla: true, corrective: false }, onUpdate: patch('vanilla'), signal: ctrl.signal })
      );
    }
    if (settings.provider === 'browser') {
      // single in-browser model: run sequentially
      for (const t of tasks) await t;
    } else await Promise.all(tasks);
    setBusy(false);
  }

  function exportSession() {
    const lines = [`# ${session.title}`, `Manual: ${activeManual.name}`, ''];
    session.messages.forEach((m, i) => {
      const r = m.rag;
      lines.push(`## Q${i + 1}. ${m.question}`, '', r?.answer || '', '');
      if (r?.eval) {
        const j = r.eval.judge;
        lines.push(
          `- Time: ${fmtMs(r.timings.total)} (retrieval ${fmtMs((r.timings.queryEmbed || 0) + (r.timings.search || 0))}, generation ${fmtMs(r.timings.generation)}, evaluation ${fmtMs(r.timings.evaluation)})`,
          `- Groundedness (judge): ${j?.groundedness?.score ?? 'n/a'}/5 · Relevance (judge): ${j?.relevance?.score ?? 'n/a'}/5`,
          `- Lexical support: ${Math.round(r.eval.heuristic.support.share * 100)}% · Citation validity: ${r.eval.heuristic.citations.precision != null ? Math.round(r.eval.heuristic.citations.precision * 100) + '%' : 'n/a'}`,
          `- Sources: ${r.sources.map((x) => `p.${x.page}`).join(', ')}`,
          ''
        );
      }
    });
    download(new Blob([lines.join('\n')], { type: 'text/markdown' }), `${session.title.replace(/[^\w]+/g, '_').slice(0, 40)}.md`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/80 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mr-auto min-w-0">
          <h2 className="truncate font-semibold">{session?.title || 'New session'}</h2>
          <p className="truncate text-xs text-slate-500">
            {activeManual.name} · {providerLabel(settings)}
          </p>
        </div>
        <Badge color={semanticReady ? 'green' : 'amber'} title="Semantic embeddings build in the background; keyword search works immediately">
          <Gauge className="h-3 w-3" />
          {semanticReady ? `${settings.retrievalMode} retrieval` : es?.running ? `embedding ${Math.round((es.done / es.total) * 100)}% · BM25 meanwhile` : 'BM25 (embeddings paused)'}
        </Badge>
        <button
          onClick={() => setCompare(!compare)}
          disabled={settings.provider === 'extractive'}
          className={cx(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition disabled:opacity-40',
            compare ? 'bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-200' : 'ring-slate-200 dark:ring-slate-700'
          )}
          title="Answer each question twice: with RAG and with the vanilla LLM, then judge both against the manual"
        >
          <Columns2 className="h-3.5 w-3.5" /> RAG vs vanilla
        </button>
        {session?.messages.length > 0 && <Button size="sm" variant="secondary" icon={Download} onClick={exportSession}>Export</Button>}
      </header>

      {settings.provider === 'extractive' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Extractive mode: answers are stitched from the best manual sentences (no LLM, instant). For generated answers and the LLM-as-a-judge evaluation, add a
            free Hugging Face token or pick an in-browser model.
          </span>
          <button className="font-semibold underline" onClick={() => setView('settings')}>Open settings</button>
        </div>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-5xl space-y-8">
          {!messages.length && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 w-fit rounded-2xl bg-brand-50 p-4 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                <Sparkles className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Ask {activeManual.name}</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
                Every answer is grounded in retrieved pages, cites them as <Badge color="brand">p.123</Badge> (click to open the real page), and is
                scored for groundedness and relevance with full timing.
              </p>
              <div className="mx-auto mt-6 grid max-w-3xl gap-2 text-left sm:grid-cols-2">
                {NOTEBOOK_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 transition hover:border-brand-400 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className="space-y-3">
              <div className="flex justify-end">
                <div className="flex max-w-3xl items-start gap-2 rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm">
                  <span>{m.question}</span>
                  <User className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                </div>
              </div>
              {m.vanilla ? (
                <div className="flex flex-col gap-3 lg:flex-row">
                  {m.rag && <AnswerCard rec={m.rag} title="RAG answer" onOpenPage={openPage} compact />}
                  <AnswerCard rec={m.vanilla} title="Vanilla LLM (no retrieval)" onOpenPage={openPage} compact />
                </div>
              ) : null}
              {m.rag && (m.vanilla ? <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><summary className="cursor-pointer text-sm font-medium">Full RAG evaluation</summary><EvalPanel rec={m.rag} onOpenPage={openPage} /></details> : <AnswerCard rec={m.rag} title="RAG answer" onOpenPage={openPage} />)}
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
            placeholder={kb ? `Ask a clinical question about ${activeManual.name}…` : 'Loading knowledge base…'}
            disabled={!kb}
            className="flex-1 resize-none rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950"
          />
          {busy ? (
            <Button type="button" variant="secondary" size="lg" icon={Square} onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" size="lg" icon={Send} disabled={!input.trim() || !kb}>
              Ask
            </Button>
          )}
        </form>
        <div className="mx-auto mt-1.5 flex max-w-5xl flex-wrap gap-3 text-[11px] text-slate-400">
          <span>k={settings.k}</span>
          <span>temp {settings.temperature}</span>
          <span>max {settings.maxTokens} tok</span>
          <span>judge {settings.judgeEnabled ? 'on' : 'off'}</span>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={settings.corrective} onChange={(e) => setSettings({ corrective: e.target.checked })} className="accent-brand-600" />
            corrective retry
          </label>
        </div>
      </div>
    </div>
  );
}
