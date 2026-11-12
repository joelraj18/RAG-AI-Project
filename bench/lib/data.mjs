// Benchmark datasets, downloaded once and cached under bench/.cache (gitignored).
//  SciFact and NFCorpus (BEIR retrieval benchmarks), the original SciFact claim/evidence
//  release (for the hallucination check) and SQuAD v1.1 dev (page retrieval and answers).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip, untgz } from './archive.mjs';

export const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = process.env.BENCH_CACHE || join(BENCH_DIR, '.cache');

export const SOURCES = {
  scifact: { url: 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip', license: 'CC BY-SA 4.0 (BEIR)', cite: 'Wadden et al. 2020; Thakur et al. 2021' },
  nfcorpus: { url: 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/nfcorpus.zip', license: 'BEIR distribution (NFCorpus, Boteva et al. 2016)', cite: 'Boteva et al. 2016; Thakur et al. 2021' },
  scifactClaims: { url: 'https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz', license: 'CC BY-NC 2.0', cite: 'Wadden et al. 2020' },
  squad: { url: 'https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v1.1.json', license: 'CC BY-SA 4.0', cite: 'Rajpurkar et al. 2016' },
};

async function download(name) {
  const { url } = SOURCES[name];
  const file = join(CACHE, 'data', url.split('/').pop());
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

const jsonl = (buf) => buf.toString('utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function qrels(buf) {
  const out = {};
  for (const line of buf.toString('utf8').split('\n').slice(1)) {
    const [q, d, s] = line.trim().split('\t');
    if (!q || !d) continue;
    (out[q] ||= {})[d] = Number(s);
  }
  return out;
}

/** BEIR dataset: { corpus: [{id, title, text}], queries: {id: text}, qrels: {split: {qid: {docid: grade}}} } */
async function beir(name) {
  const files = unzip(await download(name));
  const get = (suffix) => [...files].find(([n]) => n.endsWith(suffix))?.[1];
  const corpus = jsonl(get('corpus.jsonl')).map((d) => ({ id: String(d._id), title: d.title || '', text: d.text || '' }));
  const queries = Object.fromEntries(jsonl(get('queries.jsonl')).map((q) => [String(q._id), q.text]));
  const splits = {};
  for (const split of ['train', 'dev', 'test']) {
    const b = get(`qrels/${split}.tsv`);
    if (b) splits[split] = qrels(b);
  }
  return { corpus, queries, qrels: splits };
}

export const scifact = () => beir('scifact');
export const nfcorpus = () => beir('nfcorpus');

/** SciFact claims with labelled evidence: { train: [...], dev: [...] } of { claim, label, abstract, evidence } */
export async function scifactClaims() {
  const files = untgz(await download('scifactClaims'));
  const get = (suffix) => [...files].find(([n]) => n.endsWith(suffix) && !n.split('/').pop().startsWith('._'))?.[1];
  const corpus = new Map(jsonl(get('data/corpus.jsonl')).map((d) => [String(d.doc_id), d]));
  const pairs = (file) =>
    jsonl(get(file)).flatMap((c) =>
      Object.entries(c.evidence || {}).flatMap(([docId, evs]) =>
        evs.map((ev) => {
          const doc = corpus.get(docId);
          return { id: `${c.id}:${docId}:${ev.sentences.join('-')}`, claim: c.claim, label: ev.label, title: doc.title, abstract: doc.abstract.join(' '), evidence: ev.sentences.map((i) => doc.abstract[i]).join(' ') };
        })
      )
    );
  return { train: pairs('claims_train.jsonl'), dev: pairs('claims_dev.jsonl') };
}

/** SQuAD v1.1 dev: [{ title, paragraphs: [{ context, qas: [{ id, question, answers: [text] }] }] }] */
export async function squad() {
  const j = JSON.parse((await download('squad')).toString('utf8'));
  return j.data.map((a) => ({
    title: a.title.replace(/_/g, ' '),
    paragraphs: a.paragraphs.map((p) => ({ context: p.context, qas: p.qas.map((q) => ({ id: q.id, question: q.question, answers: [...new Set(q.answers.map((x) => x.text))] })) })),
  }));
}

/** Stable split by a hash of an id: 'A' (tuning) or 'B' (reporting). Independent of the engine. */
export function half(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2 ? 'B' : 'A';
}
