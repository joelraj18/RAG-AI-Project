import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ExternalLink, ListRestart, FlaskConical, CloudUpload } from 'lucide-react';
import { Button, Field, inputCls, cx } from './ui.jsx';
import SecretInput from './SecretInput.jsx';
import { PROVIDERS, apiKeyOf, keyModelOf } from '../lib/providers.js';
import { generate, listModels } from '../lib/llm.js';
import { fmtMs } from '../lib/text.js';
import { useStore } from '../state/store.jsx';

const EFFORT = [
  { id: 'low', label: 'Low', note: 'Fastest and cheapest' },
  { id: 'medium', label: 'Medium', note: 'Recommended' },
  { id: 'high', label: 'High', note: 'Most careful, slower' },
];

/** Key, model and test controls for a bring-your-own-key provider (Claude, DeepSeek, OpenAI and others). */
export default function ProviderPanel({ id }) {
  const { settings: s, setSettings } = useStore();
  const p = PROVIDERS[id];
  const key = apiKeyOf(s, id);
  const model = keyModelOf(s, id);
  const [loaded, setLoaded] = useState(null);
  const [state, setState] = useState(null);

  const setKey = (v) => setSettings({ apiKeys: { ...s.apiKeys, [id]: v } });
  const setModel = (v) => setSettings({ apiModels: { ...s.apiModels, [id]: v } });
  const options = [...new Set([...(p.models || []).map((m) => m.id), ...(loaded || [])])];
  const info = p.models?.find((m) => m.id === model);

  async function load() {
    setState({ busy: 'models' });
    try {
      const ids = await listModels(s, id);
      setLoaded(ids);
      setState({ ok: true, text: `${ids.length} models available to this key` });
    } catch (e) {
      setState({ ok: false, text: String(e.message || e) });
    }
  }
  async function test() {
    setState({ busy: 'test' });
    try {
      const r = await generate(s, { purpose: 'other', messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 8, temperature: 0, topP: 1 });
      setState({ ok: true, text: `OK: “${r.text}” in ${fmtMs(r.latencyMs)}${r.servedBy ? ` (served by ${r.servedBy})` : ''}` });
    } catch (e) {
      setState({ ok: false, text: String(e.message || e) });
    }
  }

  return (
    <div className="space-y-4 rounded-[18px] bg-slate-50 p-5 dark:bg-slate-950/50">
      <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
        <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <span>
          When you ask a question, the question, recent chat turns and the retrieved excerpts are sent to <b>{p.company}</b> (<code>{p.host}</code>), directly from your browser. Your files, the rest of the
          text and your library stay on this device.{' '}
          <a className="inline-flex items-center gap-0.5 text-brand-700 underline dark:text-brand-400" href={p.policyUrl} target="_blank" rel="noreferrer noopener">
            Data policy <ExternalLink className="h-3 w-3" />
          </a>
        </span>
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label={`${p.label} API key`}
          hint={
            <a className="inline-flex items-center gap-0.5 text-brand-700 underline dark:text-brand-400" href={p.keysUrl} target="_blank" rel="noreferrer noopener">
              Get a key <ExternalLink className="h-3 w-3" />
            </a>
          }
        >
          <SecretInput value={key} onChange={setKey} placeholder={p.keyPrefix ? `${p.keyPrefix}…` : 'API key'} label={`${p.label} API key`} provider={id} />
        </Field>
        <Field label="Model" hint={info?.note || 'Type any model id, or load the list your key can use.'}>
          <div className="flex gap-2">
            <input list={`models-${id}`} value={model} onChange={(e) => setModel(e.target.value.trim())} className={cx(inputCls, 'font-mono')} spellCheck={false} aria-label="Model id" />
            <datalist id={`models-${id}`}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {p.models?.find((x) => x.id === m)?.label}
                </option>
              ))}
            </datalist>
            <Button variant="secondary" size="sm" icon={ListRestart} onClick={load} disabled={!key || !!state?.busy} title="Free call that lists models; no tokens are billed">
              Load models
            </Button>
          </div>
        </Field>
      </div>
      {p.kind === 'anthropic' && (
        <div>
          <div className="mb-1 text-sm font-medium">Thinking effort (Claude 5.5 models)</div>
          <div className="inline-flex rounded-full bg-slate-200/70 p-1 dark:bg-slate-800" role="radiogroup" aria-label="Thinking effort">
            {EFFORT.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={s.claudeEffort === e.id}
                onClick={() => setSettings({ claudeEffort: e.id })}
                className={cx('rounded-full px-4 py-1.5 text-sm', s.claudeEffort === e.id ? 'bg-white font-medium shadow-sm dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300')}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {EFFORT.find((e) => e.id === s.claudeEffort)?.note}. Judge and rewrite calls always use low effort. Temperature and top_p are not sent to Opus 5.5 and Sonnet 5.5, which choose their own sampling.
            Refusal fallbacks are on for these two models: if the model declines a request, Anthropic re-runs it on its recommended fallback model in the same call.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={FlaskConical} onClick={test} disabled={!key || !!state?.busy}>
          Test (1 small call)
        </Button>
        {state?.busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {state && !state.busy && (
          <span className={cx('flex items-center gap-1.5 text-sm', state.ok ? 'text-emerald-600' : 'text-rose-600')}>
            {state.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {state.text}
          </span>
        )}
      </div>
    </div>
  );
}
