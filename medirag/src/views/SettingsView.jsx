import { useEffect, useState } from 'react';
import { Bot, Search, Scale, Database, KeyRound, CheckCircle2, XCircle, Loader2, RotateCcw, ExternalLink } from 'lucide-react';
import { Button, Card, CardHeader, Field, Toggle, inputCls, cx, Badge } from '../components/ui.jsx';
import { PROVIDERS, HF_MODELS, BROWSER_MODELS, generate } from '../lib/llm.js';
import { EMBED_MODELS } from '../lib/workers.js';
import { DEFAULT_SETTINGS } from '../lib/settings.js';
import { db, storageEstimate } from '../lib/db.js';
import { fmtMs } from '../lib/text.js';

export default function SettingsView({ settings, setSettings }) {
  const [test, setTest] = useState(null);
  const [usage, setUsage] = useState(null);
  const s = settings;
  const num = (k, parse = Number) => (e) => setSettings({ [k]: parse(e.target.value) });

  useEffect(() => {
    storageEstimate().then(setUsage);
  }, []);

  async function testConnection() {
    setTest({ busy: true });
    try {
      const r = await generate(s, { messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 8, temperature: 0, topP: 1 });
      setTest({ ok: true, text: r.text, ms: r.latencyMs });
    } catch (e) {
      setTest({ ok: false, text: String(e.message || e) });
    }
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
          <p className="text-sm text-slate-500">Saved in this browser only. Your keys are sent only to the provider you choose.</p>
        </div>

        <Card>
          <CardHeader icon={Bot} title="Language model" subtitle="All options are free." />
          <div className="space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <button
                  key={id}
                  onClick={() => setSettings({ provider: id })}
                  className={cx(
                    'rounded-xl border p-3 text-left text-sm transition',
                    s.provider === id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-900/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-800'
                  )}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-slate-500">
                    {{
                      hf: 'Llama 3.1, Qwen 2.5, Mistral, Gemma via router.huggingface.co — free monthly credits.',
                      openai: 'Run Mistral-7B locally with Ollama (same model as the notebook) or use Groq / OpenRouter free tiers.',
                      browser: 'Downloads a small model once, then runs on your GPU/CPU. Nothing leaves the device.',
                      extractive: 'Zero setup. Quotes the most relevant manual sentences with citations.',
                    }[id]}
                  </div>
                </button>
              ))}
            </div>

            {s.provider === 'hf' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Hugging Face access token"
                  hint={
                    <a className="inline-flex items-center gap-1 text-brand-700 underline dark:text-brand-300" href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
                      Create a free token (fine-grained, “Make calls to Inference Providers”) <ExternalLink className="h-3 w-3" />
                    </a>
                  }
                >
                  <input type="password" value={s.hfToken} onChange={(e) => setSettings({ hfToken: e.target.value.trim() })} placeholder="hf_…" className={inputCls} />
                </Field>
                <Field label="Model" hint="Any chat model served by HF Inference Providers. Append :fastest or :cheapest to choose a provider policy.">
                  <input list="hf-models" value={s.hfModel} onChange={(e) => setSettings({ hfModel: e.target.value })} className={inputCls} />
                  <datalist id="hf-models">{HF_MODELS.map((m) => <option key={m} value={m} />)}</datalist>
                </Field>
              </div>
            )}
            {s.provider === 'openai' && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Base URL" hint="Ollama: http://localhost:11434/v1 (start with OLLAMA_ORIGINS=*)">
                  <input value={s.openaiBaseUrl} onChange={(e) => setSettings({ openaiBaseUrl: e.target.value })} className={inputCls} />
                </Field>
                <Field label="API key" hint="Optional for local servers">
                  <input type="password" value={s.openaiKey} onChange={(e) => setSettings({ openaiKey: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Model">
                  <input value={s.openaiModel} onChange={(e) => setSettings({ openaiModel: e.target.value })} className={inputCls} />
                </Field>
              </div>
            )}
            {s.provider === 'browser' && (
              <Field label="In-browser model" hint="First use downloads the model (cached afterwards). WebGPU (Chrome/Edge) is much faster than CPU.">
                <select value={s.browserModel} onChange={(e) => setSettings({ browserModel: e.target.value })} className={inputCls}>
                  {BROWSER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
            )}
            {s.provider !== 'extractive' && (
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
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Max answer tokens: ${s.maxTokens}`} hint="Notebook used 512 for RAG (256 truncated every vanilla answer).">
                <input type="range" min="128" max="2048" step="64" value={s.maxTokens} onChange={num('maxTokens')} className="w-full accent-brand-600" />
              </Field>
              <Field label={`Temperature: ${s.temperature}`} hint="0 = reproducible (recommended).">
                <input type="range" min="0" max="1.2" step="0.1" value={s.temperature} onChange={num('temperature')} className="w-full accent-brand-600" />
              </Field>
              <Field label={`top_p: ${s.topP}`}>
                <input type="range" min="0.5" max="1" step="0.01" value={s.topP} onChange={num('topP')} className="w-full accent-brand-600" />
              </Field>
            </div>
            <Field label="System prompt" hint="{manual} is replaced by the manual's title. Default is the notebook's grounding prompt.">
              <textarea value={s.systemPrompt} onChange={(e) => setSettings({ systemPrompt: e.target.value })} rows={7} className={cx(inputCls, 'font-mono text-xs')} />
            </Field>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setSettings({ systemPrompt: DEFAULT_SETTINGS.systemPrompt })}>Reset prompt</Button>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Search} title="Retrieval" subtitle="Notebook best operating point: similarity, k = 3." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Search mode">
              <select value={s.retrievalMode} onChange={(e) => setSettings({ retrievalMode: e.target.value })} className={inputCls}>
                <option value="hybrid">Hybrid — BM25 + semantic, RRF fusion (recommended)</option>
                <option value="semantic">Semantic similarity (notebook C1)</option>
                <option value="mmr">MMR diverse (notebook C4)</option>
                <option value="bm25">BM25 keyword only</option>
              </select>
            </Field>
            <Field label={`Chunks to retrieve (k): ${s.k}`}>
              <input type="range" min="1" max="10" value={s.k} onChange={num('k')} className="w-full accent-brand-600" />
            </Field>
            <Field label={`fetch_k (candidates for MMR/hybrid): ${s.fetchK}`}>
              <input type="range" min="5" max="60" step="5" value={s.fetchK} onChange={num('fetchK')} className="w-full accent-brand-600" />
            </Field>
            <Field label={`MMR λ: ${s.mmrLambda}`} hint="1 = pure relevance, 0 = pure diversity">
              <input type="range" min="0" max="1" step="0.1" value={s.mmrLambda} onChange={num('mmrLambda')} className="w-full accent-brand-600" />
            </Field>
            <Field label="Embedding model for new manuals">
              <select value={s.embedModel} onChange={(e) => setSettings({ embedModel: e.target.value })} className={inputCls}>
                {EMBED_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Chunk size (tokens)">
                <input type="number" min="100" max="1000" value={s.chunkSize} onChange={num('chunkSize')} className={inputCls} />
              </Field>
              <Field label="Overlap (tokens)">
                <input type="number" min="0" max="300" value={s.chunkOverlap} onChange={num('chunkOverlap')} className={inputCls} />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Scale} title="Evaluation" />
          <div className="space-y-4 p-5">
            <Toggle checked={s.judgeEnabled} onChange={(v) => setSettings({ judgeEnabled: v })} label="LLM-as-a-judge (groundedness + relevance, 1–5)" hint="Uses the notebook's rubric prompts. Adds two extra LLM calls per answer." />
            <Toggle checked={s.corrective} onChange={(v) => setSettings({ corrective: v })} label="Corrective RAG" hint="If an answer is weakly grounded or falls back, rewrite the query in clinical terms, retrieve more context and keep the better answer." />
            <Field label={`Judge max tokens: ${s.judgeMaxTokens}`}>
              <input type="range" min="60" max="400" step="20" value={s.judgeMaxTokens} onChange={num('judgeMaxTokens')} className="w-full accent-brand-600" />
            </Field>
            <p className="text-xs text-slate-500">Judge-free metrics (lexical support per claim, citation validity, question coverage) are always computed.</p>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Database} title="Storage" />
          <div className="flex flex-wrap items-center gap-3 p-5 text-sm">
            {usage && <Badge>{(usage.usage / 1048576).toFixed(1)} MB used of {(usage.quota / 1073741824).toFixed(1)} GB available</Badge>}
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirm('Delete all manuals, sessions and experiments from this browser?')) return;
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
