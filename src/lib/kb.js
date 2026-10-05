import { db, SHARD } from './db.js';
import { loadFile } from './loaders/index.js';
import { embeddingText } from './chunk.js';
import { bm25Bytes } from './bm25.js';
import { quantize } from './quant.js';
import { embedTexts, embedClient, ingestInWorker, bm25InWorker } from './workers.js';
import { uid } from './text.js';

// Knowledge-base lifecycle for each document:
// load (pdf.js / mammoth / DOMParser) -> clean + chunk + BM25 (ingest worker) -> store,
// then a resumable background job embeds chunks into int8 shards.

const cache = new Map(); // docId -> { chunks, bm25, vectors }
let embedDevice = 'wasm';
embedClient.onStatus((m) => m.type === 'ready' && (embedDevice = m.device));

export const shortName = (name) => name.replace(/\.(pdf|txt|md|markdown|html?|docx)$/i, '').replace(/[[\]]/g, '').trim().slice(0, 40);

export async function ingestFile(file, { chunkSize, chunkOverlap, embedModel }, onStage) {
  const stage = (s) => onStage?.(s);
  stage({ stage: 'load', status: 'running' });
  const t0 = performance.now();
  const { pages, title, kind } = await loadFile(file, (i, n) =>
    stage({ stage: 'load', status: 'running', progress: i / n, detail: `${i} / ${n} pages` })
  );
  const loadMs = performance.now() - t0;
  stage({ stage: 'load', status: 'done', ms: loadMs });
  if (!pages.some((p) => p.text.trim())) throw new Error(`No text found in ${file.name}. Scanned (image-only) PDFs need OCR first.`);

  stage({ stage: 'clean', status: 'running' });
  const r = await ingestInWorker({ pages, chunkSize, chunkOverlap }, (m) => {
    stage({ stage: m.stage, status: 'done', ms: m.ms });
    stage({ stage: m.stage === 'clean' ? 'chunk' : 'index', status: 'running' });
  });
  stage({ stage: 'index', status: 'done', ms: r.timings.index });
  if (!r.chunks.length) throw new Error(`${file.name} produced no usable text chunks.`);

  stage({ stage: 'store', status: 'running' });
  const t1 = performance.now();
  const id = uid();
  const name = shortName(file.name) || 'Document';
  const doc = {
    id,
    name,
    title: title || '',
    fileName: file.name,
    kind,
    size: file.size,
    hasFile: kind === 'pdf', // only PDFs are rendered by the page viewer, so only they are kept
    createdAt: Date.now(),
    pageCount: pages.length,
    clean: r.stats,
    chunkStats: r.chunkStats,
    chunkBytes: r.chunks.reduce((s, c) => s + c.text.length + 40, 0),
    bm25Bytes: bm25Bytes(r.bm25),
    chunkSize,
    chunkOverlap,
    embedModel,
    embedDone: 0,
    embedMs: 0,
    dim: null,
  };
  if (doc.hasFile) await db.putFile(id, file);
  await db.putChunks(id, r.chunks);
  doc.timings = { load: loadMs, ...r.timings, store: performance.now() - t1 };
  await db.putDoc(doc);
  stage({ stage: 'store', status: 'done', ms: doc.timings.store });
  cache.set(id, { chunks: r.chunks, bm25: r.bm25, vectors: null });
  return doc;
}

async function loadVectors(doc, n) {
  const shards = await db.getShards(doc.id);
  if (!shards.length || shards[0].model !== doc.embedModel) return null;
  const dim = shards[0].dim;
  const q = new Int8Array(n * dim);
  const scales = new Float32Array(n);
  let rows = 0;
  for (const s of shards) {
    q.set(s.q, rows * dim);
    scales.set(s.s, rows);
    rows += s.rows;
  }
  return { q, scales, dim, count: Math.min(rows, doc.embedDone ?? rows), model: doc.embedModel };
}

/** Load a document's chunks, BM25 index (rebuilt in the worker) and vectors. */
export async function loadKnowledge(doc) {
  if (cache.has(doc.id)) return cache.get(doc.id);
  const chunks = (await db.getChunks(doc.id)) || [];
  const [{ bm25 }, vectors] = await Promise.all([bm25InWorker(chunks), loadVectors(doc, chunks.length)]);
  const entry = { chunks, bm25, vectors };
  cache.set(doc.id, entry);
  return entry;
}

export const cachedKnowledge = (docId) => cache.get(docId);
export const forget = (docId) => cache.delete(docId);

export function vectorsReady(doc, kb) {
  return !!kb?.vectors && kb.vectors.count >= kb.chunks.length && kb.vectors.model === doc.embedModel;
}

