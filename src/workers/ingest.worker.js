import { cleanPages } from '../lib/clean.js';
import { chunkPages, describeChunks } from '../lib/chunk.js';
import { buildBM25 } from '../lib/bm25.js';

// CPU-heavy ingestion steps run here so the UI stays responsive on 4,000-page documents.

function timed(fn) {
  const t0 = performance.now();
  const out = fn();
  return [out, performance.now() - t0];
}

self.onmessage = (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'ingest') {
      const { pages, chunkSize, chunkOverlap } = e.data;
      const [cleaned, cleanMs] = timed(() => cleanPages(pages));
      self.postMessage({ id, type: 'stage', stage: 'clean', ms: cleanMs });
      const [chunks, chunkMs] = timed(() => chunkPages(cleaned.pages, { chunkSize, chunkOverlap }));
      self.postMessage({ id, type: 'stage', stage: 'chunk', ms: chunkMs });
      const [bm25, indexMs] = timed(() => buildBM25(chunks));
      self.postMessage({
        id,
        type: 'done',
        result: { stats: cleaned.stats, chunks: [...chunks], chunkStats: describeChunks(chunks), bm25, timings: { clean: cleanMs, chunk: chunkMs, index: indexMs } },
      });
    } else if (type === 'bm25') {
      const [bm25, ms] = timed(() => buildBM25(e.data.chunks));
      self.postMessage({ id, type: 'done', result: { bm25, ms } });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.message || err) });
  }
};
