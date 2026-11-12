#!/usr/bin/env node
// Benchmark runner. Measures an app tree (default: this repository) and writes one JSON file per
// suite to bench/results/<label>/, so interrupted runs resume where they stopped.
//
//   node bench/run.mjs --label after [--engine <tree>] [--suites claims,squad,beir,holdout,speed] [--force]
//
// Model outputs always come from the tree's own browser workers (headless Chromium through a local
// mirror of the model files); downloads go to bench/.cache. Set NODE_USE_ENV_PROXY=1 behind a proxy.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { BENCH_DIR, SOURCES, scifact, nfcorpus, scifactClaims, squad } from './lib/data.mjs';
import { stringify } from './lib/json.mjs';
import { installWorkerShim } from './lib/worker-shim.mjs';
import { loadEngine } from './lib/engine.mjs';
import { Provider } from './lib/provider.mjs';
import { claimsSuite } from './lib/suites/claims.mjs';
import { buildCollection, squadSuite, SQUAD_CONFIGS } from './lib/suites/squad.mjs';
import { beirSuite, BEIR_CONFIGS } from './lib/suites/beir.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), [])
);
const label = args.label || 'dev';
const tree = resolve(args.engine || join(BENCH_DIR, '..'));
const suites = String(args.suites || 'claims,squad,beir').split(',');
const outDir = join(BENCH_DIR, 'results', label);
mkdirSync(outDir, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function meta() {
  const git = (...a) => {
    try {
      return execFileSync('git', ['-C', tree, ...a], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  const pkg = (p) => JSON.parse(readFileSync(join(tree, 'node_modules', p, 'package.json'), 'utf8')).version;
  return {
    label,
    tree,
    commit: git('rev-parse', '--short', 'HEAD'),
    dirty: !!git('status', '--porcelain', '--', 'src'),
    date: new Date().toISOString(),
    node: process.version,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    transformers: pkg('@huggingface/transformers'),
    onnxruntimeWeb: pkg('onnxruntime-web'),
    datasets: SOURCES,
  };
}

const provider = new Provider(tree, { log, pages: Number(args.pages || 2) });
installWorkerShim(provider);
const E = await loadEngine(tree);

async function suite(name, fn) {
  const file = join(outDir, `${name}.json`);
  if (existsSync(file) && !args.force) return log(`${name}: already measured (${file}), skipping`);
  log(`${name}: running`);
  const t0 = performance.now();
  const result = await fn();
  writeFileSync(file, stringify({ meta: { ...meta(), suite: name, seconds: Math.round((performance.now() - t0) / 1000) }, result }));
  log(`${name}: done in ${Math.round((performance.now() - t0) / 1000)} s`);
}

try {
  if (suites.includes('claims')) {
    const [sq, cl] = await Promise.all([squad(), scifactClaims()]);
    await suite('claims-B', () => claimsSuite(E, sq, cl, { split: 'B', claimsSplit: 'dev' }));
    await suite('claims-A', () => claimsSuite(E, sq, cl, { split: 'A', claimsSplit: 'train' }));
  }
  if (suites.includes('squad')) {
    const sq = await squad();
    const need = ['squad-B', 'squad-A'].some((n) => args.force || !existsSync(join(outDir, `${n}.json`)));
    if (need) {
      const col = await buildCollection(E, provider, sq, { log });
      await suite('squad-B', async () => ({ collection: col.stats, ingestMs: col.ingestMs, ...(await squadSuite(E, provider, col, { split: 'B', step: 2, configs: SQUAD_CONFIGS, log })) }));
      await suite('squad-A', async () => ({ collection: col.stats, ingestMs: col.ingestMs, ...(await squadSuite(E, provider, col, { split: 'A', step: 4, configs: SQUAD_CONFIGS, log })) }));
    }
  }
  if (suites.includes('beir')) {
    const data = await scifact();
    await suite('scifact-test', () => beirSuite(E, provider, { name: 'scifact', data, split: 'test', log }));
    await suite('scifact-train', () => beirSuite(E, provider, { name: 'scifact', data, split: 'train', configs: BEIR_CONFIGS.filter((c) => c.id === 'bm25' || c.id === 'hybrid-gte'), log }));
  }
  if (suites.includes('holdout')) {
    const data = await nfcorpus();
    await suite('nfcorpus-test', () => beirSuite(E, provider, { name: 'nfcorpus', data, split: 'test', configs: BEIR_CONFIGS.filter((c) => !c.rerank), log }));
  }
  if (suites.includes('speed')) {
    const { speedSuite } = await import('./lib/suites/speed.mjs');
    for (const isolated of String(args.isolation || 'off,on').split(',')) await suite(`speed-${isolated}`, () => speedSuite(E, tree, { isolated: isolated === 'on', provider, log, reps: Number(args.reps || 3), ragQuestions: Number(args.rag ?? 8) }));
  }
} finally {
  if (provider.browserInfo) {
    // merged with earlier runs of this label, so each model keeps its cache namespace record
    const file = join(outDir, 'browser.json');
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const models = { embed: { ...prev.models?.embed, ...provider.info.embed }, rerank: { ...prev.models?.rerank, ...provider.info.rerank } };
    writeFileSync(file, stringify({ browser: provider.browserInfo, models, revisions: { ...prev.revisions, ...provider.mirror?.revisions } }));
  }
  await provider.close();
}
log('all requested suites finished');
