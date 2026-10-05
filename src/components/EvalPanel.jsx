import { useState } from 'react';
import { Timer, ShieldCheck, Target, Quote, Sparkles, RefreshCw, AlertTriangle, Copy, Gauge, ListOrdered } from 'lucide-react';
import { Badge, ScoreRing, Tabs, cx } from './ui.jsx';
import { fmtMs, fmtNum } from '../lib/text.js';
import { buildMessages } from '../lib/pipeline.js';
import { sourceLabel } from '../lib/retrieve.js';
import { useStore } from '../state/store.jsx';

export const STEPS = [
  { key: 'condense', label: 'Question rewrite', color: 'bg-slate-400', hint: 'LLM turns a follow-up into a standalone question' },
  { key: 'hyde', label: 'HyDE passage', color: 'bg-pink-400', hint: 'LLM drafts a hypothetical answer to search with' },
  { key: 'queryEmbed', label: 'Query embedding', color: 'bg-violet-500', hint: 'Question → vector (cached for repeats)' },
  { key: 'search', label: 'Search & fusion', color: 'bg-sky-500', hint: 'BM25 + cosine top-k over int8 vectors, RRF fusion' },
  { key: 'rerank', label: 'Rerank', color: 'bg-indigo-500', hint: 'Cross-encoder re-scores the top candidates' },
  { key: 'expand', label: 'Neighbour expansion', color: 'bg-cyan-400', hint: 'Adds adjacent chunks of the same section' },
  { key: 'generation', label: 'Answer generation', color: 'bg-brand-500', hint: 'LLM writes the cited answer (streamed)' },
  { key: 'evaluation', label: 'Evaluation', color: 'bg-amber-500', hint: 'Judge + claim support + citation checks' },
];

export function TimingWaterfall({ timings }) {
  const steps = STEPS.filter((s) => timings[s.key] >= 0.5 || ['queryEmbed', 'search', 'generation', 'evaluation'].includes(s.key));
  const total = timings.total || steps.reduce((s, x) => s + (timings[x.key] || 0), 0) || 1;
  let offset = 0;
  return (
    <div className="space-y-1.5">
      {steps.map((s) => {
        const v = timings[s.key] || 0;
        const left = offset / total;
        offset += v;
        return (
          <div key={s.key} className="grid grid-cols-[130px_1fr_92px] items-center gap-2 text-xs" title={s.hint}>
            <span className="truncate text-slate-500 dark:text-slate-400">{s.label}</span>
            <div className="relative h-3 rounded bg-slate-100 dark:bg-slate-800">
              <div className={cx('absolute h-3 rounded', s.color)} style={{ left: `${left * 100}%`, width: `${Math.max(v ? 0.6 : 0, (v / total) * 100)}%` }} />
              {s.key === 'generation' && timings.ttft != null && v > 0 && (
                <div className="absolute -top-0.5 h-4 w-0.5 bg-slate-900 dark:bg-white" style={{ left: `${((left * total + timings.ttft) / total) * 100}%` }} title={`First token after ${fmtMs(timings.ttft)}`} />
              )}
            </div>
            <span className="text-right font-medium tabular-nums">
              {fmtMs(v)} <span className="text-slate-400">{Math.round((v / total) * 100)}%</span>
            </span>
          </div>
        );
      })}
      <div className="grid grid-cols-[130px_1fr_92px] items-center gap-2 border-t border-slate-100 pt-1.5 text-xs dark:border-slate-800">
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

const CONF = { High: 'green', Medium: 'amber', Low: 'red' };
const STATUS = {
  supported: 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/20',
  partial: 'border-amber-400 bg-amber-50/70 dark:bg-amber-900/20',
  unsupported: 'border-rose-400 bg-rose-50/70 dark:bg-rose-900/20',
};
const pct = (x) => (x == null ? null : x * 100);

export function ConfidenceBadge({ conf }) {
  if (!conf) return null;
  return (
    <Badge color={CONF[conf.level]} title={conf.reasons.join(' ')}>
      <ShieldCheck className="h-3 w-3" /> {conf.level} confidence
    </Badge>
  );
}

function Overview({ rec, onOpen }) {
  const h = rec.eval?.heuristic;
  const j = rec.eval?.judge;
  const conf = rec.eval?.confidence;
  const evaluating = rec.phase === 'evaluating' || rec.phase === 'correcting';
  return (
    <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
      <Section icon={Timer} title="Time taken to process">
        <TimingWaterfall timings={rec.timings} />
        {rec.gen && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge>prompt {fmtNum(rec.gen.promptTokens)} tok{rec.gen.tokensEstimated ? '*' : ''}</Badge>
            <Badge>answer {fmtNum(rec.gen.completionTokens)} tok</Badge>
            {rec.gen.tokensPerSec && <Badge color="blue">{rec.gen.tokensPerSec.toFixed(1)} tok/s</Badge>}
            <Badge color={rec.gen.truncated ? 'red' : 'green'}>
              finish: {rec.gen.finishReason}
              {rec.gen.truncated ? ' (truncated — raise max tokens)' : ''}
            </Badge>
          </div>
        )}
      </Section>
      <Section icon={ShieldCheck} title="Groundedness & relevance" right={evaluating ? <Badge color="amber"><Sparkles className="h-3 w-3 animate-pulse" /> judging…</Badge> : <ConfidenceBadge conf={conf} />}>
        <div className="flex flex-wrap items-start justify-around gap-3">
          <ScoreRing score={j?.groundedness ?? null} label="Groundedness" sub="LLM judge 1–5" />
          <ScoreRing score={j?.relevance ?? null} label="Relevance" sub="LLM judge 1–5" />
          <ScoreRing score={h?.support?.rows?.length ? pct(h.support.share) : null} max={100} label="Claim support" sub="claims found in context" />
          <ScoreRing score={pct(h?.citations?.precision)} max={100} label="Citation validity" sub={h ? `${h.citations.valid.length}/${h.citations.cited.length} valid` : ''} />
        </div>
        {!j && !evaluating && (
          <p className="mt-2 text-xs text-slate-500">
            {rec.error
              ? 'Not evaluated: the answer could not be generated (see the message above).'
              : rec.eval?.judgeError
              ? `Judge failed: ${rec.eval.judgeError}`
              : rec.provider === 'extractive'
                ? 'The LLM judge needs an LLM provider (Settings). Judge-free metrics are shown.'
                : 'LLM judge is off (Settings → Evaluation).'}
          </p>
        )}
        {conf?.level === 'Low' && conf.reasons.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {conf.reasons.join(' ')} Check the cited pages before relying on this answer.
          </p>
        )}
      </Section>
      {rec.sources?.length > 0 && (
        <div className="lg:col-span-2">
          <SourceCards rec={rec} onOpen={onOpen} compact />
        </div>
      )}
    </div>
  );
}

