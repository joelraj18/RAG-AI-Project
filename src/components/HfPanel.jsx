import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, AlertTriangle, ExternalLink, BadgeCheck, Gauge, Building2, RotateCcw, FlaskConical } from 'lucide-react';
import SecretInput from './SecretInput.jsx';
import { Badge, Button, Field, OptionCard, inputCls, cx } from './ui.jsx';
import { HF_MODELS, PLAN_DEFAULTS, BILLING_URL, TOKENS_URL, whoami, callsPerQuestion, isLargeModel, modelInfo } from '../lib/hf.js';
import { generate, hfModelId } from '../lib/llm.js';
import { resetMonthlyUsage } from '../lib/usage.js';
import { fmtMs, fmtNum } from '../lib/text.js';
import { useStore } from '../state/store.jsx';

const PURPOSES = { answer: 'Answers', vanilla: 'Vanilla answers', judge: 'Judge', rewrite: 'Question rewrites', hyde: 'HyDE', suggest: 'Suggestions', other: 'Other' };

export function AccountStatus({ compact }) {
  const { hfAccount: a, effectivePlan, settings } = useStore();
  if (!settings.hfToken) return null;
  if (!a || a.status === 'checking')
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking token with Hugging Face (free, no credits)…
      </span>
    );
  if (a.status === 'error')
    return (
      <span className={cx('flex items-start gap-1.5 text-xs', a.unverified ? 'text-amber-700 dark:text-amber-400' : 'text-rose-600')}>
        {a.unverified ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />} {a.error}
      </span>
    );
  return (
    <div className="space-y-1">
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Signed in as <b>{a.name}</b>
        <Badge color={a.plan === 'pro' ? 'violet' : 'slate'}>
          <BadgeCheck className="h-3 w-3" /> {a.plan === 'pro' ? 'PRO' : 'Free'} account
        </Badge>
        {!compact && settings.hfPlan !== 'auto' && settings.hfPlan !== a.plan && <Badge color="amber">using {PLAN_DEFAULTS[effectivePlan].label} settings (manual)</Badge>}
        {!compact && a.tokenRole && <Badge>{a.tokenRole === 'fineGrained' ? 'fine-grained token' : `${a.tokenRole} token`}</Badge>}
      </span>
      {!a.inferencePermission && (
        <span className="flex items-start gap-1.5 text-xs text-rose-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This fine-grained token does not seem to allow “Make calls to Inference Providers”. Edit it at{' '}
          <a className="underline" href={TOKENS_URL} target="_blank" rel="noreferrer noopener">huggingface.co/settings/tokens</a>.
        </span>
      )}
      {!compact && a.tokenRole === 'write' && <span className="block text-xs text-amber-700 dark:text-amber-400">Tip: this is a write token. A fine-grained, inference-only token is safer for apps.</span>}
    </div>
  );
}

