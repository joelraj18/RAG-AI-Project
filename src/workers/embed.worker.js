import { pipeline } from '@huggingface/transformers';
import { runtime } from './runtime.js';
import { loadOnce } from './once.js';

// Sentence-embedding worker (transformers.js). Models are downloaded once from the
// Hugging Face Hub and cached by the browser, so later visits work offline.

const load = loadOnce(async (model) => {
  const rt = await runtime();
  const dtype = rt.device === 'webgpu' ? 'fp32' : 'q8';
  const extractor = await pipeline('feature-extraction', model, {
    device: rt.device,
    dtype,
    progress_callback: (p) => self.postMessage({ type: 'progress', progress: p }),
  });
  self.postMessage({ type: 'ready', ...rt, dtype });
  return extractor;
});

self.onmessage = async (e) => {
  const { id, type, model, texts } = e.data;
  try {
    if (type === 'load') {
      await load(model);
      self.postMessage({ id, type: 'done' });
    } else if (type === 'embed') {
      const extractor = await load(model);
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
      self.postMessage({ id, type: 'done', dim: out.dims[out.dims.length - 1], data }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
