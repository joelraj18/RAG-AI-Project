import { useEffect, useState } from 'react';
import { Bot, Search, Scale, Database, KeyRound, CheckCircle2, XCircle, Loader2, RotateCcw, ExternalLink, Zap, Layers, BookType } from 'lucide-react';
import { Button, Card, CardHeader, Field, Toggle, inputCls, cx, Badge, OptionCard, TagBadges } from '../components/ui.jsx';
import { PROVIDERS, BROWSER_MODELS, generate } from '../lib/llm.js';
import { EMBED_MODELS, RERANK_MODEL } from '../lib/workers.js';
import { PROFILES, matchProfile } from '../lib/settings.js';
import { PRESETS } from '../lib/presets.js';
import { QNA_SYSTEM } from '../lib/prompts.js';
import { systemPrompt } from '../lib/pipeline.js';
import { docBytes } from '../lib/kb.js';
import { db, storageEstimate } from '../lib/db.js';
import { fmtMs, fmtBytes } from '../lib/text.js';
import { useStore } from '../state/store.jsx';
import SecretInput from '../components/SecretInput.jsx';
import HfPanel from '../components/HfPanel.jsx';
import { callsPerQuestion } from '../lib/hf.js';

const MODES = [
  { id: 'hybrid', title: 'Hybrid (BM25 + semantic)', tags: ['recommended', 'quality'], why: 'Combines exact keyword matches with meaning; best recall on most documents.', cost: '+5–20 ms' },
  { id: 'semantic', title: 'Semantic similarity', tags: [], why: 'Notebook baseline (C1). Strong on paraphrases, weaker on codes, names and numbers.', cost: '+5–20 ms' },
  { id: 'mmr', title: 'MMR (diverse)', tags: [], why: 'Notebook C4. Avoids near-duplicate passages but can drift off-topic.', cost: '+10–40 ms' },
  { id: 'bm25', title: 'BM25 keyword', tags: ['fastest', 'lightest'], why: 'Instant and needs no embeddings; misses synonyms.', cost: '~1 ms' },
];

const JUDGE = [
  { id: 'combined', title: 'Combined judge', tags: ['recommended', 'fastest'], why: 'One LLM call scores groundedness, relevance and context relevance.', cost: '+1 LLM call' },
  { id: 'strict', title: 'Strict (notebook)', tags: ['quality'], why: 'Two separate rubric calls, exactly as in the notebook. Most consistent scores.', cost: '+2 LLM calls' },
  { id: 'off', title: 'Off', tags: ['fastest'], why: 'Judge-free metrics only (claim support, citations, similarity).', cost: 'no extra calls' },
];

