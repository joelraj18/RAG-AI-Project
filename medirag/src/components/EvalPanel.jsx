import { useState } from 'react';
import { Timer, ShieldCheck, Target, BookOpen, Quote, Sparkles, RefreshCw, AlertTriangle, ChevronDown } from 'lucide-react';
import { Badge, ScoreRing, cx } from './ui.jsx';
import { fmtMs, fmtNum } from '../lib/text.js';

const STEPS = [
  { key: 'queryEmbed', label: 'Query embedding', color: 'bg-violet-500' },
  { key: 'search', label: 'Vector / BM25 search', color: 'bg-sky-500' },
  { key: 'generation', label: 'Answer generation', color: 'bg-brand-500' },
  { key: 'evaluation', label: 'Evaluation', color: 'bg-amber-500' },
];

export function TimingWaterfall({ timings }) {
  const total = timings.total || STEPS.reduce((s, x) => s + (timings[x.key] || 0), 0) || 1;
  let offset = 0;
  return (
    <div className="space-y-1.5">
      {STEPS.map((s) => {
        const v = timings[s.key] || 0;
        const left = offset / total;
        offset += v;
        return (
          <div key={s.key} className="grid grid-cols-[140px_1fr_64px] items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">{s.label}</span>
            <div className="relative h-3 rounded bg-slate-100 dark:bg-slate-800">
              <div className={cx('absolute h-3 rounded', s.color)} style={{ left: `${left * 100}%`, width: `${Math.max(v ? 0.6 : 0, (v / total) * 100)}%` }} />
              {s.key === 'generation' && timings.ttft != null && v > 0 && (
                <div
                  className="absolute -top-0.5 h-4 w-0.5 bg-slate-900 dark:bg-white"
                  style={{ left: `${((left * total + timings.ttft) / total) * 100}%` }}
                  title={`First token after ${fmtMs(timings.ttft)}`}
                />
              )}
            </div>
            <span className="text-right font-medium tabular-nums">{fmtMs(v)}</span>
          </div>
        );
      })}
      <div className="grid grid-cols-[140px_1fr_64px] items-center gap-2 border-t border-slate-100 pt-1.5 text-xs dark:border-slate-800">
        <span className="font-semibold">Total</span>
        <span className="text-slate-400">{timings.ttft != null ? `first token at ${fmtMs(timings.ttft)} (marker)` : ''}</span>
        <span className="text-right font-semibold tabular-nums">{fmtMs(timings.total)}</span>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children, right }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </h4>
        {right}
      </div>
      {children}
    </div>
  );
}

const STATUS = {
  supported: 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/20',
  partial: 'border-amber-400 bg-amber-50/70 dark:bg-amber-900/20',
  unsupported: 'border-rose-400 bg-rose-50/70 dark:bg-rose-900/20',
};

