// Defaults follow the notebook's best operating point (k=3–4, temperature 0, max 512 tokens)
// with hybrid retrieval on top. Quick profiles set the speed/quality trade-offs in one click.

export const DEFAULT_SETTINGS = {
  preset: 'general',
  profile: 'balanced',
  provider: 'extractive',
  hfToken: '',
  hfModel: 'meta-llama/Llama-3.1-8B-Instruct',
  hfPlan: 'auto', // 'auto' (detected from the token) | 'free' | 'pro'
  hfPolicy: '', // '' (HF default) | 'fastest' | 'cheapest'
  hfBillTo: '', // optional organisation to bill (PRO / Team / Enterprise)
  aiSuggestions: false, // LLM-written starter questions cost one call per document
  // "custom" provider: any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM)
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiKey: '',
  openaiModel: 'mistral:7b-instruct',
  apiKeys: {}, // { anthropic, deepseek, openai, gemini, groq, mistral, openrouter }: memory only
  apiModels: {}, // chosen model per key provider (saved; not secret)
  claudeEffort: 'medium', // Claude 5.x thinking effort: low | medium | high
  confidential: false, // block every provider that would send text off this device
  browserModel: 'onnx-community/Qwen2.5-0.5B-Instruct',
  maxTokens: 512,
  temperature: 0,
  topP: 0.95,
  contextWindow: 8192,
  retrievalMode: 'hybrid',
  k: 4,
  fetchK: 20,
  mmrLambda: 0.5,
  rerank: false,
  neighbors: false,
  contextBudget: 1800,
  hyde: false,
  condense: true,
  judgeMode: 'combined',
  judgeMaxTokens: 220,
  corrective: false,
  embedModel: 'Xenova/gte-small',
  chunkSize: 400,
  chunkOverlap: 50,
  customPrompt: '',
  theme: 'system',
};

export const PROFILES = {
  fast: {
    label: 'Fast',
    tags: ['fastest', 'lightest'],
    why: 'Lowest latency and smallest downloads. Good for quick look-ups.',
    values: { retrievalMode: 'hybrid', k: 3, rerank: false, neighbors: false, hyde: false, condense: false, judgeMode: 'combined', corrective: false, embedModel: 'Xenova/all-MiniLM-L6-v2', maxTokens: 384 },
  },
  balanced: {
    label: 'Balanced',
    tags: ['recommended'],
    why: 'Hybrid search, one combined judge call and follow-up rewriting. The best default.',
    values: { retrievalMode: 'hybrid', k: 4, rerank: false, neighbors: false, hyde: false, condense: true, judgeMode: 'combined', corrective: false, embedModel: 'Xenova/gte-small', maxTokens: 512 },
  },
  quality: {
    label: 'Best quality',
    tags: ['quality'],
    why: 'Cross-encoder reranking, neighbour context, strict two-call judge and a corrective retry. Slower, most accurate.',
    values: { retrievalMode: 'hybrid', k: 5, rerank: true, neighbors: true, hyde: false, condense: true, judgeMode: 'strict', corrective: true, embedModel: 'Xenova/bge-small-en-v1.5', maxTokens: 768 },
  },
};

/** Which profile (if any) the current settings match exactly. */
export function matchProfile(s) {
  return Object.entries(PROFILES).find(([, p]) => Object.entries(p.values).every(([k, v]) => s[k] === v))?.[0] || 'custom';
}

const KEY = 'rag-ai-studio.settings.v1';

// API keys and tokens live ONLY in this tab's memory. They are never written to
// localStorage, IndexedDB, cookies, exports or URLs, and disappear on reload / tab close.
export const SECRET_KEYS = ['hfToken', 'openaiKey', 'apiKeys'];

/** The settings object that may be written to disk: everything except secrets. */
export function persistable(s) {
  const out = { ...s };
  for (const k of SECRET_KEYS) delete out[k];
  return out;
}

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    // purge secrets that older versions of the app may have saved
    if (SECRET_KEYS.some((k) => k in stored)) localStorage.setItem(KEY, JSON.stringify(persistable(stored)));
    const s = { ...DEFAULT_SETTINGS, ...persistable(stored) };
    // older versions called the custom OpenAI-compatible endpoint "openai"
    if (s.provider === 'openai' && !('apiModels' in stored)) s.provider = 'custom';
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(persistable(s)));
  } catch {
    /* storage unavailable (private mode), settings stay in memory */
  }
}

// Evaluation Lab configurations: the notebook's C1–C5 and vanilla, plus hybrid/rerank variants.
export const BENCH_CONFIGS = [
  { id: 'V', name: 'Vanilla LLM (no retrieval)', cfg: { vanilla: true, maxTokens: 256 }, needsLLM: true },
  { id: 'C1', name: 'Similarity k=3 (notebook baseline)', cfg: { mode: 'semantic', k: 3, temperature: 0, rerank: false, neighbors: false } },
  { id: 'C2', name: 'Similarity k=5 (higher recall)', cfg: { mode: 'semantic', k: 5, temperature: 0, rerank: false, neighbors: false } },
  { id: 'C3', name: 'Similarity k=2 (strict precision)', cfg: { mode: 'semantic', k: 2, temperature: 0, rerank: false, neighbors: false } },
  { id: 'C4', name: 'MMR k=4 (diverse)', cfg: { mode: 'mmr', k: 4, temperature: 0, rerank: false, neighbors: false } },
  { id: 'C5', name: 'Similarity k=3, temperature 0.7', cfg: { mode: 'semantic', k: 3, temperature: 0.7, rerank: false, neighbors: false }, needsLLM: true },
  { id: 'H4', name: 'Hybrid k=4 (app default)', cfg: { mode: 'hybrid', k: 4, temperature: 0, rerank: false, neighbors: false } },
  { id: 'R4', name: 'Hybrid + rerank k=4', cfg: { mode: 'hybrid', k: 4, temperature: 0, rerank: true, neighbors: false } },
  { id: 'B3', name: 'BM25 keyword k=3', cfg: { mode: 'bm25', k: 3, temperature: 0, rerank: false, neighbors: false } },
];
