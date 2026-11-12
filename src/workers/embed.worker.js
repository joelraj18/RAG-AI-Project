import { pipeline } from '@huggingface/transformers';
import { runtime } from './runtime.js';

// Sentence-embedding worker (transformers.js). Models are downloaded once from the
// Hugging Face Hub and cached by the browser, so later visits work offline.

let extractor = null;
let loaded = null;

async function load(model) {
  if (extractor && loaded === model) return;
  const rt = await runtime();
  const device = rt.device;
  extractor = await pipeline('feature-extraction', model, {
    device,
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: (p) => self.postMessage({ type: 'progress', progress: p }),
  });
  loaded = model;
  self.postMessage({ type: 'ready', ...rt, dtype: device === 'webgpu' ? 'fp32' : 'q8' });
}

self.onmessage = async (e) => {
  const { id, type, model, texts } = e.data;
  try {
    if (type === 'load') {
      await load(model);
      self.postMessage({ id, type: 'done' });
    } else if (type === 'embed') {
      await load(model);
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
      self.postMessage({ id, type: 'done', dim: out.dims[out.dims.length - 1], data }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
