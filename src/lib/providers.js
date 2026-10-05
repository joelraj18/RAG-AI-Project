// Every language model the app can use, in one registry.
//
// group  'free' needs no paid account, 'key' needs your own API key from that company
// data   'device' nothing leaves this device, 'cloud' the question and retrieved excerpts are sent
//        to that company, 'depends' the custom endpoint decides (local URL = device)
// kind   'openai' = OpenAI-compatible chat completions, 'anthropic' = official Anthropic SDK

export const PROVIDERS = {
  extractive: {
    label: 'Extractive (no LLM)',
    group: 'free',
    data: 'device',
    tags: ['fastest', 'lightest', 'private'],
    cost: 'instant · no setup',
    why: 'Quotes the most relevant sentences with citations. Always grounded, but no synthesis and no LLM judge.',
  },
  browser: {
    label: 'In-browser model',
    group: 'free',
    data: 'device',
    tags: ['private'],
    cost: '0.4 to 1.1 GB download once · slow without WebGPU',
    why: 'Runs on this device. Small models (0.5B to 1.7B) give shorter, simpler answers.',
  },
  hf: {
    label: 'Hugging Face Inference',
    group: 'free',
    data: 'cloud',
    company: 'Hugging Face',
    host: 'router.huggingface.co',
    policyUrl: 'https://huggingface.co/privacy',
    tags: ['recommended', 'quality'],
    cost: 'free token · about 2 to 8 s per answer',
    why: 'Best free quality: 8B to 70B open models on Hugging Face servers, plus the LLM judge.',
  },
  custom: {
    label: 'Local or custom endpoint',
    group: 'free',
    data: 'depends',
    tags: ['private'],
    cost: 'your own GPU · Ollama, LM Studio, vLLM',
    why: 'Any OpenAI-compatible server. Ollama on localhost keeps everything on this machine.',
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    group: 'key',
    kind: 'anthropic',
    data: 'cloud',
    company: 'Anthropic',
    host: 'api.anthropic.com',
    keyPrefix: 'sk-ant-',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    policyUrl: 'https://www.anthropic.com/legal/privacy',
    defaultModel: 'claude-opus-5-5',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'most capable · $4 in / $20 out per million tokens' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'balanced · $2 / $10 per million tokens' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'fastest, cheapest · $1 / $5 per million tokens' },
    ],
    tags: ['quality'],
    cost: 'paid per token · your Anthropic key',
    why: 'Excellent at following citation rules and long, careful answers. Uses the official Anthropic SDK.',
  },
  deepseek: {
    label: 'DeepSeek',
    group: 'key',
    kind: 'openai',
    data: 'cloud',
    company: 'DeepSeek',
    host: 'api.deepseek.com',
    baseUrl: 'https://api.deepseek.com/v1',
    keyPrefix: 'sk-',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    policyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', note: 'fast general model' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', note: 'thinks first, slower' },
    ],
    tags: ['lightest'],
    cost: 'paid per token · very low price',
    why: 'Strong answers at a very low price per token.',
  },
  openai: {
    label: 'OpenAI',
    group: 'key',
    kind: 'openai',
    data: 'cloud',
    company: 'OpenAI',
    host: 'api.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    keyPrefix: 'sk-',
    keysUrl: 'https://platform.openai.com/api-keys',
    policyUrl: 'https://openai.com/policies/privacy-policy',
    defaultModel: 'gpt-4o-mini',
    tags: [],
    cost: 'paid per token · your OpenAI key',
    why: 'GPT models. Use Load models to pick from the models your key can use.',
  },
  gemini: {
    label: 'Google Gemini',
    group: 'key',
    kind: 'openai',
    data: 'cloud',
    company: 'Google',
    host: 'generativelanguage.googleapis.com',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPrefix: 'AI',
    keysUrl: 'https://aistudio.google.com/apikey',
    policyUrl: 'https://ai.google.dev/gemini-api/terms',
    defaultModel: 'gemini-2.5-flash',
    tags: [],
    cost: 'free tier with limits · paid tier',
    why: 'Gemini models with a free tier. Free tier prompts may be used by Google to improve products.',
  },
  groq: {
    label: 'Groq',
    group: 'key',
    kind: 'openai',
    data: 'cloud',
    company: 'Groq',
    host: 'api.groq.com',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPrefix: 'gsk_',
    keysUrl: 'https://console.groq.com/keys',
    policyUrl: 'https://groq.com/privacy-policy',
    defaultModel: 'llama-3.3-70b-versatile',
    tags: ['fastest'],
    cost: 'free tier with limits · paid tier',
    why: 'Very fast open models (Llama, Qwen) on custom hardware.',
  },
  mistral: {
    label: 'Mistral',
    group: 'key',
    kind: 'openai',
    data: 'cloud',
    company: 'Mistral AI',
    host: 'api.mistral.ai',
    baseUrl: 'https://api.mistral.ai/v1',
    keysUrl: 'https://console.mistral.ai/api-keys',
    policyUrl: 'https://mistral.ai/terms',
    defaultModel: 'mistral-small-latest',
    tags: [],
    cost: 'free experiment plan · paid plans',
    why: 'Mistral models from the company behind the model used in the original notebook.',
  },
  openrouter: {
    label: 'OpenRouter',
    group: 'key',
    kind: 'openai',
    data: 'cloud',
    company: 'OpenRouter',
    host: 'openrouter.ai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPrefix: 'sk-or-',
    keysUrl: 'https://openrouter.ai/keys',
    policyUrl: 'https://openrouter.ai/privacy',
    defaultModel: 'deepseek/deepseek-chat',
    tags: [],
    cost: 'one key for hundreds of models',
    why: 'One key for Claude, DeepSeek, Gemini, Llama and more. OpenRouter passes your prompt on to the model host it routes to. Works from the browser when a provider blocks direct calls.',
  },
};