export default function EvalPanel({ rec, onOpenPage }) {
  const [showMap, setShowMap] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const h = rec.eval?.heuristic;
  const j = rec.eval?.judge;
  const evaluating = rec.phase === 'evaluating' || rec.phase === 'correcting';
  const supportPct = h?.support?.rows?.length ? h.support.share * 100 : null;

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <Section icon={Timer} title="Time taken to process">
          <TimingWaterfall timings={rec.timings} />
          {rec.gen && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge>prompt {fmtNum(rec.gen.promptTokens)} tok{rec.gen.tokensEstimated ? '*' : ''}</Badge>
              <Badge>answer {fmtNum(rec.gen.completionTokens)} tok</Badge>
              {rec.gen.tokensPerSec && <Badge color="blue">{rec.gen.tokensPerSec.toFixed(1)} tok/s</Badge>}
              <Badge color={rec.gen.truncated ? 'red' : 'green'}>finish: {rec.gen.finishReason}{rec.gen.truncated ? ' (truncated)' : ''}</Badge>
            </div>
          )}
        </Section>

        <Section
          icon={ShieldCheck}
          title="Groundedness & relevance"
          right={evaluating && <Badge color="amber"><Sparkles className="h-3 w-3 animate-pulse" /> judging…</Badge>}
        >
          <div className="flex flex-wrap items-start justify-around gap-3">
            <ScoreRing score={j?.groundedness?.score ?? null} label="Groundedness" sub="LLM judge 1–5" />
            <ScoreRing score={j?.relevance?.score ?? null} label="Relevance" sub="LLM judge 1–5" />
            <ScoreRing score={supportPct} max={100} label="Lexical support" sub="claims found in context" />
            <ScoreRing
              score={h?.citations?.precision != null ? h.citations.precision * 100 : null}
              max={100}
              label="Citation validity"
              sub={h ? `${h.citations.valid.length}/${h.citations.cited.length} pages valid` : ''}
            />
          </div>
          {!j && !evaluating && (
            <p className="mt-2 text-xs text-slate-500">
              {rec.eval?.judgeError
                ? `Judge failed: ${rec.eval.judgeError}`
                : rec.provider === 'extractive'
                  ? 'LLM-as-a-judge needs an LLM provider (Settings). Judge-free metrics are shown.'
                  : 'LLM judge is disabled in Settings.'}
            </p>
          )}
        </Section>
      </div>

      {j && (
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ['Groundedness justification', j.groundedness],
            ['Relevance justification', j.relevance],
          ].map(([t, x]) => (
            <Section key={t} icon={Quote} title={t} right={<Badge>{fmtMs(x.ms)}</Badge>}>
              <p className="text-sm text-slate-600 dark:text-slate-300">{x.justification || x.raw}</p>
            </Section>
          ))}
        </div>
      )}

      {h && (
        <Section
          icon={Target}
          title="Claim-level support map"
          right={
            <button className="flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-300" onClick={() => setShowMap(!showMap)}>
              {showMap ? 'Hide' : 'Show'} {h.support.rows.length} claims <ChevronDown className={cx('h-3.5 w-3.5 transition', showMap && 'rotate-180')} />
            </button>
          }
        >
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge color="green">{h.support.rows.filter((r) => r.status === 'supported').length} supported</Badge>
            <Badge color="amber">{h.support.rows.filter((r) => r.status === 'partial').length} partial</Badge>
            <Badge color="red">{h.support.rows.filter((r) => r.status === 'unsupported').length} unsupported</Badge>
            {h.coverage != null && <Badge color="blue">question coverage {Math.round(h.coverage * 100)}%</Badge>}
            <Badge color="violet">citations on {Math.round(h.citations.coverage * 100)}% of claims</Badge>
            {h.citations.invalid.length > 0 && <Badge color="red">cited but not retrieved: p.{h.citations.invalid.join(', ')}</Badge>}
            {h.fallback && <Badge color="amber"><AlertTriangle className="h-3 w-3" /> fallback answer</Badge>}
          </div>
          {showMap && (
            <div className="mt-3 space-y-1.5">
              {h.support.rows.map((r, i) => (
                <div key={i} className={cx('rounded-r-lg border-l-4 px-3 py-1.5 text-sm', STATUS[r.status])}>
                  <span>{r.text}</span>
                  <span className="ml-2 text-xs whitespace-nowrap text-slate-500">
                    {Math.round(r.ratio * 100)}% {r.page && (
                      <button className="underline" onClick={() => onOpenPage(r.page)}>best match p.{r.page}</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {rec.attempts?.length > 1 && (
        <Section icon={RefreshCw} title="Corrective RAG loop">
          <div className="space-y-1 text-xs">
            {rec.attempts.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <Badge color={i === 0 ? 'slate' : a.kept ? 'green' : 'amber'}>attempt {i + 1}{i > 0 ? (a.kept ? ' · kept' : ' · discarded') : ''}</Badge>
                <span className="text-slate-500">query “{a.query}” · {a.mode} k={a.k} · pages {a.pages.join(', ')} · support {a.support != null ? Math.round(a.support * 100) + '%' : '–'}{a.groundedness ? ` · judge ${a.groundedness}/5` : ''}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {rec.sources?.length > 0 && (
        <Section
          icon={BookOpen}
          title={`Retrieved context · ${rec.effectiveMode}${rec.effectiveMode !== rec.config?.mode ? ` (requested ${rec.config?.mode}; semantic index not ready yet)` : ''}`}
          right={
            <button className="text-xs font-medium text-brand-700 dark:text-brand-300" onClick={() => setShowSources(!showSources)}>
              {showSources ? 'Hide' : 'Show'}
            </button>
          }
        >
          {showSources && (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {rec.sources.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onOpenPage(s.page, [s.id])}
                  className="group rounded-lg border border-slate-200 p-2.5 text-left transition hover:border-brand-400 hover:shadow-sm dark:border-slate-800"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <Badge color="brand">#{s.rank} · PDF p.{s.page}</Badge>
                    {s.cosine != null && <Badge color="violet">cos {s.cosine.toFixed(3)}</Badge>}
                    {s.bm25 != null && <Badge color="blue">bm25 {s.bm25.toFixed(1)}</Badge>}
                    {s.rrf != null && <Badge>rrf {s.rrf.toFixed(3)}</Badge>}
                    <Badge>{s.tokens} tok</Badge>
                  </div>
                  <p className="line-clamp-4 text-xs text-slate-600 dark:text-slate-400">{s.text}</p>
                  <span className="mt-1 block text-[11px] font-medium text-brand-700 opacity-0 transition group-hover:opacity-100 dark:text-brand-300">Open page →</span>
                </button>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
