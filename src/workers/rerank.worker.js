import { AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';
import { runtime } from './runtime.js';
import { loadOnce } from './once.js';

// Cross-encoder reranker: scores (query, passage) pairs jointly, which is more accurate
// than comparing separately computed embeddings. Used on the top candidates only.

const load = loadOnce(async (name) => {
  const rt = await runtime();
  const dtype = rt.device === 'webgpu' ? 'fp32' : 'q8';
  const progress_callback = (p) => self.postMessage({ type: 'progress', progress: p });
  const tokenizer = await AutoTokenizer.from_pretrained(name, { progress_callback });
  const model = await AutoModelForSequenceClassification.from_pretrained(name, { device: rt.device, dtype, progress_callback });
  self.postMessage({ type: 'ready', ...rt, dtype });
  return { tokenizer, model };
});

self.onmessage = async (e) => {
  const { id, model: name, query, passages, maxLength } = e.data;
  try {
    const { tokenizer, model } = await load(name);
    const inputs = tokenizer(new Array(passages.length).fill(query), { text_pair: passages, padding: true, truncation: true, ...(maxLength ? { max_length: maxLength } : {}) });
    const { logits } = await model(inputs);
    const raw = Array.from(logits.data);
    const scores = raw.map((x) => 1 / (1 + Math.exp(-x)));
    self.postMessage({ id, type: 'done', scores });
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
