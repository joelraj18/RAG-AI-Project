// A stand-in for the browser's Worker so the tree's own src/lib/workers.js runs unmodified in Node.
// Messages that would go to the embed and rerank workers are answered by the Provider (cache first,
// then a verified native copy or the tree's real browser worker).

export function installWorkerShim(provider) {
  globalThis.Worker = class BenchWorker {
    constructor(url) {
      const u = String(url);
      this.kind = /embed\.worker/.test(u) ? 'embed' : /rerank\.worker/.test(u) ? 'rerank' : /gen\.worker/.test(u) ? 'gen' : /ingest\.worker/.test(u) ? 'ingest' : 'other';
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage(msg) {
      const reply = (data) => queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ...data } }));
      (async () => {
        if (this.kind === 'embed') {
          if (msg.type === 'load') return { type: 'done' };
          const { dim, data } = await provider.embed(msg.model, msg.texts);
          return { type: 'done', dim, data };
        }
        if (this.kind === 'rerank') return { type: 'done', scores: await provider.rerank(msg.model, msg.query, msg.passages) };
        throw new Error(`The ${this.kind} worker is not available in the Node benchmark`);
      })().then(reply, (e) => reply({ type: 'error', error: String(e?.message || e) }));
    }

    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  };
}
