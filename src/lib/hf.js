// Hugging Face account helpers: plan detection (free vs PRO), plan-aware defaults,
// a model catalogue with cost guidance, friendly error messages and call estimates.

export const ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
export const BILLING_URL = 'https://huggingface.co/settings/billing';
export const TOKENS_URL = 'https://huggingface.co/settings/tokens';

/**
 * Validate a token and detect the plan with the free whoami endpoint (no inference credits used).
 * Returns { ok, name, plan: 'pro'|'free', orgs, inferencePermission, error }.
 */
export async function whoami(token, signal) {
  const t = (token || '').trim();
  if (!t) return { ok: false, error: 'No token entered.' };
  try {
    const res = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${t}` }, signal });
    if (res.status === 401) return { ok: false, error: 'Hugging Face rejected this token (invalid, revoked or mistyped).' };
    if (!res.ok) return { ok: false, error: `Could not verify the token (HTTP ${res.status}).`, unverified: true };
    const j = await res.json();
    return { ok: true, ...describeAccount(j) };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { ok: false, unverified: true, error: 'Could not reach huggingface.co to verify the token (network or browser blocking). Choose your plan manually.' };
  }
}

/** Pure part of whoami, testable without the network. */
export function describeAccount(j) {
  const auth = j.auth?.accessToken || {};
  const role = auth.role || 'unknown';
  // Fine-grained tokens list their permissions; classic read/write tokens can call inference.
  const inferencePermission = role === 'fineGrained' ? /inference/i.test(JSON.stringify(auth.fineGrained || {})) : true;
  const orgs = (j.orgs || []).map((o) => ({ name: o.name, paid: !!(o.isEnterprise || (o.plan && o.plan !== 'free')) }));
  return { name: j.name, plan: j.isPro ? 'pro' : 'free', orgs, tokenRole: role, tokenName: auth.displayName, inferencePermission };
}

export const HF_MODELS = [
  { id: 'meta-llama/Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B Instruct', size: '8B', plans: ['free', 'pro'], tags: ['recommended'], why: 'Reliable, widely served, low cost per answer. Best default on the free plan.' },
  { id: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen 2.5 7B Instruct', size: '7B', plans: ['free', 'pro'], tags: ['fastest'], why: 'Ungated (no licence to accept), fast and cheap; strong at following citation rules.' },
  { id: 'mistralai/Mistral-7B-Instruct-v0.2', label: 'Mistral 7B Instruct v0.2', size: '7B', plans: ['free', 'pro'], tags: [], why: 'The model used in the Colab notebook. Provider availability varies.' },
  { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct', size: '70B', plans: ['pro'], tags: ['quality'], why: 'Much better reasoning and judging; ~5–10× the cost per call. Best with PRO credits.' },
  { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B Instruct', size: '72B', plans: ['pro'], tags: ['quality'], why: 'Top open model for long, structured answers; high credit use.' },
];

export const modelInfo = (id) => HF_MODELS.find((m) => m.id === String(id).split(':')[0]);
export const isLargeModel = (id) => /(?:^|[^\d])(?:[3-9]\d|\d{3})b/i.test(String(id));

/** Settings that fit each plan. Free: few, cheap calls. PRO: bigger model, stricter evaluation. */
export const PLAN_DEFAULTS = {
  free: {
    label: 'Free',
    summary: '8B model, one combined judge call, no automatic extra calls — about 2 LLM calls per question (3 for follow-ups).',
    values: { hfModel: 'meta-llama/Llama-3.1-8B-Instruct', judgeMode: 'combined', corrective: false, hyde: false, condense: true, maxTokens: 512, aiSuggestions: false },
  },
  pro: {
    label: 'PRO',
    summary: '70B model, strict two-call judge, corrective retry and AI-written suggestions — best quality, about 3 LLM calls per question (up to 7 when a retry is needed).',
    values: { hfModel: 'meta-llama/Llama-3.3-70B-Instruct', judgeMode: 'strict', corrective: true, hyde: false, condense: true, maxTokens: 768, aiSuggestions: true },
  },
};

/** Expected LLM calls for one question with the given settings (corrective retry counted as possible extra). */
export function callsPerQuestion(s, { followUp = false, vanilla = false } = {}) {
  if (s.provider === 'extractive') return { base: 0, worst: 0 };
  const judge = s.judgeMode === 'strict' ? 2 : s.judgeMode === 'combined' ? 1 : 0;
  const base = 1 + judge + (!vanilla && s.hyde ? 1 : 0) + (followUp && s.condense ? 1 : 0);
  const worst = base + (!vanilla && s.corrective ? 2 + judge : 0);
  return { base, worst };
}

/** LLM calls an Evaluation Lab run will make. */
export function estimateLabCalls(settings, configs, questions, retrievalOnly) {
  if (retrievalOnly || settings.provider === 'extractive') return 0;
  return configs.reduce((sum, c) => {
    const s = { ...settings, ...c.cfg, corrective: false };
    return sum + questions * callsPerQuestion(s, { vanilla: c.cfg.vanilla }).base;
  }, 0);
}

/** Map HTTP failures from the router to an actionable message. */
export function friendlyError(status, detail = '', { model = '', provider = 'hf' } = {}) {
  const d = String(detail || '');
  const hf = provider === 'hf';
  if (status === 401) return { title: 'Token rejected', hint: hf ? 'Check that the whole token was pasted (it starts with hf_) and that it has not been revoked.' : 'Check the API key for this endpoint.' };
  if (status === 402 || /credit|quota|payment|billing|exceeded your monthly/i.test(d))
    return {
      title: 'Monthly inference credits used up',
      hint: 'Free accounts get a small monthly allowance and PRO accounts more. Wait for the monthly reset, upgrade to PRO or add billing on Hugging Face — or switch to Extractive, Ollama or the in-browser model, which are unlimited and free. Turning the judge off halves usage.',
      billing: true,
    };
  if (status === 403)
    return {
      title: 'Not allowed',
      hint: /gated|license|access to model|restricted/i.test(d)
        ? `“${model}” is a gated model: open its page on huggingface.co and accept the licence, or choose an ungated model such as Qwen/Qwen2.5-7B-Instruct.`
        : 'The token is missing the permission “Make calls to Inference Providers”. Edit it at huggingface.co/settings/tokens (fine-grained → Inference).',
    };
  if (status === 404 || (status === 400 && /model|not supported|not found|does not exist/i.test(d)))
    return { title: 'Model not available', hint: `“${model}” is not served by any inference provider for your account right now. Pick another model in Settings, or append :fastest to let Hugging Face choose a provider.` };
  if (status === 429) return { title: 'Rate limited', hint: 'Too many requests in a short time (free accounts have lower limits). Wait a minute, or reduce parallel calls: turn off “RAG vs vanilla” and use the combined judge.' };
  if (status >= 500) return { title: 'Provider temporarily unavailable', hint: 'The inference provider is overloaded or down. Try again shortly, or append :fastest to the model name to route to another provider.' };
  if (status === 400 && /context|too long|maximum.*tokens|max_tokens/i.test(d)) return { title: 'Prompt too long for this model', hint: 'Lower k, turn off neighbour expansion, or reduce max answer tokens.' };
  return { title: `Request failed (HTTP ${status})`, hint: d.slice(0, 240) };
}