export function UsageMeter() {
  const { usage, settings, effectivePlan } = useStore();
  const per = callsPerQuestion(settings);
  const per2 = callsPerQuestion(settings, { followUp: true });
  const row = (label, u) => (
    <tr className="border-b border-slate-100 dark:border-slate-800/60">
      <td className="py-1 font-medium">{label}</td>
      <td className="tabular-nums">{fmtNum(u.calls)}</td>
      <td className="tabular-nums">{fmtNum(u.promptTokens)}</td>
      <td className="tabular-nums">{fmtNum(u.completionTokens)}</td>
      <td className="tabular-nums">{u.failed ? <Badge color="red">{u.failed}</Badge> : 0}</td>
      <td className="text-slate-500">{Object.entries(u.byPurpose).filter(([, v]) => v.calls).map(([k, v]) => `${PURPOSES[k] || k} ${v.calls}`).join(' · ') || '–'}</td>
    </tr>
  );
  return (
    <div className="space-y-2 text-xs">
      <p className="text-slate-600 dark:text-slate-300">
        <Gauge className="mr-1 inline h-3.5 w-3.5" />
        With current settings each question uses <b>{per.base}</b> LLM call{per.base === 1 ? '' : 's'}
        {per.worst > per.base ? ` (up to ${per.worst} with a corrective retry)` : ''}, follow-ups {per2.base}.{' '}
        {effectivePlan === 'free' && per.base > 2 && <span className="text-amber-700 dark:text-amber-400">On the free plan, the Free settings below use fewer credits.</span>}
      </p>
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
            <th className="py-1">Period</th>
            <th>Calls</th>
            <th>Prompt tok</th>
            <th>Answer tok</th>
            <th>Failed</th>
            <th>By purpose</th>
          </tr>
        </thead>
        <tbody>
          {row('This visit', usage.visit)}
          {row(`This month (${usage.monthly.month}, this browser)`, usage.monthly)}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 text-slate-500">
        <span>Counts are measured in this browser; Hugging Face bills by provider compute, so the exact credit use is on your billing page.</span>
        <a className="inline-flex items-center gap-1 font-medium text-brand-700 underline dark:text-brand-300" href={BILLING_URL} target="_blank" rel="noreferrer noopener">
          View credits & billing <ExternalLink className="h-3 w-3" />
        </a>
        <button className="inline-flex items-center gap-1 hover:text-slate-700" onClick={resetMonthlyUsage}>
          <RotateCcw className="h-3 w-3" /> reset counter
        </button>
      </div>
    </div>
  );
}

