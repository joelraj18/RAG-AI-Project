// Thin promise-based clients for the two transformers.js workers.

function makeClient(factory) {
  let worker = null;
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  function get() {
    if (worker) return worker;
    worker = factory();
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress' || msg.type === 'ready') {
        listeners.forEach((l) => l(msg));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'token') return p.onToken?.(msg.text);
      pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.error));
      else p.resolve(msg);
    };
    worker.onerror = (e) => {
      pending.forEach((p) => p.reject(new Error(e.message || 'Worker error')));
      pending.clear();
    };
    return worker;
  }
  return {
    call(payload, onToken, transfer) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onToken });
        get().postMessage({ ...payload, id }, transfer || []);
      });
    },
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    terminate() {
      worker?.terminate();
      worker = null;
      pending.forEach((p) => p.reject(new Error('cancelled')));
      pending.clear();
    },
  };
}

export const embedClient = makeClient(
  () => new Worker(new URL('../workers/embed.worker.js', import.meta.url), { type: 'module' })
);
export const genClient = makeClient(
  () => new Worker(new URL('../workers/gen.worker.js', import.meta.url), { type: 'module' })
);

export const EMBED_MODELS = [
  { id: 'Xenova/gte-small', dim: 384, label: 'gte-small (same family as notebook gte-large)', queryPrefix: '' },
  { id: 'Xenova/bge-small-en-v1.5', dim: 384, label: 'bge-small-en-v1.5', queryPrefix: 'Represent this sentence for searching relevant passages: ' },
  { id: 'Xenova/all-MiniLM-L6-v2', dim: 384, label: 'all-MiniLM-L6-v2 (fastest)', queryPrefix: '' },
];

export function embedModelInfo(id) {
  return EMBED_MODELS.find((m) => m.id === id) || { id, dim: null, label: id, queryPrefix: '' };
}

export async function embedTexts(model, texts) {
  const res = await embedClient.call({ type: 'embed', model, texts });
  return { dim: res.dim, data: res.data };
}

export async function embedQuery(model, text) {
  const { data } = await embedTexts(model, [embedModelInfo(model).queryPrefix + text]);
  return data;
}

export async function browserGenerate(model, { messages, maxTokens, temperature, topP, onToken, signal }) {
  const onAbort = () => genClient.terminate();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await genClient.call({ type: 'generate', model, messages, maxTokens, temperature, topP }, onToken);
    return res.result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
