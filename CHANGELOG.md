# Changelog

Notable changes, newest first. The numbers come from the benchmark in `bench/` (every result file is in
`bench/results/`). **Held-out** means data that was never used to choose a setting; changes were kept only when they
held up there. The README's [Performance](README.md#performance-before-and-after) section explains how everything was
measured.

## 2026-11-13: Performance round 2

Compared with round 1 (`bench/results/round1/` against `bench/results/after/`).

### Changed

- **No-LLM answers keep the sentence that finishes a thought.** When the best sentence is very short, or the next one
  starts with a pronoun ("It was established by ..."), both go in the same bullet. Sentences that repeat the
  question's word pairs in order rank higher, and the cut-off for extra bullets rose from 0.45 to 0.5 of the best
  score, so answers do not grow. Held-out SQuAD half B (2,656 questions):
  - answer in the first bullet 67.0% → **69.3%** (+2.3 points, 95% CI +1.4 to +2.9)
  - answer in the top 3 bullets 79.1% → **80.4%** (+1.3, CI +0.8 to +2.0)
  - answer anywhere 84.4% → 84.9% (+0.5, CI −0.1 to +0.8, within noise)
  - answer length 243 → **233** tokens
- **The claim check reads names and numbers written another way.** Digits glued to a letter (Dscam1, CD4) now belong
  to a name, and a name matches its hyphenated or spaced form in the source (SREBP2 and SREBP-2, BRCA 1 and BRCA1).
  - Held-out SciFact claims: supported claims pass 57.9% → 58.3%, contradicted claims unchanged at 34.4%.
  - Training claims: supported +1.3 points (CI +0.5 to +2.1), contradicted unchanged.
  - Swapped facts caught 60.2% → 60.1%, true sentences still 100%, near misses unchanged at 2.1%.

### Added

- `CHANGELOG.md` (this file).
- Benchmark: an in-browser model comparison suite (`node bench/run.mjs --label models --suites llm`), a near-miss check for the claim
  check (a true sentence tested against another paragraph of the same article), a read-only cache mode, and the RRF
  constant as a `retrieve()` option.

### Measured, not changed

- **RRF constant 3 instead of 60.** Training splits: SQuAD half A right page first 73.8% → 75.1%, SciFact train
  nDCG@10 0.744 → 0.752. Held-out: SQuAD half B +0.1 points, SciFact test +0.4, NFCorpus +0.2, every 95% CI includes
  zero, so the default stays 60.
- **Claim overlap threshold 0.5 instead of 0.6.** On the training claims the gap between supported and contradicted
  pass rates widened (3.6 → 7.8 points), but on held-out claims it narrowed (23.4 → 18.2), because contradicted claims
  passed 16.4 points more often.
- **One shared worker for embeddings and the reranker.** The reranker's first use already takes 525 ms including its
  23.9 MB download (4 vCPU, isolated), so sharing the runtime could save about 0.2 s once per session. Not worth the
  added complexity.

## 2026-11-12: Performance round 1

Compared with `main` before the change (`bench/results/before/` against `bench/results/round1/`).

### Answers and search (held-out data)

| What | Before | After |
|---|---|---|
| Answer in the first bullet (SQuAD, no-LLM answers) | 47.6% | 67.0% (+19.4, CI +17.8 to +21.4) |
| Answer in the top 3 bullets | 74.4% | 79.1% (+4.8, CI +3.7 to +6.3) |
| Keyword search, SciFact nDCG@10 | 0.660 | 0.696 (+3.7, CI +1.6 to +5.8) |
| Hybrid search, SciFact nDCG@10 | 0.716 | 0.747 (+3.0, CI +1.2 to +4.8) |
| Hybrid search, NFCorpus nDCG@10 | 0.357 | 0.366 (+0.9, CI +0.2 to +1.7) |
| Swapped numbers or names caught | 2.1% | 60.2% (true sentences still 100%) |
| Contradicted SciFact claims passed (lower is better) | 50.0% | 34.4% |
| Supported SciFact claims passed | 71.8% | 57.9% (the check became stricter both ways) |
| Right page ranked first (SQuAD) | 76.7% | 76.5% (no change) |

- Tokenizer v2 with an in-house Porter stemmer, accent folding and hyphen handling.
- No-LLM answers: rarity-weighted, best sentence first.
- Claim check: numbers and names must appear in the sources; negation and direction must agree.
- The reranker's order is fused with the search order (it stays off by default).

### Local models (4 vCPU, no GPU; old site as served against the new one)

| What | Before | After | Faster by |
|---|---|---|---|
| First document, cold start | 15.3 s | 4.5 s | 3.4× |
| Indexing | 2.1 chunks/s | 8.7 chunks/s | 4.2× |
| Embedding a question | 37 ms | 15 ms | 2.5× |
| Reranking 20 passages | 3.60 s | 0.95 s | 3.8× |
| In-browser LLM, first token (936-token prompt) | 35.4 s | 9.4 s | 3.8× |
| In-browser LLM, writing speed | 1.1 tokens/s | 3.3 tokens/s | 3.1× |
| In-browser LLM, full answer (median of 8) | 241.5 s | 20.1 s | 12× |

- Cross-origin isolation (Space headers, a service worker on GitHub Pages) and every core for the model workers.
- The plain 14.3 MB WebAssembly runtime instead of the 26.9 MB one on devices without WebGPU (12.6 MB less).
- In-browser defaults: no self-judge pass, 320 new tokens, compact context (the most relevant half of each passage).
- Length-sorted embedding batches, model preloading, honest download sizes, the renamed Llama repository.

### Fixed

- A question asked while a model was still loading started a second copy (twice the download; the in-browser model
  then failed with an out-of-memory error).
- The in-browser model's prompt token count was missing after a change in transformers.js 4.
- Answer similarity embedded the answer as a question (bge-small's search prefix) and filled the question cache.

### Measured, not changed

A lighter stemmer, counting keyword search double, a bigger fusion pool, capping MiniLM at 256 tokens, 5-sentence
answers, letting the reranker set the order alone, and 8-bit Qwen on CPU (2.1× faster writing, but correct short
answers fell from 67.5% to 32.5%). Details in the README.

## 2026-10-05: Earlier work (no benchmark numbers recorded)

- **#4** Claude, DeepSeek and other key providers, a privacy disclosure and Confidential mode, clean copy.
- **#3** Store-style redesign and audit fixes.
- **#2** RAG AI Studio: any-document RAG, efficiency overhaul and richer evaluation; API tokens kept in memory only;
  the Hugging Face experience fixed for free and PRO accounts.
- **#1** MediRAG Studio: in-browser RAG medical assistant with live evaluation.
