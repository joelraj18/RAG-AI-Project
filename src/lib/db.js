import { openDB } from 'idb';

// Everything lives in this browser (IndexedDB): original files (for the page viewer),
// chunks, int8 vector shards, collections, chat sessions and experiments.
// Vectors are stored in shards of SHARD rows so embedding progress is saved
// incrementally instead of rewriting the whole index.

export const SHARD = 1024;

let dbp = null;
// opened lazily, so modules importing this file also work outside the browser (tests)
const getDB = () =>
  (dbp ??= openDB('rag-ai-studio', 1, {
  upgrade(db) {
    db.createObjectStore('docs', { keyPath: 'id' });
    db.createObjectStore('files');
    db.createObjectStore('chunks');
    db.createObjectStore('vecShards');
    db.createObjectStore('collections', { keyPath: 'id' });
    db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('collectionId', 'collectionId');
    db.createObjectStore('benchmarks', { keyPath: 'id' });
    db.createObjectStore('kv');
  },
}));

const shardKey = (docId, n) => `${docId}#${String(n).padStart(5, '0')}`;
const shardRange = (docId) => IDBKeyRange.bound(`${docId}#`, `${docId}#￿`);

let writes = 0; // instrumentation for tests / the storage panel
export const writeCount = () => writes;

async function put(store, value, key) {
  writes++;
  return (await getDB()).put(store, value, key);
}

export const db = {
  async listDocs() {
    return (await (await getDB()).getAll('docs')).sort((a, b) => b.createdAt - a.createdAt);
  },
  putDoc: (d) => put('docs', d),
  async deleteDoc(id) {
    const d = await getDB();
    const tx = d.transaction(['docs', 'files', 'chunks', 'vecShards', 'collections'], 'readwrite');
    await tx.objectStore('docs').delete(id);
    await tx.objectStore('files').delete(id);
    await tx.objectStore('chunks').delete(id);
    await tx.objectStore('vecShards').delete(shardRange(id));
    const cols = tx.objectStore('collections');
    for (const c of await cols.getAll()) {
      if (c.docIds.includes(id)) await cols.put({ ...c, docIds: c.docIds.filter((x) => x !== id) });
    }
    await tx.done;
  },
  putFile: (id, blob) => put('files', blob, id),
  async getFile(id) {
    return (await getDB()).get('files', id);
  },
  async deleteFile(id) {
    return (await getDB()).delete('files', id);
  },
  putChunks: (id, chunks) => put('chunks', chunks, id),
  async getChunks(id) {
    return (await getDB()).get('chunks', id);
  },
  putShard: (docId, n, shard) => put('vecShards', shard, shardKey(docId, n)),
  async getShards(docId) {
    return (await getDB()).getAll('vecShards', shardRange(docId));
  },
  async deleteShards(docId) {
    return (await getDB()).delete('vecShards', shardRange(docId));
  },
  async listCollections() {
    return (await (await getDB()).getAll('collections')).sort((a, b) => a.createdAt - b.createdAt);
  },
  putCollection: (c) => put('collections', c),
  async deleteCollection(id) {
    const d = await getDB();
    const tx = d.transaction(['collections', 'sessions'], 'readwrite');
    await tx.objectStore('collections').delete(id);
    const idx = tx.objectStore('sessions').index('collectionId');
    for (let c = await idx.openCursor(id); c; c = await c.continue()) await c.delete();
    await tx.done;
  },
  async listSessions(collectionId) {
    const all = await (await getDB()).getAllFromIndex('sessions', 'collectionId', collectionId);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  putSession: (s) => put('sessions', s),
  async deleteSession(id) {
    return (await getDB()).delete('sessions', id);
  },
  async listBenchmarks() {
    return (await (await getDB()).getAll('benchmarks')).sort((a, b) => b.createdAt - a.createdAt);
  },
  putBenchmark: (b) => put('benchmarks', b),
  async deleteBenchmark(id) {
    return (await getDB()).delete('benchmarks', id);
  },
  async getKV(key) {
    return (await getDB()).get('kv', key);
  },
  putKV: (key, value) => put('kv', value, key),
  async clearAll() {
    const d = await getDB();
    for (const s of ['docs', 'files', 'chunks', 'vecShards', 'collections', 'sessions', 'benchmarks', 'kv']) await d.clear(s);
  },
};

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage, quota: e.quota } : null;
  } catch {
    return null;
  }
}

export async function requestPersistence() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
