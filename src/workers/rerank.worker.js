import { AutoTokenizer, AutoModelForSequenceClassification, env } from '@huggingface/transformers';

// Cross-encoder reranker: scores (query, passage) pairs jointly, which is more accurate
// than comparing separately computed embeddings. Used on the top candidates only.
env.allowLocalModels = false;

let tokenizer = null;
let model = null;
let loaded = null;

async function load(name) {
  if (model && loaded === name) return;
  const gpu = 'gpu' in navigator && (await navigator.gpu.requestAdapter().catch(() => null));
  const device = gpu ? 'webgpu' : 'wasm';
  const progress_callback = (p) => self.postMessage({ type: 'progress', progress: p });
  tokenizer = await AutoTokenizer.from_pretrained(name, { progress_callback });
  model = await AutoModelForSequenceClassification.from_pretrained(name, { device, dtype: device === 'webgpu' ? 'fp32' : 'q8', progress_callback });
  loaded = name;
  self.postMessage({ type: 'ready', device });
}

self.onmessage = async (e) => {
  const { id, model: name, query, passages } = e.data;
  try {
    await load(name);
    const inputs = tokenizer(new Array(passages.length).fill(query), { text_pair: passages, padding: true, truncation: true });
    const { logits } = await model(inputs);
    const raw = Array.from(logits.data);
    const scores = raw.map((x) => 1 / (1 + Math.exp(-x)));
    self.postMessage({ id, type: 'done', scores });
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
