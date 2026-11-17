// Minimal readers for the dataset archives (zip with deflate/stored entries, tar.gz).
// Written in-house so the benchmark needs no extra dependencies.
import { inflateRawSync, gunzipSync } from 'node:zlib';

/** Map of entry name -> Buffer for a zip file. */
export function unzip(buf) {
  // end of central directory: scan backwards for the signature 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported zip method ${method} for ${name}`);
  }
  return out;
}

/** Map of entry name -> Buffer for a .tar.gz file. */
export function untgz(buf) {
  const tar = gunzipSync(buf);
  const out = new Map();
  let p = 0;
  while (p + 512 <= tar.length) {
    const name = tar.toString('utf8', p, p + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(tar.toString('utf8', p + 124, p + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(tar[p + 156] || 48);
    const prefix = tar.toString('utf8', p + 345, p + 500).replace(/\0.*$/s, '');
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === '0' || type === '\0') out.set(full, tar.subarray(p + 512, p + 512 + size));
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