export default function HfPanel() {
  const { settings: s, setSettings, hfAccount, effectivePlan } = useStore();
  const [test, setTest] = useState(null);
  const plan = PLAN_DEFAULTS[effectivePlan];
  const planApplied = Object.entries(plan.values).every(([k, v]) => s[k] === v);
  const info = modelInfo(s.hfModel);
  const largeOnFree = effectivePlan === 'free' && isLargeModel(s.hfModel);

  async function verify() {
    setTest({ busy: 'verify' });
    const r = await whoami(s.hfToken);
    setTest(r.ok ? { ok: true, text: `Valid token for ${r.name} (${r.plan === 'pro' ? 'PRO' : 'Free'}). No credits used.` } : { ok: false, text: r.error });
  }
  async function testModel() {
    setTest({ busy: 'model' });
    try {
      const r = await generate(s, { purpose: 'other', messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 5, temperature: 0, topP: 1 });
      setTest({ ok: true, text: `${hfModelId(s)} answered “${r.text}” in ${fmtMs(r.latencyMs)} (1 small call).` });
    } catch (e) {
      setTest({ ok: false, text: e.message, billing: e.billing });
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Hugging Face access token" hint={<a className="inline-flex items-center gap-1 text-brand-700 underline dark:text-brand-300" href={TOKENS_URL} target="_blank" rel="noreferrer noopener">Create a free fine-grained token with “Make calls to Inference Providers” <ExternalLink className="h-3 w-3" /></a>}>
        <SecretInput value={s.hfToken} onChange={(v) => setSettings({ hfToken: v })} />
      </Field>
      <AccountStatus />

      <div>
        <div className="mb-1 text-sm font-medium">Your plan</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <OptionCard selected={s.hfPlan === 'auto'} onClick={() => setSettings({ hfPlan: 'auto' })} title="Auto-detect" tags={['recommended']} why={hfAccount?.status === 'ok' ? `Detected: ${hfAccount.plan === 'pro' ? 'PRO' : 'Free'} account.` : 'Read from your token (free check, no credits).'} />
          <OptionCard selected={s.hfPlan === 'free'} onClick={() => setSettings({ hfPlan: 'free' })} title="Free" tags={['lightest']} why="Small monthly inference allowance — keep calls few and models small." />
          <OptionCard selected={s.hfPlan === 'pro'} onClick={() => setSettings({ hfPlan: 'pro' })} title="PRO" tags={['quality']} why="Larger monthly credits (and pay-as-you-go beyond them): 70B models and strict judging are fine." />
        </div>
        <div className={cx('mt-2 flex flex-wrap items-center gap-2 rounded-xl p-3 text-sm', planApplied ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200' : 'bg-brand-50 text-brand-900 dark:bg-brand-900/30 dark:text-brand-100')}>
          <span className="flex-1">
            <b>Recommended for {plan.label}:</b> {plan.summary}
          </span>
          {planApplied ? (
            <Badge color="green"><CheckCircle2 className="h-3 w-3" /> applied</Badge>
          ) : (
            <Button size="sm" onClick={() => setSettings(plan.values)}>Apply {plan.label} settings</Button>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">Model</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {HF_MODELS.map((m) => (
            <OptionCard
              key={m.id}
              selected={s.hfModel === m.id}
              onClick={() => setSettings({ hfModel: m.id })}
              title={m.label}
              tags={m.tags}
              why={m.why}
              cost={`${m.size} · ${m.plans.includes('free') ? 'fits the free plan' : 'PRO recommended'}`}
            />
          ))}
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="Or any model id" hint="Any chat model served by Hugging Face Inference Providers.">
            <input value={s.hfModel} onChange={(e) => setSettings({ hfModel: e.target.value.trim() })} className={cx(inputCls, 'font-mono')} />
          </Field>
          <Field label="Provider policy" hint={effectivePlan === 'free' ? 'Cheapest stretches free credits.' : 'Fastest gives the lowest latency.'}>
            <select value={s.hfPolicy} onChange={(e) => setSettings({ hfPolicy: e.target.value })} className={inputCls}>
              <option value="">Default (HF picks)</option>
              <option value="fastest">Fastest provider</option>
              <option value="cheapest">Cheapest provider</option>
            </select>
          </Field>
        </div>
        {largeOnFree && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {info?.label || s.hfModel} is a large model: on a free account it can use up the monthly credits within a few dozen questions. Llama 3.1 8B or Qwen 2.5 7B are recommended.
          </p>
        )}
        {!info && s.hfModel && <p className="mt-1 text-xs text-slate-500">Custom model — if it fails with “Model not available”, it is not served by an inference provider; try appending :fastest.</p>}
      </div>

      <Field
        label={
          <span className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4" /> Bill to organisation (optional, Team / Enterprise)
          </span>
        }
        hint="Charges inference to an organisation you belong to instead of your personal credits. Leave empty to use your own account."
      >
        <div className="flex flex-wrap gap-2">
          <input value={s.hfBillTo} onChange={(e) => setSettings({ hfBillTo: e.target.value.trim() })} placeholder="organisation name" className={cx(inputCls, 'max-w-xs')} />
          {hfAccount?.orgs?.map((o) => (
            <button key={o.name} type="button" onClick={() => setSettings({ hfBillTo: o.name })} className="rounded-lg px-2 text-xs ring-1 ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800">
              {o.name}
              {o.paid ? ' · paid' : ''}
            </button>
          ))}
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon={BadgeCheck} onClick={verify} disabled={!s.hfToken || !!test?.busy}>Verify token (free)</Button>
        <Button variant="secondary" icon={FlaskConical} onClick={testModel} disabled={!s.hfToken || !!test?.busy}>Test model (1 small call)</Button>
        {test?.busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {test && !test.busy && (
          <span className={cx('flex items-start gap-1.5 text-sm', test.ok ? 'text-emerald-600' : 'text-rose-600')}>
            {test.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              {test.text}{' '}
              {test.billing && (
                <a className="underline" href={BILLING_URL} target="_blank" rel="noreferrer noopener">
                  Open billing
                </a>
              )}
            </span>
          </span>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <div className="mb-2 text-sm font-medium">Usage</div>
        <UsageMeter />
      </div>
    </div>
  );
}