export default function SettingsView() {
  const { settings: s, setSettings, docs } = useStore();
  const [test, setTest] = useState(null);
  const [usage, setUsage] = useState(null);
  const num = (k) => (e) => setSettings({ [k]: Number(e.target.value) });
  const profile = matchProfile(s);
  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  useEffect(() => {
    storageEstimate().then(setUsage);
  }, [docs]);

  async function testConnection() {
    setTest({ busy: true });
    try {
      const r = await generate(s, { purpose: 'other', messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 8, temperature: 0, topP: 1 });
      setTest({ ok: true, text: r.text, ms: r.latencyMs });
    } catch (e) {
      setTest({ ok: false, text: String(e.message || e) });
    }
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
          <p className="text-sm text-slate-500">
            Badges show the trade-off of each option: <TagBadges tags={['recommended', 'fastest', 'lightest', 'quality', 'private']} />. Settings are saved in this browser; API tokens are never saved (memory only).
          </p>
        </div>

        <Card>
          <CardHeader icon={Zap} title="Quick profile" subtitle={`Sets retrieval, reranking, judging and embedding options in one click. Current: ${profile === 'custom' ? 'custom' : PROFILES[profile].label}.`} />
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            {Object.entries(PROFILES).map(([id, p]) => (
              <OptionCard key={id} selected={profile === id} onClick={() => setSettings(p.values)} title={p.label} tags={p.tags} why={p.why} cost={`k=${p.values.k} · ${p.values.retrievalMode}${p.values.rerank ? ' + rerank' : ''} · judge ${p.values.judgeMode}${s.provider !== 'extractive' ? ` · ~${callsPerQuestion({ ...s, ...p.values }).base} LLM calls/question` : ''}`} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={BookType} title="Document type" subtitle="Tunes the assistant’s role, answer style and judge wording. Works for any document; General fits most." />
          <div className="grid gap-2 p-5 sm:grid-cols-3">
            {Object.entries(PRESETS).map(([id, p]) => (
              <OptionCard key={id} selected={s.preset === id} onClick={() => setSettings({ preset: id })} title={p.label} tags={id === 'general' ? ['recommended'] : []} why={p.style} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Bot} title="Language model" subtitle="All options are free." />
          <div className="space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <OptionCard key={id} selected={s.provider === id} onClick={() => setSettings({ provider: id })} title={p.label} tags={p.tags} why={p.why} cost={p.cost} />
              ))}
            </div>
            {s.provider === 'hf' && <HfPanel />}
            {s.provider === 'openai' && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Base URL" hint="Ollama: http://localhost:11434/v1 (start with OLLAMA_ORIGINS=*). Groq: https://api.groq.com/openai/v1">
                  <input value={s.openaiBaseUrl} onChange={(e) => setSettings({ openaiBaseUrl: e.target.value })} className={inputCls} />
                </Field>
                <Field label="API key" hint="Optional for local servers">
                  <SecretInput value={s.openaiKey} onChange={(v) => setSettings({ openaiKey: v })} placeholder="sk-… (optional)" label="API key" provider="openai" />
                </Field>
                <Field label="Model">
                  <input value={s.openaiModel} onChange={(e) => setSettings({ openaiModel: e.target.value })} className={inputCls} />
                </Field>
              </div>
            )}
            {s.provider === 'browser' && (
              <Field label="In-browser model" hint={hasGpu ? 'WebGPU detected — generation runs on your GPU.' : 'No WebGPU in this browser — generation will run on the CPU and be slow. Prefer Hugging Face Inference.'}>
                <select value={s.browserModel} onChange={(e) => setSettings({ browserModel: e.target.value })} className={inputCls}>
                  {BROWSER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
            )}
            {(s.provider === 'openai' || s.provider === 'browser') && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" icon={KeyRound} onClick={testConnection} disabled={test?.busy}>Test connection</Button>
                {test?.busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {test && !test.busy && (
                  <span className={cx('flex items-center gap-1.5 text-sm', test.ok ? 'text-emerald-600' : 'text-rose-600')}>
                    {test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {test.ok ? `OK — “${test.text}” in ${fmtMs(test.ms)}` : test.text}
                  </span>
                )}
              </div>
            )}
            {s.provider !== 'extractive' && (
              <Toggle
                checked={s.aiSuggestions}
                onChange={(v) => setSettings({ aiSuggestions: v })}
                label="AI-written starter questions"
                hint="Off: starter questions come from section titles (free). On: the LLM writes them once per document (1 call each, cached)."
              />
            )}
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label={`Max answer tokens: ${s.maxTokens}`} hint="512 suits most answers; 256 truncated every vanilla answer in the notebook.">
                <input type="range" min="128" max="2048" step="64" value={s.maxTokens} onChange={num('maxTokens')} className="w-full accent-brand-600" />
              </Field>
              <Field label={`Temperature: ${s.temperature}`} hint="0 = reproducible (recommended).">
                <input type="range" min="0" max="1.2" step="0.1" value={s.temperature} onChange={num('temperature')} className="w-full accent-brand-600" />
              </Field>
              <Field label={`top_p: ${s.topP}`}>
                <input type="range" min="0.5" max="1" step="0.01" value={s.topP} onChange={num('topP')} className="w-full accent-brand-600" />
              </Field>
              <Field label="Model context window" hint="Used for the context-usage bar.">
                <select value={s.contextWindow} onChange={num('contextWindow')} className={inputCls}>
                  {[4096, 8192, 32768, 131072].map((n) => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}
                </select>
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Search} title="Retrieval" subtitle="How passages are found. More passages = more recall but slower, costlier answers." />
          <div className="space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {MODES.map((m) => (
                <OptionCard key={m.id} selected={s.retrievalMode === m.id} onClick={() => setSettings({ retrievalMode: m.id })} title={m.title} tags={m.tags} why={m.why} cost={m.cost} />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Passages per answer (k): ${s.k}`} hint="3–5 recommended. Each extra passage adds ~300–400 prompt tokens (+0.3–1 s).">
                <input type="range" min="1" max="10" value={s.k} onChange={num('k')} className="w-full accent-brand-600" />
              </Field>
              <Field label={`Candidates (fetch_k): ${s.fetchK}`} hint="Pool for fusion, MMR and reranking.">
                <input type="range" min="5" max="60" step="5" value={s.fetchK} onChange={num('fetchK')} className="w-full accent-brand-600" />
              </Field>
              <Field label={`MMR λ: ${s.mmrLambda}`} hint="1 = pure relevance, 0 = pure diversity">
                <input type="range" min="0" max="1" step="0.1" value={s.mmrLambda} onChange={num('mmrLambda')} className="w-full accent-brand-600" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Toggle checked={s.rerank} onChange={(v) => setSettings({ rerank: v })} label={<>Cross-encoder reranking <TagBadges tags={['quality']} /></>} hint={`Re-scores the top ${s.fetchK} candidates jointly with the question. Best single quality boost; ${RERANK_MODEL.size} download once, +100–400 ms.`} />
              <Toggle checked={s.neighbors} onChange={(v) => setSettings({ neighbors: v })} label="Neighbour expansion" hint={`Adds the adjacent chunk of the same section (budget ${s.contextBudget} tokens) so answers are not cut mid-topic. More prompt tokens.`} />
              <Toggle checked={s.condense} onChange={(v) => setSettings({ condense: v })} label={<>Rewrite follow-up questions <TagBadges tags={['recommended']} /></>} hint="LLM turns “what about its treatment?” into a standalone question before searching. +1 short LLM call on follow-ups." />
              <Toggle checked={s.hyde} onChange={(v) => setSettings({ hyde: v })} label="HyDE query expansion" hint="LLM drafts a hypothetical answer and searches with it. Helps vague questions; +1 LLM call per question." />
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Embedding model for new documents</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {EMBED_MODELS.map((m) => (
                  <OptionCard key={m.id} selected={s.embedModel === m.id} onClick={() => setSettings({ embedModel: m.id })} title={m.label} tags={m.tags} why={m.why} cost={`${m.size} download · ${m.dim}-d · stored as int8`} />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:w-1/2">
              <Field label="Chunk size (tokens)" hint="400 (notebook). Smaller = precise, larger = more context.">
                <input type="number" min="100" max="1000" value={s.chunkSize} onChange={num('chunkSize')} className={inputCls} />
              </Field>
              <Field label="Overlap (tokens)" hint="50 (notebook)">
                <input type="number" min="0" max="300" value={s.chunkOverlap} onChange={num('chunkOverlap')} className={inputCls} />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Scale} title="Evaluation" subtitle="Judge-free metrics (claim support, citation validity, answer similarity, confidence) are always computed." />
          <div className="space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {JUDGE.map((j) => (
                <OptionCard key={j.id} selected={s.judgeMode === j.id} onClick={() => setSettings({ judgeMode: j.id })} title={j.title} tags={j.tags} why={j.why} cost={j.cost} />
              ))}
            </div>
            <Toggle checked={s.corrective} onChange={(v) => setSettings({ corrective: v })} label={<>Corrective RAG <TagBadges tags={['quality']} /></>} hint="If an answer is weakly grounded, rewrite the query, retrieve more and keep the better answer. Doubles the time for those questions only." />
          </div>
        </Card>

        <Card>
          <CardHeader icon={Layers} title="System prompt" subtitle="Built from the document type. Override it only if you need a special format." />
          <div className="space-y-2 p-5">
            <textarea value={s.customPrompt || QNA_SYSTEM} onChange={(e) => setSettings({ customPrompt: e.target.value })} rows={8} className={cx(inputCls, 'font-mono text-xs')} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setSettings({ customPrompt: '' })}>Reset to default</Button>
              <span className="text-xs text-slate-500">Placeholders: {'{role} {style} {documents} {cite} {disclaimer}'}</span>
            </div>
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Preview with current documents</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 dark:bg-slate-950">{systemPrompt(s, docs.slice(0, 2).map((d) => d.name).concat(docs.length ? [] : ['Document']))}</pre>
            </details>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Database} title="Storage" subtitle="Vectors are stored as int8 (4× smaller than float32). Original files are kept only for PDFs (page viewer)." />
          <div className="space-y-3 p-5 text-sm">
            {usage && <Badge>{fmtBytes(usage.usage)} used of {fmtBytes(usage.quota)} available to this site</Badge>}
            {docs.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
                    <th className="py-1">Document</th>
                    <th>Original file</th>
                    <th>Chunks</th>
                    <th>Vectors (int8)</th>
                    <th>Keyword index (memory)</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => {
                    const b = docBytes(d);
                    return (
                      <tr key={d.id} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="py-1">{d.name}</td>
                        <td>{fmtBytes(b.file)}</td>
                        <td>{fmtBytes(b.chunks)}</td>
                        <td>{fmtBytes(b.vectors)}</td>
                        <td>{fmtBytes(b.bm25)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirm('Delete all documents, sessions and experiments from this browser?')) return;
                await db.clearAll();
                location.reload();
              }}
            >
              Clear all data
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
