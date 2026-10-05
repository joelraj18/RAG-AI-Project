import { openDB } from 'idb';

// Everything is stored locally in the browser (IndexedDB): the original file (for the
// page viewer), cleaned chunks, embedding vectors, chat sessions and benchmark runs.
// Nothing is uploaded to any server.

const dbPromise = openDB('medirag', 1, {
  upgrade(db) {
    db.createObjectStore('manuals', { keyPath: 'id' });
    db.createObjectStore('files');
    db.createObjectStore('chunks');
    db.createObjectStore('vectors');
    const s = db.createObjectStore('sessions', { keyPath: 'id' });
    s.createIndex('manualId', 'manualId');
    db.createObjectStore('benchmarks', { keyPath: 'id' });
  },
});

export const db = {
  async listManuals() {
    return (await (await dbPromise).getAll('manuals')).sort((a, b) => b.createdAt - a.createdAt);
  },
  async putManual(m) {
    return (await dbPromise).put('manuals', m);
  },
  async getManual(id) {
    return (await dbPromise).get('manuals', id);
  },
  async deleteManual(id) {
    const d = await dbPromise;
    const tx = d.transaction(['manuals', 'files', 'chunks', 'vectors', 'sessions'], 'readwrite');
    await tx.objectStore('manuals').delete(id);
    await tx.objectStore('files').delete(id);
    await tx.objectStore('chunks').delete(id);
    await tx.objectStore('vectors').delete(id);
    const idx = tx.objectStore('sessions').index('manualId');
    for (let c = await idx.openCursor(id); c; c = await c.continue()) await c.delete();
    await tx.done;
  },
  async putFile(id, blob) {
    return (await dbPromise).put('files', blob, id);
  },
  async getFile(id) {
    return (await dbPromise).get('files', id);
  },
  async putChunks(id, chunks) {
    return (await dbPromise).put('chunks', chunks, id);
  },
  async getChunks(id) {
    return (await dbPromise).get('chunks', id);
  },
  async putVectors(id, v) {
    return (await dbPromise).put('vectors', v, id);
  },
  async getVectors(id) {
    return (await dbPromise).get('vectors', id);
  },
  async deleteVectors(id) {
    return (await dbPromise).delete('vectors', id);
  },
  async listSessions(manualId) {
    const all = await (await dbPromise).getAllFromIndex('sessions', 'manualId', manualId);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async putSession(s) {
    return (await dbPromise).put('sessions', s);
  },
  async deleteSession(id) {
    return (await dbPromise).delete('sessions', id);
  },
  async listBenchmarks() {
    return (await (await dbPromise).getAll('benchmarks')).sort((a, b) => b.createdAt - a.createdAt);
  },
  async putBenchmark(b) {
    return (await dbPromise).put('benchmarks', b);
  },
  async deleteBenchmark(id) {
    return (await dbPromise).delete('benchmarks', id);
  },
  async clearAll() {
    const d = await dbPromise;
    for (const s of ['manuals', 'files', 'chunks', 'vectors', 'sessions', 'benchmarks']) await d.clear(s);
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
