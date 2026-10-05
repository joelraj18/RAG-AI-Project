import { db } from './db.js';
import { cleanPages } from './clean.js';
import { chunkPages, describeChunks } from './chunk.js';
import { buildBM25 } from './bm25.js';
import { embedTexts, embedClient } from './workers.js';
import { uid, yieldToUI } from './text.js';

// Knowledge-base lifecycle: ingest (load -> clean -> chunk -> BM25) and a resumable
// background job that embeds every chunk and persists the vectors to IndexedDB.

const cache = new Map(); // manualId -> { chunks, bm25, vectors }

export async function ingestFile(file, { chunkSize, chunkOverlap, embedModel }, onStage) {
  const timings = {};
  const stage = async (name, fn) => {
    onStage?.({ stage: name, status: 'running' });
    const t0 = performance.now();
    const out = await fn();
    timings[name] = performance.now() - t0;
    onStage?.({ stage: name, status: 'done', ms: timings[name] });
    await yieldToUI();
    return out;
  };

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const { extractPdfPages, extractTextPages } = await import('./pdf.js');
  const { pages, title } = await stage('load', () =>
    isPdf
      ? extractPdfPages(file, (i, n) => onStage?.({ stage: 'load', status: 'running', progress: i / n, detail: `${i} / ${n} pages` }))
      : extractTextPages(file)
  );
  if (!pages.length) throw new Error('No text could be extracted. Scanned (image-only) PDFs need OCR first.');
  const cleaned = await stage('clean', () => cleanPages(pages));
  const chunks = await stage('chunk', () => chunkPages(cleaned.pages, { chunkSize, chunkOverlap }));
  const bm25 = await stage('index', () => buildBM25(chunks));

  const id = uid();
  const manual = {
    id,
    name: file.name.replace(/\.(pdf|txt|md)$/i, ''),
    title: title || '',
    fileName: file.name,
    size: file.size,
    isPdf,
    createdAt: Date.now(),
    pageCount: pages.length,
    clean: cleaned.stats,
    chunkStats: describeChunks(chunks),
    chunkSize,
    chunkOverlap,
    timings,
    embedModel,
    embedDone: 0,
    embedMs: 0,
  };
  await stage('store', async () => {
    await db.putFile(id, file);
    await db.putChunks(id, chunks);
    await db.putManual(manual);
  });
  manual.timings = timings;
  await db.putManual(manual);
  cache.set(id, { chunks, bm25, vectors: null });
  return manual;
}

export async function loadKnowledge(manual) {
  if (cache.has(manual.id)) return cache.get(manual.id);
  const chunks = (await db.getChunks(manual.id)) || [];
  const bm25 = buildBM25(chunks);
  const v = await db.getVectors(manual.id);
  const entry = { chunks, bm25, vectors: v && v.model === manual.embedModel ? v : null };
  cache.set(manual.id, entry);
  return entry;
}

export function forget(manualId) {
  cache.delete(manualId);
}

/** Background embedding job. Persists progress so it resumes after a reload. */
export class EmbedJob {
  constructor(manual, { batchSize = 16, onProgress, onDone, onError }) {
    Object.assign(this, { manual, batchSize, onProgress, onDone, onError });
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const m = this.manual;
    try {
      const kb = await loadKnowledge(m);
      const n = kb.chunks.length;
      let v = kb.vectors;
      let done = v ? v.count : 0;
      if (done >= n) {
        this.running = false;
        return this.onDone?.(m);
      }
      let elapsed = m.embedMs || 0;
      let lastSave = performance.now();
      while (this.running && done < n) {
        const t0 = performance.now();
        const batch = kb.chunks.slice(done, done + this.batchSize).map((c) => c.text);
        const { dim, data } = await embedTexts(m.embedModel, batch);
        if (!this.running) break;
        if (!v) {
          v = { model: m.embedModel, dim, count: 0, data: new Float32Array(n * dim) };
          kb.vectors = v;
        }
        v.data.set(data, done * dim);
        done += batch.length;
        v.count = done;
        elapsed += performance.now() - t0;
        m.embedDone = done;
        m.embedMs = elapsed;
        this.onProgress?.({ done, total: n, elapsedMs: elapsed, rate: done / (elapsed / 1000) });
        if (performance.now() - lastSave > 15000 || done >= n) {
          await db.putVectors(m.id, v);
          await db.putManual({ ...m });
          lastSave = performance.now();
        }
      }
      if (!this.running) {
        if (this.discard) return;
        if (v) await db.putVectors(m.id, v);
        await db.putManual({ ...m });
        return;
      }
      this.running = false;
      this.onDone?.(m);
    } catch (e) {
      this.running = false;
      if (!this.discard) this.onError?.(e);
    }
  }

  /** Stop after the current batch. `discard` drops unsaved vectors (used when switching model). */
  stop(discard = false) {
    this.running = false;
    this.discard = discard;
  }
}

/** Switch embedding model for a manual: drops old vectors, job restarts from 0. */
export async function resetEmbeddings(manual, model) {
  await db.deleteVectors(manual.id);
  const kb = cache.get(manual.id);
  if (kb) kb.vectors = null;
  const m = { ...manual, embedModel: model, embedDone: 0, embedMs: 0 };
  await db.putManual(m);
  embedClient.terminate();
  return m;
}

// ---------- Knowledge packs: share a processed manual (chunks + vectors) as one file ----------

function toBase64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export async function exportPack(manual) {
  const chunks = await db.getChunks(manual.id);
  const v = await db.getVectors(manual.id);
  const pack = {
    format: 'medirag-pack@1',
    manual: { ...manual, id: undefined },
    chunks,
    vectors: v ? { model: v.model, dim: v.dim, count: v.count, data: toBase64(v.data.subarray(0, v.count * v.dim)) } : null,
  };
  const stream = new Blob([JSON.stringify(pack)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function importPack(file) {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  const pack = JSON.parse(await new Response(stream).text());
  if (pack.format !== 'medirag-pack@1') throw new Error('Not a MediRAG knowledge pack.');
  const id = uid();
  const manual = { ...pack.manual, id, createdAt: Date.now(), isPdf: false, imported: true };
  await db.putChunks(id, pack.chunks);
  if (pack.vectors) {
    const data = new Float32Array(pack.chunks.length * pack.vectors.dim);
    data.set(fromBase64(pack.vectors.data));
    await db.putVectors(id, { ...pack.vectors, data });
    manual.embedModel = pack.vectors.model;
    manual.embedDone = pack.vectors.count;
  } else {
    manual.embedDone = 0;
  }
  await db.putManual(manual);
  return manual;
}
