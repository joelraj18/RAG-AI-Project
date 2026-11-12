// On-disk cache of model outputs (embeddings, rerank scores), keyed by sha1 of the exact input.
// Each model has "namespaces": outputs are reused only when a fixed set of probe inputs produces
// the same outputs as when the namespace was created, so a change in truncation, dtype or model
// file can never silently reuse stale vectors.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export class VectorStore {
  constructor(dir, dim) {
    this.dir = dir;
    this.dim = dim;
    mkdirSync(dir, { recursive: true });
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
    if (this.index[key] !== undefined || this.pending.some((x) => x.key === key)) return;
    this.pending.push({ key, vec: Float32Array.from(vec) });
  }

  flush() {
    if (!this.pending.length) return;
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