export const KEY_PROVIDERS = Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].group === 'key');

/** True for localhost, 127.x and ::1 URLs: requests to them never leave this machine. */
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || /^127\./.test(h) || h.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Where the question and excerpts go with these settings: 'device' or 'cloud'. */
export function dataClass(s) {
  const p = PROVIDERS[s.provider];
  if (!p) return 'device';
  if (p.data === 'depends') return isLocalUrl(s.openaiBaseUrl) ? 'device' : 'cloud';
  return p.data;
}

/** Host that receives prompts, or null when everything stays on the device. */
export function dataHost(s) {
  if (dataClass(s) === 'device') return null;
  const p = PROVIDERS[s.provider];
  if (p.host) return p.host;
  try {
    return new URL(s.openaiBaseUrl).host;
  } catch {
    return s.openaiBaseUrl;
  }
}

/** Human name of whoever receives prompts. */
export function dataRecipient(s) {
  const p = PROVIDERS[s.provider];
  return p?.company || dataHost(s) || 'nobody';
}

export const apiKeyOf = (s, id = s.provider) => (s.apiKeys?.[id] || '').trim();

/** The model id that will be used for a key provider. */
export const keyModelOf = (s, id = s.provider) => (s.apiModels?.[id] || '').trim() || PROVIDERS[id]?.defaultModel || '';

/** Whether an LLM is configured and ready to call (no missing token or key). */
export function llmReady(s) {
  const p = PROVIDERS[s.provider];
  if (!p || s.provider === 'extractive') return false;
  if (s.provider === 'hf') return !!s.hfToken;
  if (p.group === 'key') return !!apiKeyOf(s);
  return true;
}

/** Soft warning when a pasted key does not look like this provider's keys. */
export function keyWarning(id, key) {
  const p = PROVIDERS[id];
  if (!key || !p) return '';
  if (id !== 'anthropic' && key.startsWith('sk-ant-')) return 'This looks like an Anthropic key. Choose Claude instead.';
  if (id !== 'openrouter' && key.startsWith('sk-or-')) return 'This looks like an OpenRouter key. Choose OpenRouter instead.';
  if (id !== 'hf' && key.startsWith('hf_')) return 'This looks like a Hugging Face token. Choose Hugging Face Inference instead.';
  if (!p.keyPrefix || key.startsWith(p.keyPrefix)) return '';
  return `${p.label} keys usually start with ${p.keyPrefix}. Check that the whole key was pasted.`;
}
