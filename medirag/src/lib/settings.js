import { DEFAULT_QNA_SYSTEM } from './prompts.js';

// Defaults follow the notebook's recommended operating point (C1: similarity, k=3,
// temperature 0, max_tokens 512) with hybrid retrieval on top.
export const DEFAULT_SETTINGS = {
  provider: 'extractive',
  hfToken: '',
  hfModel: 'meta-llama/Llama-3.1-8B-Instruct',
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiKey: '',
  openaiModel: 'mistral:7b-instruct',
  browserModel: 'onnx-community/Qwen2.5-0.5B-Instruct',
  maxTokens: 512,
  temperature: 0,
  topP: 0.95,
  retrievalMode: 'hybrid',
  k: 3,
  fetchK: 20,
  mmrLambda: 0.5,
  judgeEnabled: true,
  judgeMaxTokens: 200,
  corrective: false,
  embedModel: 'Xenova/gte-small',
  chunkSize: 400,
  chunkOverlap: 50,
  systemPrompt: DEFAULT_QNA_SYSTEM,
  theme: 'system',
};

const KEY = 'medirag.settings.v1';

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) – settings stay in memory */
  }
}

// Evaluation Lab configurations – mirror the notebook's C1–C5 plus vanilla and hybrid variants.
export const BENCH_CONFIGS = [
  { id: 'V', name: 'Vanilla LLM (no retrieval)', cfg: { vanilla: true, maxTokens: 256 }, needsLLM: true },
  { id: 'C1', name: 'Baseline similarity k=3', cfg: { mode: 'semantic', k: 3, temperature: 0 } },
  { id: 'C2', name: 'Higher recall k=5', cfg: { mode: 'semantic', k: 5, temperature: 0 } },
  { id: 'C3', name: 'Strict precision k=2', cfg: { mode: 'semantic', k: 2, temperature: 0 } },
  { id: 'C4', name: 'MMR diverse k=4', cfg: { mode: 'mmr', k: 4, temperature: 0 } },
  { id: 'C5', name: 'Creative sampling temp=0.7', cfg: { mode: 'semantic', k: 3, temperature: 0.7 }, needsLLM: true },
  { id: 'H3', name: 'Hybrid BM25+semantic k=3', cfg: { mode: 'hybrid', k: 3, temperature: 0 } },
  { id: 'B3', name: 'BM25 keyword k=3', cfg: { mode: 'bm25', k: 3, temperature: 0 } },
];
