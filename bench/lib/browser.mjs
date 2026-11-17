// Builds an app tree with the benchmark page, serves it (with or without cross-origin isolation)
// and drives it in headless Chromium through the local model mirror.
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { BENCH_DIR } from './data.mjs';

const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

/** Production build of `tree` with the bench page as the only entry. Returns the output dir. */
export async function buildTree(tree) {
  const pageDir = join(tree, 'bench-page');
  rmSync(pageDir, { recursive: true, force: true });
  cpSync(join(BENCH_DIR, 'page'), pageDir, { recursive: true });
  const outDir = join(tree, 'bench-dist');
  await build({
    root: tree,
    configFile: join(tree, 'vite.config.js'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { bench: join(pageDir, 'index.html') } } },
  });
  return outDir;
}

/** Static server for a built tree; `isolated` adds COOP/COEP like the deployed site would. */
export async function serve(outDir, isolated) {
  const server = await preview({
    configFile: false,
    root: outDir,
    base: './',
    logLevel: 'error',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false, headers: isolated ? ISOLATION : {} },
  });
  const url = server.resolvedUrls.local[0];
  return { url, close: () => server.close() };
}

/** The onnxruntime-web that the tree's transformers.js will request (served from node_modules). */
export function ortInfo(tree) {
  const root = join(tree, 'node_modules', 'onnxruntime-web');
  return { version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, dir: join(root, 'dist') };
}

export async function launch(mirror) {
  // Proxy variables must be cleared: with a proxy, Chromium resolves hosts at the proxy and the
  // mapping rules would be ignored (the browser would download models from the internet).
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(https?|all|no)_proxy$/i.test(k)) delete env[k];
  return chromium.launch({
    headless: true,
    env,
    args: [`--host-resolver-rules=${mirror.hostRules}`, '--no-proxy-server', '--disable-features=MediaRouter'],
  });
}

/**
 * Open the bench page in a fresh context (empty caches = cold start).
 * Returns { page, call(name, ...args), info(), close() }.
 */
export async function openBench(browser, url, { logConsole = false } = {}) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const warnings = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/thread|crossOriginIsolated|Falling back/i.test(t)) warnings.push(t);
    if (logConsole) console.log('[page]', t.slice(0, 300));
  });
  page.on('pageerror', (e) => warnings.push(`pageerror: ${e.message}`));
  await page.goto(`${url}bench-page/index.html`);
  await page.waitForFunction(() => globalThis.benchReady === true, null, { timeout: 60000 });
  const call = (name, ...args) => page.evaluate(([n, a]) => globalThis.bench[n](...a), [name, args]);
  return { page, call, warnings, info: () => call('info'), close: () => context.close() };
}

export const decodeF32 = (b64) => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

export function cleanTree(tree) {
  for (const d of ['bench-page', 'bench-dist']) rmSync(join(tree, d), { recursive: true, force: true });
}

export const ensureDir = (d) => (existsSync(d) ? d : (mkdirSync(d, { recursive: true }), d));