function SourceCards({ rec, onOpen, compact }) {
  const list = compact ? rec.sources.filter((s) => !s.neighbor) : rec.sources;
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {list.map((s) => (
        <button key={s.key} onClick={() => onOpen(s.docId, s.page, [s.key])} className="group rounded-lg border border-slate-200 p-2.5 text-left transition hover:border-brand-400 hover:shadow-sm dark:border-slate-800">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <Badge color={s.neighbor ? 'slate' : 'brand'}>
              {s.neighbor ? `+ neighbour of #${s.neighborOf}` : `#${s.rank}`} · {sourceLabel(s)}
            </Badge>
            {s.scores?.rerank != null && <Badge color="violet">rerank {s.scores.rerank.toFixed(3)}</Badge>}
            {s.scores?.cosine != null && <Badge color="violet">cos {s.scores.cosine.toFixed(3)}</Badge>}
            {s.scores?.bm25 != null && <Badge color="blue">bm25 {s.scores.bm25.toFixed(1)}</Badge>}
            {!compact && s.scores?.rrf != null && <Badge>rrf {s.scores.rrf.toFixed(4)}</Badge>}
            <Badge>{s.tokens} tok</Badge>
          </div>
          {s.section && <div className="truncate text-[11px] font-semibold text-slate-500">§ {s.section}</div>}
          <p className={cx('text-xs text-slate-600 dark:text-slate-400', compact ? 'line-clamp-3' : 'line-clamp-6')}>{s.text}</p>
        </button>
      ))}
    </div>
  );
}

