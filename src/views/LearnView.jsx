import { useState } from 'react';
import { CheckCircle2, XCircle, FileText, Scissors, Layers, Cpu, Search, ArrowDownUp, Bot, Scale, HelpCircle, Lightbulb } from 'lucide-react';
import { Card, CardHeader, Badge, cx, TagBadges } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';
import { docBytes } from '../lib/kb.js';
import { fmtBytes, fmtMs, fmtNum } from '../lib/text.js';

export default function LearnView() {
  const { activeDocs, settings } = useStore();
  const [step, setStep] = useState(0);
  const sum = (f) => activeDocs.reduce((a, d) => a + (f(d) || 0), 0);
  const live = activeDocs.length
    ? {
        pages: fmtNum(sum((d) => d.pageCount)),
        noise: activeDocs[0].clean ? `${(activeDocs[0].clean.removedShare * 100).toFixed(1)}%` : '–',
        chunks: fmtNum(sum((d) => d.chunkStats?.count)),
        sections: fmtNum(sum((d) => d.chunkStats?.sections)),
        vectors: fmtBytes(sum((d) => docBytes(d).vectors)),
        float: fmtBytes(sum((d) => (d.embedDone || 0) * (d.dim || 384) * 4)),
        ingest: fmtMs(sum((d) => (d.timings ? Object.values(d.timings).reduce((a, b) => a + b, 0) : 0))),
      }
    : null;

  const STEPS = [
    { icon: FileText, title: 'Load', text: 'Each file becomes plain text page by page, so every passage keeps its page number for citations. PDFs use pdf.js; larger-font lines become section headings.', live: live && `${live.pages} pages loaded` },
    { icon: Scissors, title: 'Clean', text: 'Lines repeated on many pages (watermarks, running headers, licence notices) and e-mail addresses are removed, so they are not indexed thousands of times.', live: live && `${live.noise} of the text removed as noise` },
    { icon: Layers, title: 'Chunk', text: 'Text is split into ~400-token chunks with 50 tokens of overlap, preferring paragraph and sentence boundaries. Each chunk remembers its section; tables of contents and duplicates are dropped.', live: live && `${live.chunks} chunks in ${live.sections} sections` },
    { icon: Cpu, title: 'Embed & index', text: 'A BM25 keyword index is built instantly; an embedding model turns each chunk (with its section title) into a 384-number vector in the background. Vectors are stored as 8-bit integers — 4× smaller.', live: live && `${live.vectors} of vectors (would be ${live.float} as float32) · ingest ${live.ingest}` },
    { icon: Search, title: 'Retrieve', text: 'The question is searched with BM25 and cosine similarity; the two rankings are fused (RRF). Follow-ups are first rewritten into standalone questions.', live: `mode: ${settings.retrievalMode}, k = ${settings.k}` },
    { icon: ArrowDownUp, title: 'Rerank (optional)', text: 'A cross-encoder reads the question with each top candidate and re-orders them — slower than embeddings, more accurate, so only the top ~20 are reranked.', live: settings.rerank ? 'reranking is ON' : 'reranking is off' },
    { icon: Bot, title: 'Generate', text: 'The LLM receives instructions, the labelled passages and the question. It must answer only from the passages, cite [Document p. N] after each point, and use a fixed fallback sentence if the answer is missing.', live: `provider: ${settings.provider}, temperature ${settings.temperature}` },
    { icon: Scale, title: 'Evaluate', text: 'An LLM judge scores groundedness, relevance and context relevance (1–5). Judge-free checks verify every claim against the passages and every citation against the retrieved pages, and the steps are timed.', live: `judge: ${settings.judgeMode}` },
  ];

  const KINDS = [
    { name: 'Rule-based system', is: false, why: 'No hand-written rules or decision trees produce answers; content comes from your documents and an LLM.' },
    { name: 'Vanilla LLM chatbot', is: false, why: 'Answers are not from model memory. In the original notebook vanilla answers scored 3.6/5 groundedness vs 5.0 with RAG.' },
    { name: 'RAG — Retrieval-Augmented Generation', is: true, why: 'Every question retrieves passages from a vector + keyword index and an LLM answers only from them, with citations. This is what RAG AI Studio is.' },
    { name: 'Agentic RAG / AI agent', is: 'partial', why: 'Not an autonomous agent (no planning or tool use). Optional agent-like steps: query rewriting, HyDE and the Corrective RAG self-check-and-retry loop.' },
  ];

  const GUIDE = [
    ['Fastest answers', 'Extractive or Groq/HF 8B model · BM25 or hybrid · k = 3 · judge off or combined', ['fastest']],
    ['Best answer quality', 'HF 70B model · hybrid + rerank · k = 5 + neighbours · strict judge · corrective RAG', ['quality']],
    ['Least storage / download', 'MiniLM embeddings · free original PDFs after indexing · BM25-only works with no model at all', ['lightest']],
    ['Full privacy', 'In-browser model or local Ollama — nothing leaves your machine', ['private']],
    ['Free Hugging Face account', 'Settings → Your plan → Apply Free settings: Llama 3.1 8B, combined judge, no automatic extra calls (~2 calls/question). Use Retrieval-only in the Lab.', ['lightest']],
    ['PRO Hugging Face account', 'Apply PRO settings: Llama 3.3 70B, strict judge, corrective retry (~3 calls/question, up to 7 with a retry). Optionally bill an organisation.', ['quality']],
    ['Everyday default', 'Balanced profile: hybrid k = 4, combined judge, gte-small, HF Llama-3.1-8B', ['recommended']],
  ];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Learn RAG</h1>
          <p className="text-sm text-slate-500">How retrieval-augmented generation works, step by step — with live numbers from your active collection.</p>
        </div>

        <Card>
          <CardHeader icon={Lightbulb} title="The pipeline" subtitle="Click a step." />
          <div className="grid gap-4 p-5 md:grid-cols-[240px_1fr]">
            <ol className="space-y-1">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <button onClick={() => setStep(i)} className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition', step === i ? 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-200' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs dark:bg-slate-800">{i + 1}</span>
                    <s.icon className="h-4 w-4" />
                    {s.title}
                  </button>
                </li>
              ))}
            </ol>
            <div className="rounded-xl border border-slate-200 p-5 dark:border-slate-800">
              {(() => {
                const S = STEPS[step];
                return (
                  <>
                    <div className="mb-2 flex items-center gap-2 text-lg font-semibold">
                      <S.icon className="h-5 w-5 text-brand-600" /> {step + 1}. {S.title}
                    </div>
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{S.text}</p>
                    {S.live && <Badge color="brand" className="mt-3">Your collection: {S.live}</Badge>}
                  </>
                );
              })()}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={HelpCircle} title="What kind of AI solution is this?" subtitle="A RAG-based AI solution (retrieval-augmented generation)." />
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
          <CardHeader icon={Lightbulb} title="Which options should I choose?" />
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {GUIDE.map(([goal, how, tags]) => (
              <div key={goal} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                <span className="w-48 font-medium">{goal}</span>
                <TagBadges tags={tags} />
                <span className="flex-1 text-slate-600 dark:text-slate-300">{how}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Scale} title="Reading the evaluation" />
          <ul className="list-disc space-y-1.5 px-10 py-5 text-sm text-slate-600 dark:text-slate-300">
            <li><b>Groundedness (1–5)</b> — judge: is every claim supported by the retrieved passages? Detects hallucination.</li>
            <li><b>Relevance (1–5)</b> — judge: does the answer cover every part of the question?</li>
            <li><b>Context relevance (1–5)</b> — judge: did retrieval find the needed information? Low = a retrieval problem, not an LLM problem.</li>
            <li><b>Claim support</b> — judge-free: share of answer sentences whose words appear in a retrieved passage. Reproducible, no self-evaluation bias.</li>
            <li><b>Citation validity</b> — share of cited pages that were actually retrieved (catches invented citations).</li>
            <li><b>Context used</b> — share of retrieved passages the answer cites. Low = k could be smaller (faster, cheaper).</li>
            <li><b>Answer ↔ question similarity</b> — embedding similarity; low values flag off-topic answers.</li>
            <li><b>Confidence</b> — High / Medium / Low combination of the above, with reasons.</li>
            <li><b>Hit@k, recall@k, MRR</b> (Evaluation Lab) — with expected pages per question: was the right page retrieved, and how high?</li>
            <li><b>Timing</b> — every step (rewrite, embedding, search, rerank, generation with time-to-first-token, evaluation) is measured.</li>
            <li>Groundedness is measured against the retrieved passages, not the truth — always open the cited pages for important decisions.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
