// Load the retrieval / evaluation engine of an app tree (its own src/lib), so the same harness code
// measures the baseline and the new version.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadEngine(tree) {
  const lib = (f) => import(pathToFileURL(join(tree, 'src', 'lib', f)).href);
  const [text, chunk, clean, bm25, quant, retrieve, evaluate, llm, pipeline, settings, workers, loaders] = await Promise.all(
    ['text.js', 'chunk.js', 'clean.js', 'bm25.js', 'quant.js', 'retrieve.js', 'evaluate.js', 'llm.js', 'pipeline.js', 'settings.js', 'workers.js', 'loaders/text.js'].map(lib)
  );
  return { text, chunk, clean, bm25, quant, retrieve, evaluate, llm, pipeline, settings, workers, loaders };
}

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}
