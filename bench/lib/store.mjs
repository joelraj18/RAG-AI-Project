// On-disk cache of model outputs (embeddings, rerank scores), keyed by sha1 of the exact input.
// Each model has "namespaces": outputs are reused only when a fixed set of probe inputs produces
// the same outputs as when the namespace was created, so a change in truncation, dtype or model
// file can never silently reuse stale vectors.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const locks = new Set();
process.on('exit', () => locks.forEach((f) => rmSync(f, { force: true })));

export class VectorStore {
  /** `readOnly`: read what is cached without taking the lock (for analyses next to a running benchmark). */
  constructor(dir, dim, { readOnly = false } = {}) {
    this.dir = dir;
    this.dim = dim;
    this.readOnly = readOnly;
    mkdirSync(dir, { recursive: true });
    // one writer per store: a second benchmark process appending to the same files would
    // desynchronise the index from the data (each process keeps its own view of the row count)
    const lock = join(dir, 'lock');
    if (!readOnly) {
      if (existsSync(lock)) {
        const pid = Number(readFileSync(lock, 'utf8'));
        if (pid !== process.pid && alive(pid)) throw new Error(`The cache ${dir} is in use by another benchmark process (pid ${pid}). Run one benchmark at a time.`);
      }
      writeFileSync(lock, String(process.pid));
      locks.add(lock);
    }
    this.indexFile = join(dir, 'index.json');
    this.dataFile = join(dir, 'data.f32');
    this.index = existsSync(this.indexFile) ? JSON.parse(readFileSync(this.indexFile, 'utf8')) : {};
    const buf = existsSync(this.dataFile) ? readFileSync(this.dataFile) : Buffer.alloc(0);
    this.rows = buf.length / 4 / dim;
    this.data = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    this.pending = [];
  }

  get(key) {
    const row = this.index[key];
    if (row === undefined) {
      const p = this.pending.find((x) => x.key === key);
      return p?.vec;
    }
    return this.data.subarray(row * this.dim, (row + 1) * this.dim);
  }

  set(key, vec) {
    if (this.readOnly) throw new Error(`The cache ${this.dir} was opened read-only and has no entry for this input`);
    if (this.index[key] !== undefined || this.pending.some((x) => x.key === key)) return;
    this.pending.push({ key, vec: Float32Array.from(vec) });
  }

  flush() {
    if (!this.pending.length) return;
    const onDisk = existsSync(this.dataFile) ? readFileSync(this.dataFile).length / 4 / this.dim : 0;
    if (onDisk !== this.rows) throw new Error(`Cache ${this.dir} changed on disk (${onDisk} rows, expected ${this.rows}); another process wrote to it.`);
    const add = new Float32Array(this.pending.length * this.dim);
    this.pending.forEach((p, i) => {
      add.set(p.vec, i * this.dim);
      this.index[p.key] = this.rows + i;
    });
    appendFileSync(this.dataFile, Buffer.from(add.buffer));
    const merged = new Float32Array(this.data.length + add.length);
    merged.set(this.data);
    merged.set(add, this.data.length);
    this.data = merged;
    this.rows += this.pending.length;
    this.pending = [];
    writeFileSync(this.indexFile, JSON.stringify(this.index));
  }
}

/**
 * Find (or create) the namespace whose stored probe outputs match `probes` (array of number arrays).
 * `close(a, b)` decides whether two probe outputs are the same.
 */
export function namespaceFor(baseDir, probes, close) {
  mkdirSync(baseDir, { recursive: true });
  const regFile = join(baseDir, 'namespaces.json');
  const reg = existsSync(regFile) ? JSON.parse(readFileSync(regFile, 'utf8')) : [];
  const hit = reg.find((ns) => ns.probes.length === probes.length && ns.probes.every((p, i) => close(p, probes[i])));
  if (hit) return { id: hit.id, dir: join(baseDir, hit.id), created: false };
  const id = `ns${reg.length + 1}`;
  reg.push({ id, createdAt: new Date().toISOString(), probes: probes.map((p) => Array.from(p, (x) => +x.toFixed(6))) });
  writeFileSync(regFile, JSON.stringify(reg));
  return { id, dir: join(baseDir, id), created: true };
}
