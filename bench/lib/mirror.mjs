// Local HTTPS mirror for the hosts the app downloads models from. Chromium is pointed at it with
// --host-resolver-rules, so benchmark runs never touch the network:
//  - huggingface.co/<repo>/resolve/<rev>/<file>  -> files downloaded once by Node (through the proxy)
//  - cdn.jsdelivr.net/npm/onnxruntime-web@<v>/dist/<file> -> the npm-installed onnxruntime-web
//    (so no code fetched from a CDN is ever executed here)
// Every response carries CORS + CORP headers, which cross-origin isolation (COEP) requires.
import https from 'node:https';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const HOSTS = ['huggingface.co', 'cdn.jsdelivr.net'];

function certificate(dir) {
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  if (!existsSync(key)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3650', '-subj', '/CN=bench-mirror', '-addext', `subjectAltName=${HOSTS.map((h) => `DNS:${h}`).join(',')},IP:127.0.0.1`], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const TYPES = { json: 'application/json', wasm: 'application/wasm', mjs: 'text/javascript', js: 'text/javascript', txt: 'text/plain', model: 'application/octet-stream' };

/**
 * Start the mirror. `ortDir` is node_modules/onnxruntime-web/dist of the tree under test.
 * Returns { port, hostRules, stats(), resetStats(), revisions, close() }.
 */
export async function startMirror({ cacheDir, ortDir, ortVersion }) {
  const hfDir = join(cacheDir, 'hf');
  const revisions = {}; // repo -> commit sha actually downloaded
  const metaFile = join(hfDir, 'revisions.json');
  if (existsSync(metaFile)) Object.assign(revisions, JSON.parse(readFileSync(metaFile, 'utf8')));
  const pending = new Map();
  let served = new Map(); // "host path" -> bytes
  const unexpected = [];

  async function hfFile(path) {
    // /<org>/<repo>/resolve/<rev>/<file...>
    const m = /^\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/.exec(path);
    if (!m) return null;
    const [, repo, rev, file] = m;
    const local = normalize(join(hfDir, repo, rev, file));
    if (!local.startsWith(hfDir)) return null;
    const missing = `${local}.404`;
    if (existsSync(local)) return local;
    if (existsSync(missing)) return null;
    if (!pending.has(local)) {
      pending.set(
        local,
        (async () => {
          const res = await fetch(`https://huggingface.co${path}`, { redirect: 'follow' });
          mkdirSync(dirname(local), { recursive: true });
          if (res.status === 404) {
            writeFileSync(missing, '');
            return null;
          }
          if (!res.ok) throw new Error(`HF ${res.status} for ${path}`);
          const commit = res.headers.get('x-repo-commit');
          if (commit) {
            revisions[repo] = commit;
            writeFileSync(metaFile, JSON.stringify(revisions, null, 1));
          }
          const tmp = `${local}.part`;
          await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
          renameSync(tmp, local);
          return local;
        })().finally(() => pending.delete(local))
      );
    }
    return pending.get(local);
  }

  function ortFile(path) {
    const m = /^\/npm\/onnxruntime-web@([^/]+)\/dist\/([\w.-]+)$/.exec(path);
    if (!m) return null;
    if (ortVersion && m[1] !== ortVersion) {
      unexpected.push(`onnxruntime-web version ${m[1]} requested, ${ortVersion} installed`);
      return null;
    }
    const f = join(ortDir, m[2]);
    return existsSync(f) ? f : null;
  }

  const server = https.createServer(certificate(join(cacheDir, 'mirror-cert')), async (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const path = decodeURIComponent(req.url.split('?')[0]);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'cross-origin-resource-policy': 'cross-origin', 'access-control-expose-headers': 'content-length, etag' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    try {
      let file = null;
      if (host === 'huggingface.co') file = await hfFile(path);
      else if (host === 'cdn.jsdelivr.net') file = ortFile(path);
      else unexpected.push(`${host}${path}`);
      if (!file) return res.writeHead(404, cors).end('not found');
      const size = statSync(file).size;
      const ext = file.split('.').pop();
      res.writeHead(200, { ...cors, 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': size, 'cache-control': 'public, max-age=31536000' });
      if (req.method === 'HEAD') return res.end();
      // count only responses that were fully delivered (clients abort and retry some requests)
      const key = `${host}${path}`;
      res.on('finish', () => served.set(key, (served.get(key) || 0) + size));
      createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(502, cors).end(String(e.message || e));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    port,
    // every other host fails fast, so a stray request cannot reach the network
    hostRules: `${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(', ')}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost`,
    stats: () => ({ bytes: [...served.values()].reduce((a, b) => a + b, 0), files: Object.fromEntries(served), unexpected: [...unexpected] }),
    resetStats: () => {
      served = new Map();
      unexpected.length = 0;
    },
    revisions,
    close: () => new Promise((r) => server.close(r)),
  };
}