function RankList({ title, items, hint }) {
  if (!items?.length) return null;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300" title={hint}>
        {title}
      </div>
      <ol className="space-y-0.5 text-[11px]">
        {items.map((x, i) => (
          <li key={x.key} className="flex gap-1.5 truncate">
            <span className="w-4 text-right text-slate-400">{i + 1}</span>
            <span className="truncate">
              {x.docName} p.{x.page}
            </span>
            <span className="ml-auto text-slate-400 tabular-nums">{x.score != null ? x.score.toFixed(3) : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RetrievalTab({ rec, onOpen }) {
  const t = rec.trace?.retrieval;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge color="violet">mode: {rec.effectiveMode}</Badge>
        {rec.effectiveMode !== rec.config?.mode && <Badge color="amber">requested {rec.config?.mode} — semantic index not ready for every document</Badge>}
        <Badge>k = {rec.config?.k}</Badge>
        {rec.config?.rerank && <Badge color="violet">reranked</Badge>}
        {rec.config?.neighbors && <Badge color="blue">+ neighbours</Badge>}
        <Badge>context {fmtNum(rec.trace?.contextTokens)} tok</Badge>
        {rec.trace?.standalone && rec.trace.standalone !== rec.question && <Badge color="slate">standalone: “{rec.trace.standalone}”</Badge>}
        {rec.trace?.rerankError && <Badge color="red">rerank failed: {rec.trace.rerankError}</Badge>}
      </div>
      {rec.trace?.hyde && (
        <p className="rounded-lg bg-pink-50 p-2 text-xs text-pink-900 dark:bg-pink-900/20 dark:text-pink-200">
          <b>HyDE passage used for semantic search:</b> {rec.trace.hyde}
        </p>
      )}
      {t && (
        <Section icon={ListOrdered} title="Candidate rankings (top 10 each)">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <RankList title="Keyword (BM25)" items={t.bm25} hint="Exact word matches weighted by rarity" />
            <RankList title="Semantic (cosine)" items={t.semantic} hint="Meaning similarity of embeddings" />
            <RankList title="Fused (RRF)" items={t.fused} hint="Reciprocal Rank Fusion of both lists" />
            <RankList title="Reranked (cross-encoder)" items={t.reranked} hint="Joint question–passage scoring" />
          </div>
        </Section>
      )}
      <SourceCards rec={rec} onOpen={onOpen} />
    </div>
  );
}

function PromptTab({ rec }) {
  const { settings, docs } = useStore();
  const names = (rec.docIds || []).map((id) => docs.find((d) => d.id === id)?.name).filter(Boolean);
  const messages = rec.prompt || (rec.provider !== 'extractive' ? buildMessages(settings, names, rec.sources, rec.question, [], rec.kind === 'vanilla') : null);
  if (!messages) return <p className="text-sm text-slate-500">Extractive mode sends no prompt: sentences are selected directly from the retrieved chunks.</p>;
  const used = rec.gen?.promptTokens || 0;
  const limit = settings.contextWindow;
  return (
    <div className="space-y-3">
      <Section icon={Gauge} title="Context window usage">
        <div className="h-3 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {fmtNum(used)} prompt tokens of a {fmtNum(limit)}-token window ({Math.round((used / limit) * 100)}%). Retrieved context: {fmtNum(rec.trace?.contextTokens)} tokens.
          {!rec.prompt && ' Prompt rebuilt from the saved sources (conversation history not included).'}
        </p>
      </Section>
      {messages.map((m, i) => (
        <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500 uppercase dark:border-slate-800">
            {m.role}
            <button className="flex items-center gap-1 normal-case" onClick={() => navigator.clipboard?.writeText(m.content)}>
              <Copy className="h-3 w-3" /> copy
            </button>
          </div>
          <pre className="scroll-thin max-h-72 overflow-auto p-3 text-xs whitespace-pre-wrap">{m.content}</pre>
        </div>
      ))}
    </div>
  );
}

function EvaluationTab({ rec, onOpen }) {
  const [showAll, setShowAll] = useState(true);
  const h = rec.eval?.heuristic;
  const j = rec.eval?.judge;
  if (!h) return <p className="text-sm text-slate-500">Evaluation appears when the answer is complete.</p>;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <ScoreRing score={j?.groundedness ?? null} label="Groundedness" sub="judge" size={56} />
        <ScoreRing score={j?.relevance ?? null} label="Relevance" sub="judge" size={56} />
        <ScoreRing score={j?.contextRelevance ?? null} label="Context relevance" sub="judge (combined)" size={56} />
        <ScoreRing score={pct(h.utilization)} max={100} label="Context used" sub="retrieved chunks cited" size={56} />
        <ScoreRing score={pct(h.answerSimilarity)} max={100} label="Answer ↔ question" sub="embedding similarity" size={56} />
        <ScoreRing score={pct(h.coverage)} max={100} label="Question coverage" sub="question terms answered" size={56} />
        <ScoreRing score={pct(h.support.citationAccuracy)} max={100} label="Citation accuracy" sub="cited passage contains the claim" size={56} />
      </div>
      {j && (
        <Section icon={Quote} title={`Judge (${j.mode === 'strict' ? 'strict, 2 calls' : 'combined, 1 call'}) · ${fmtMs(j.ms)}`}>
          {Object.entries(j.justification || {}).map(([k, v]) => v && (
            <p key={k} className="mb-1 text-sm text-slate-600 dark:text-slate-300">
              <b className="capitalize">{k}:</b> {v}
            </p>
          ))}
          {j.unsupported?.length > 0 && <p className="text-xs text-rose-600">Unsupported: {j.unsupported.join(' · ')}</p>}
          {j.missing?.length > 0 && <p className="text-xs text-amber-600">Missing: {j.missing.join(' · ')}</p>}
        </Section>
      )}
      <Section
        icon={Target}
        title="Claim-level support map"
        right={
          <button className="text-xs font-medium text-brand-700 dark:text-brand-300" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Hide claims' : `Show ${h.support.rows.length} claims`}
          </button>
        }
      >
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge color="green">{h.support.rows.filter((r) => r.status === 'supported').length} supported</Badge>
          <Badge color="amber">{h.support.rows.filter((r) => r.status === 'partial').length} partial</Badge>
          <Badge color="red">{h.support.rows.filter((r) => r.status === 'unsupported').length} unsupported</Badge>
          <Badge color="violet">citations on {Math.round(h.citations.coverage * 100)}% of claims</Badge>
          {h.support.misattributed > 0 && <Badge color="red">{h.support.misattributed} claim(s) cite the wrong passage</Badge>}
          {h.citations.invalid.length > 0 && <Badge color="red">cited but not retrieved: {h.citations.invalid.map((c) => `${c.name ? c.name + ' ' : ''}p.${c.page}`).join(', ')}</Badge>}
          {h.fallback && <Badge color="amber"><AlertTriangle className="h-3 w-3" /> fallback answer</Badge>}
        </div>
        {showAll && (
          <div className="mt-3 space-y-1.5">
            {h.support.rows.map((r, i) => (
              <div key={i} className={cx('rounded-r-lg border-l-4 px-3 py-1.5 text-sm', STATUS[r.status])}>
                <span>{r.plain ?? r.text}</span>
                {r.misattributed && <Badge color="red" className="ml-2">cited source does not contain this</Badge>}
                <span className="ml-2 text-xs whitespace-nowrap text-slate-500">
                  {Math.round(r.ratio * 100)}%{' '}
                  {r.page != null && (
                    <button className="underline" onClick={() => onOpen(rec.sources.find((s) => s.key === r.key)?.docId, r.page, [r.key])}>
                      best match {r.docName} p.{r.page}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      {rec.attempts?.length > 1 && (
        <Section icon={RefreshCw} title="Corrective RAG loop">
          <div className="space-y-1 text-xs">
            {rec.attempts.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <Badge color={i === 0 ? 'slate' : a.kept ? 'green' : 'amber'}>
                  attempt {i + 1}
                  {i > 0 ? (a.kept ? ' · kept' : ' · discarded') : ''}
                </Badge>
                <span className="text-slate-500">
                  “{a.query}” · {a.mode} k={a.k} · {a.refs.join(', ')} · support {a.support != null ? Math.round(a.support * 100) + '%' : '–'}
                  {a.groundedness ? ` · judge ${a.groundedness}/5` : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export default function EvalPanel({ rec }) {
  const { openPage } = useStore();
  const [tab, setTab] = useState('overview');
  const onOpen = (docId, page, keys) => docId && openPage(docId, page, keys);
  return (
    <div className="mt-3">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'retrieval', label: `Retrieval (${rec.sources?.length || 0})` },
          { id: 'prompt', label: 'Prompt' },
          { id: 'timing', label: 'Timing' },
          { id: 'evaluation', label: 'Evaluation' },
        ]}
      />
      <div className="pt-3">
        {tab === 'overview' && <Overview rec={rec} onOpen={onOpen} />}
        {tab === 'retrieval' && <RetrievalTab rec={rec} onOpen={onOpen} />}
        {tab === 'prompt' && <PromptTab rec={rec} />}
        {tab === 'timing' && (
          <Section icon={Timer} title="Per-step timing">
            <TimingWaterfall timings={rec.timings} />
            <ul className="mt-3 space-y-0.5 text-xs text-slate-500">
              {STEPS.filter((s) => rec.timings[s.key] > 0).map((s) => (
                <li key={s.key}>
                  <b>{s.label}</b> — {s.hint}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {tab === 'evaluation' && <EvaluationTab rec={rec} onOpen={onOpen} />}
      </div>
    </div>
  );
}
