// Promise-based clients for the Web Workers, plus the model catalogues shown in Settings
// (each with the trade-off hints the UI displays: speed, size, quality).

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
      if (msg.type === 'progress' || msg.type === 'ready') return listeners.forEach((l) => l(msg));
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'token' || msg.type === 'stage') return p.onEvent?.(msg);
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
    call(payload, onEvent) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onEvent });
        get().postMessage({ ...payload, id });
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

export const embedClient = makeClient(() => new Worker(new URL('../workers/embed.worker.js', import.meta.url), { type: 'module' }));
export const genClient = makeClient(() => new Worker(new URL('../workers/gen.worker.js', import.meta.url), { type: 'module' }));
export const ingestClient = makeClient(() => new Worker(new URL('../workers/ingest.worker.js', import.meta.url), { type: 'module' }));
export const rerankClient = makeClient(() => new Worker(new URL('../workers/rerank.worker.js', import.meta.url), { type: 'module' }));

export const EMBED_MODELS = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    dim: 384,
    label: 'all-MiniLM-L6-v2',
    size: '23 MB',
    tags: ['fastest', 'lightest'],
    why: 'About 2× faster to embed than the others; slightly weaker on technical wording.',
    queryPrefix: '',
  },
  {
    id: 'Xenova/gte-small',
    dim: 384,
    label: 'gte-small',
    size: '34 MB',
    tags: ['recommended'],
    why: 'Same family as the notebook’s gte-large: the best balance of speed and accuracy.',
    queryPrefix: '',
  },
  {
    id: 'Xenova/bge-small-en-v1.5',
    dim: 384,
    label: 'bge-small-en-v1.5',
    size: '34 MB',
    tags: ['quality'],
    why: 'Strongest retrieval scores of the three on MTEB; uses a query instruction prefix.',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
  },
];

export const RERANK_MODEL = { id: 'Xenova/ms-marco-MiniLM-L-6-v2', size: '23 MB' };

export function embedModelInfo(id) {
  return EMBED_MODELS.find((m) => m.id === id) || { id, dim: null, label: id, queryPrefix: '', tags: [] };
}

export async function embedTexts(model, texts) {
  const res = await embedClient.call({ type: 'embed', model, texts });
  return { dim: res.dim, data: res.data };
}

const queryCache = new Map();
/** Query embeddings are cached (LRU 64), so re-asking or benchmarking costs nothing. */
export async function embedQuery(model, text) {
  const key = `${model}\u0000${text}`;
  if (queryCache.has(key)) return queryCache.get(key);
  const { data } = await embedTexts(model, [embedModelInfo(model).queryPrefix + text]);
  queryCache.set(key, data);
  if (queryCache.size > 64) queryCache.delete(queryCache.keys().next().value);
  return data;
}

export async function rerank(query, passages) {
  const res = await rerankClient.call({ model: RERANK_MODEL.id, query, passages });
  return res.scores;
}

export async function browserGenerate(model, { messages, maxTokens, temperature, topP, onToken, signal }) {
  const onAbort = () => genClient.terminate();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await genClient.call({ type: 'generate', model, messages, maxTokens, temperature, topP }, (m) => onToken?.(m.text));
    return res.result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export function ingestInWorker(payload, onStage) {
  return ingestClient.call({ type: 'ingest', ...payload }, onStage).then((r) => r.result);
}

export function bm25InWorker(chunks) {
  return ingestClient.call({ type: 'bm25', chunks }).then((r) => r.result);
}
