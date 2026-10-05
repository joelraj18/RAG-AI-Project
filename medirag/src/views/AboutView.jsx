import { Workflow, HelpCircle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardHeader, Badge } from '../components/ui.jsx';

const PIPE = [
  ['Upload', 'PDF → pages (pdf.js)'],
  ['Clean', 'auto-detect watermarks & headers'],
  ['Chunk', '400 tok / 50 overlap'],
  ['Index', 'BM25 + gte-small embeddings'],
  ['Retrieve', 'hybrid RRF, top-k'],
  ['Generate', 'grounded prompt + [PDF p.] citations'],
  ['Evaluate', 'judge + claim support + timing'],
];

const KINDS = [
  { name: 'Rule-based system', is: false, why: 'No hand-written if/then rules or decision trees produce the answers; the content comes from the manual and an LLM.' },
  { name: 'Vanilla LLM chatbot', is: false, why: 'Answers are not from model memory. The notebook showed vanilla answers only scored 3.6/5 groundedness.' },
  { name: 'RAG (Retrieval-Augmented Generation)', is: true, why: 'Each question retrieves relevant chunks from a vector database and an LLM writes an answer constrained to them, with citations. This is exactly what the notebook builds.' },
  { name: 'Agentic RAG / AI agent', is: 'partial', why: 'The notebook is a fixed, single-pass pipeline — not an agent. This website adds one optional agent-like step (Corrective RAG: self-evaluate, rewrite the query, retry), but there is no autonomous planning or tool use.' },
];

export default function AboutView() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">How it works</h1>
          <p className="text-sm text-slate-500">MediRAG Studio is the browser version of the Colab project “Medical Assistant: RAG-based Clinical Decision Support using The Merck Manual”.</p>
        </div>

        <Card>
          <CardHeader icon={HelpCircle} title="What kind of AI solution is this?" subtitle="Short answer: a RAG-based AI solution (retrieval-augmented generation)." />
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {KINDS.map((k) => (
              <div key={k.name} className="flex items-start gap-3 px-5 py-3">
                {k.is === true ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : k.is === 'partial' ? <Badge color="amber">optional</Badge> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />}
                <div>
                  <div className="font-medium">{k.name}</div>
                  <div className="text-sm text-slate-500">{k.why}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Workflow} title="Pipeline" subtitle="Every stage is timed and shown in the UI." />
          <div className="flex flex-wrap items-center gap-2 p-5">
            {PIPE.map(([t, d], i) => (
              <div key={t} className="flex items-center gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-sm font-semibold">{t}</div>
                  <div className="text-[11px] text-slate-500">{d}</div>
                </div>
                {i < PIPE.length - 1 && <ArrowRight className="h-4 w-4 text-slate-400" />}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase dark:border-slate-800">
                  <th className="py-2">Stage</th>
                  <th>Colab notebook</th>
                  <th>This website</th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-1.5 [&_td]:pr-3 [&_tr]:border-b [&_tr]:border-slate-100 dark:[&_tr]:border-slate-800">
                <tr><td>Hardware</td><td>T4 GPU on Colab</td><td>Your browser (WebGPU or CPU) — free static hosting</td></tr>
                <tr><td>Loading</td><td>PyMuPDFLoader</td><td>pdf.js, page numbers kept for citations</td></tr>
                <tr><td>Cleaning</td><td>Hard-coded watermark regexes</td><td>Automatic: lines repeated on ≥30% of pages + e-mails + legal notices</td></tr>
                <tr><td>Chunking</td><td>RecursiveCharacterTextSplitter, 400/50 tokens</td><td>Same algorithm and sizes</td></tr>
                <tr><td>Embeddings</td><td>thenlper/gte-large (1024-d)</td><td>gte-small / bge-small / MiniLM (384-d) via transformers.js</td></tr>
                <tr><td>Vector store</td><td>ChromaDB (cosine, HNSW)</td><td>IndexedDB + exact cosine search, plus BM25 and hybrid fusion</td></tr>
                <tr><td>LLM</td><td>Mistral-7B-Instruct Q4 (llama.cpp)</td><td>HF Inference (Llama/Qwen/Mistral), Ollama, in-browser Qwen/Llama, or extractive</td></tr>
                <tr><td>Evaluation</td><td>LLM judge: groundedness + relevance</td><td>Same judge prompts + claim-level support map, citation validity, timing waterfall</td></tr>
                <tr><td>Sessions</td><td>—</td><td>Persistent chat sessions per manual, exportable as Markdown</td></tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Reading the evaluation panel" />
          <ul className="list-disc space-y-1.5 px-10 py-5 text-sm text-slate-600 dark:text-slate-300">
            <li><b>Groundedness (1–5)</b> — LLM judge: is every claim supported by the retrieved context? (notebook rubric)</li>
            <li><b>Relevance (1–5)</b> — LLM judge: does the answer cover every part of the question?</li>
            <li><b>Lexical support</b> — judge-free: share of answer claims whose content words are found in the retrieved chunks. Reproducible and free of self-evaluation bias.</li>
            <li><b>Citation validity</b> — share of cited pages that were actually retrieved (catches invented citations).</li>
            <li><b>Time taken</b> — query embedding, search, generation (with time-to-first-token marker) and evaluation, plus tokens/s.</li>
            <li>As the notebook notes, groundedness is measured against the retrieved context, not clinical truth — a retrieval miss can still score 5/5. Always check the cited pages.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