/** Background embedding job; saves completed shards as it goes and resumes after reloads. */
export class EmbedJob {
  constructor(doc, { onProgress, onDone, onError }) {
    Object.assign(this, { doc, onProgress, onDone, onError });
    this.running = false;
    this.discard = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const d = this.doc;
    try {
      const kb = await loadKnowledge(d);
      const n = kb.chunks.length;
      let v = kb.vectors;
      let done = v ? v.count : 0;
      let saved = Math.floor(done / SHARD) * SHARD;
      let elapsed = d.embedMs || 0;
      while (this.running && done < n) {
        const batchSize = embedDevice === 'webgpu' ? 64 : 16;
        const batch = kb.chunks.slice(done, done + batchSize);
        const t0 = performance.now();
        const { dim, data } = await embedTexts(d.embedModel, batch.map((c) => embeddingText(d.name, c)));
        if (!this.running) break;
        if (!v || v.q.length !== n * dim) {
          v = { q: new Int8Array(n * dim), scales: new Float32Array(n), dim, count: 0, model: d.embedModel };
          kb.vectors = v;
        }
        const { q, scales } = quantize(data, dim);
        v.q.set(q, done * dim);
        v.scales.set(scales, done);
        done += batch.length;
        v.count = done;
        elapsed += performance.now() - t0;
        Object.assign(d, { embedDone: done, embedMs: elapsed, dim });
        this.onProgress?.({ done, total: n, elapsedMs: elapsed, rate: done / (elapsed / 1000), device: embedDevice });
        while (done - saved >= SHARD) {
          await this.saveShard(v, saved, saved + SHARD);
          saved += SHARD;
          await db.putDoc({ ...d });
        }
      }
      if (this.discard) return;
      if (v && done > saved) await this.saveShard(v, saved, done); // partial shard, overwritten later
      await db.putDoc({ ...d });
      if (done >= n) {
        this.running = false;
        this.onDone?.(d);
      }
    } catch (e) {
      this.running = false;
      if (!this.discard) this.onError?.(e);
    }
  }

  saveShard(v, from, to) {
    return db.putShard(this.doc.id, from / SHARD, {
      model: v.model,
      dim: v.dim,
      rows: to - from,
      q: v.q.slice(from * v.dim, to * v.dim),
      s: v.scales.slice(from, to),
    });
  }

  /** Stop after the current batch. `discard` drops unsaved work (model switch / delete). */
  stop(discard = false) {
    this.running = false;
    this.discard = discard;
  }
}

export async function resetEmbeddings(doc, model) {
  await db.deleteShards(doc.id);
  const kb = cache.get(doc.id);
  if (kb) kb.vectors = null;
  const d = { ...doc, embedModel: model, embedDone: 0, embedMs: 0 };
  await db.putDoc(d);
  embedClient.terminate();
  return d;
}

export function docBytes(doc) {
  const vec = doc.embedDone && doc.dim ? doc.embedDone * (doc.dim + 4) : 0;
  return { file: doc.hasFile ? doc.size : 0, chunks: doc.chunkBytes || 0, vectors: vec, bm25: doc.bm25Bytes || 0 };
}

// ---------- Knowledge packs: a processed document (chunks + int8 vectors) in one gzip file ----------

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export async function exportPack(doc) {
  const { chunks, vectors: v } = await loadKnowledge(doc);
  const pack = {
    format: 'rag-ai-pack@1',
    doc: { ...doc, id: undefined },
    chunks,
    vectors: v
      ? {
          model: v.model,
          dim: v.dim,
          count: v.count,
          q: b64(new Uint8Array(v.q.buffer, 0, v.count * v.dim)),
          s: b64(new Uint8Array(v.scales.buffer, 0, v.count * 4)),
        }
      : null,
  };
  const stream = new Blob([JSON.stringify(pack)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function importPack(file) {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  const pack = JSON.parse(await new Response(stream).text());
  if (pack.format !== 'rag-ai-pack@1') throw new Error('Not a RAG AI Studio knowledge pack.');
  const id = uid();
  const doc = { ...pack.doc, id, createdAt: Date.now(), hasFile: false, imported: true, embedDone: 0 };
  await db.putChunks(id, pack.chunks);
  if (pack.vectors) {
    const { model, dim, count } = pack.vectors;
    const q = new Int8Array(unb64(pack.vectors.q).buffer);
    const s = new Float32Array(unb64(pack.vectors.s).buffer);
    for (let from = 0; from < count; from += SHARD) {
      const to = Math.min(count, from + SHARD);
      await db.putShard(id, from / SHARD, { model, dim, rows: to - from, q: q.slice(from * dim, to * dim), s: s.slice(from, to) });
    }
    Object.assign(doc, { embedModel: model, embedDone: count, dim });
  }
  await db.putDoc(doc);
  return doc;
}
