import { retrieve, formatContext, contextTokens, sourceLabel } from './retrieve.js';
import { generate, extractiveAnswer } from './llm.js';
import { heuristicEvaluation, parseScore, parseJustification, parseCombinedJudge, confidence } from './evaluate.js';
import {
  QNA_SYSTEM,
  QNA_USER_TEMPLATE,
  VANILLA_SYSTEM,
  GROUNDEDNESS_SYSTEM,
  RELEVANCE_SYSTEM,
  COMBINED_JUDGE_SYSTEM,
  JUDGE_USER_TEMPLATE,
  CONDENSE_SYSTEM,
  REWRITE_SYSTEM,
  HYDE_SYSTEM,
  SUGGEST_SYSTEM,
  fill,
} from './prompts.js';
import { preset } from './presets.js';
import { embedQuery } from './workers.js';
import { cosine } from './quant.js';
import { vectorsReady } from './kb.js';
import { uid } from './text.js';

// One question -> (condense) -> (HyDE) -> retrieve -> (rerank) -> generate -> evaluate.
// Every step is timed; `onUpdate` receives the growing record so the UI streams live.

export const modelName = (s) =>
  s.provider === 'hf' ? s.hfModel : s.provider === 'openai' ? s.openaiModel : s.provider === 'browser' ? s.browserModel : 'extractive';

export function systemPrompt(settings, docNames) {
  const p = preset(settings.preset);
  const docs = docNames.length === 1 ? `"${docNames[0]}"` : `these documents: ${docNames.map((n) => `"${n}"`).join(', ')}`;
  const base = settings.customPrompt?.trim() ? settings.customPrompt : QNA_SYSTEM;
  return fill(base, { role: p.role, style: p.style, disclaimer: p.disclaimer, documents: docs, cite: `${docNames[0] || 'Document'} p. 12` });
}

function historyMessages(history, n = 2) {
  return (history || [])
    .filter((m) => m?.answer && !m.error)
    .slice(-n)
    .flatMap((m) => [
      { role: 'user', content: m.question },
      { role: 'assistant', content: m.answer.length > 600 ? m.answer.slice(0, 600) + '…' : m.answer },
    ]);
}

/** The exact messages sent to the LLM (also used to rebuild the Prompt tab for saved answers). */
export function buildMessages(settings, docNames, sources, question, history, vanilla) {
  if (vanilla) return [{ role: 'system', content: VANILLA_SYSTEM }, { role: 'user', content: question }];
  return [
    { role: 'system', content: systemPrompt(settings, docNames) },
    ...historyMessages(history),
    { role: 'user', content: fill(QNA_USER_TEMPLATE, { context: formatContext(sources), question }) },
  ];
}

function heuristicStandalone(question, history) {
  const prev = [...(history || [])].reverse().find((m) => m?.question)?.question;
  const short = question.split(/\s+/).length < 12;
  const anaphora = /\b(it|this|that|they|them|those|these|its|their|the same|above)\b/i.test(question);
  return prev && short && anaphora ? `${prev} ${question}` : question;
}

async function llmText(settings, system, user, maxTokens, signal) {
  const r = await generate(settings, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens,
    temperature: 0,
    topP: 0.95,
    signal,
  });
  return r.text.trim();
}

export async function judge(settings, { question, context, answer, signal }) {
  const domain = preset(settings.preset).domain;
  const input = fill(JUDGE_USER_TEMPLATE, { question, context, answer });
  const t0 = performance.now();
  if (settings.judgeMode === 'strict') {
    const run = (sys) => llmText(settings, fill(sys, { domain }), input, settings.judgeMaxTokens, signal);
    const [g, r] =
      settings.provider === 'browser'
        ? [await run(GROUNDEDNESS_SYSTEM), await run(RELEVANCE_SYSTEM)]
        : await Promise.all([run(GROUNDEDNESS_SYSTEM), run(RELEVANCE_SYSTEM)]);
    return {
      mode: 'strict',
      calls: 2,
      groundedness: parseScore(g),
      relevance: parseScore(r),
      contextRelevance: null,
      justification: { groundedness: parseJustification(g), relevance: parseJustification(r) },
      unsupported: [],
      missing: [],
      ms: performance.now() - t0,
    };
  }
  const raw = await llmText(settings, fill(COMBINED_JUDGE_SYSTEM, { domain }), input, Math.max(220, settings.judgeMaxTokens), signal);
  const j = parseCombinedJudge(raw);
  return { mode: 'combined', calls: 1, ...j, justification: { overall: j.justification }, raw, ms: performance.now() - t0 };
}

/** Five starter questions for a document: LLM-written when available, else from section titles. */
export async function suggestQuestions(settings, doc, kb) {
  const sections = [...new Set(kb.chunks.map((c) => c.section).filter((s) => s && s.length > 3 && s.length < 70))];
  if (settings.provider !== 'extractive') {
    try {
      const sample = kb.chunks[Math.floor(kb.chunks.length / 3)]?.text.slice(0, 1200) || '';
      const text = await llmText(settings, SUGGEST_SYSTEM, `Document: ${doc.name}\nSection titles: ${sections.slice(0, 25).join('; ')}\n\nExcerpt:\n${sample}`, 220);
      const qs = text.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.endsWith('?'));
      if (qs.length >= 3) return qs.slice(0, 5);
    } catch {
      /* fall back to section titles */
    }
  }
  const step = Math.max(1, Math.floor(sections.length / 5));
  return sections
    .filter((_, i) => i % step === 0)
    .slice(0, 5)
    .map((s) => (s.trim().endsWith('?') ? s.trim() : `What does ${doc.name} say about ${s.replace(/^(step|chapter|section)\s*\d+[:.]?\s*/i, '').replace(/[:.]$/, '')}?`));
}

/**
 * Run one question over a set of documents: sets = [{ doc, kb }].
 * cfg overrides settings for a single run (Evaluation Lab):
 *   { mode, k, temperature, maxTokens, vanilla, judgeMode, corrective, rerank, retrievalOnly }
 */
export async function runQuestion({ question, sets, settings, history = [], cfg = {}, onUpdate, signal }) {
  const c = {
    mode: settings.retrievalMode,
    k: settings.k,
    fetchK: settings.fetchK,
    lambda: settings.mmrLambda,
    rerank: settings.rerank,
    neighbors: settings.neighbors,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    topP: settings.topP,
    vanilla: false,
    judgeMode: settings.judgeMode,
    corrective: settings.corrective,
    retrievalOnly: false,
    ...cfg,
  };
  const llm = settings.provider !== 'extractive';
  const judgeOn = llm && c.judgeMode !== 'off' && !c.retrievalOnly;
  const docNames = sets.map((s) => s.doc.name);
  const rec = {
    id: uid(),
    createdAt: Date.now(),
    question,
    kind: c.vanilla ? 'vanilla' : 'rag',
    provider: settings.provider,
    model: modelName(settings),
    preset: settings.preset,
    docIds: sets.map((s) => s.doc.id),
    config: { mode: c.mode, k: c.k, rerank: c.rerank, neighbors: c.neighbors, temperature: c.temperature, maxTokens: c.maxTokens, judgeMode: judgeOn ? c.judgeMode : 'off' },
    phase: 'retrieving',
    answer: '',
    sources: [],
    timings: {},
    trace: {},
    attempts: [],
  };
  const tStart = performance.now();
  const emit = () => onUpdate?.({ ...rec, timings: { ...rec.timings } });
  const add = (k, ms) => (rec.timings[k] = (rec.timings[k] || 0) + (ms || 0));
  emit();

  async function attempt(searchQuery, k, mode, semanticQuery) {
    const r = await retrieve(sets, searchQuery, { mode, k, fetchK: c.fetchK, lambda: c.lambda, useRerank: c.rerank, neighbors: c.neighbors, contextBudget: settings.contextBudget, semanticQuery });
    Object.entries(r.timings).forEach(([key, ms]) => add(key, ms));
    Object.assign(rec, { sources: r.sources, effectiveMode: r.effectiveMode });
    rec.trace.retrieval = r.trace;
    rec.trace.searchQuery = searchQuery;
    rec.trace.contextTokens = contextTokens(r.sources);
    if (r.rerankError) rec.trace.rerankError = r.rerankError;
    rec.phase = c.retrievalOnly ? 'done' : 'generating';
    rec.answer = '';
    emit();
    if (c.retrievalOnly) return { query: searchQuery, k, mode: r.effectiveMode, sources: r.sources };

    const tGen = performance.now();
    let g;
    if (!llm) {
      g = extractiveAnswer(question, r.sources);
      rec.answer = g.text;
    } else {
      const messages = buildMessages(settings, docNames, r.sources, question, history, c.vanilla);
      rec.prompt = messages;
      g = await generate(settings, {
        messages,
        maxTokens: c.maxTokens,
        temperature: c.temperature,
        topP: c.topP,
        signal,
        onToken: (text) => {
          rec.answer = text;
          emit();
        },
      });
      rec.answer = g.text;
    }
    add('generation', performance.now() - tGen);
    rec.timings.ttft = g.ttftMs;
    rec.gen = {
      promptTokens: g.promptTokens,
      completionTokens: g.completionTokens,
      tokensEstimated: g.tokensEstimated,
      finishReason: g.finishReason,
      truncated: g.finishReason === 'length',
      tokensPerSec: !g.extractive && g.completionTokens && g.latencyMs > 50 ? g.completionTokens / (g.latencyMs / 1000) : null,
    };
    rec.phase = 'evaluating';
    emit();

    const tEval = performance.now();
    const heuristic = heuristicEvaluation({ question, answer: rec.answer, sources: r.sources });
    rec.eval = { heuristic, judge: null };
    // answer ↔ question semantic similarity (RAGAS-style answer relevance), free when embeddings exist
    const embedSet = sets.find((s) => vectorsReady(s.doc, s.kb));
    if (embedSet && rec.answer) {
      try {
        const [qa, an] = await Promise.all([embedQuery(embedSet.doc.embedModel, question), embedQuery(embedSet.doc.embedModel, rec.answer.slice(0, 1500))]);
        heuristic.answerSimilarity = cosine(qa, an);
      } catch {
        /* embeddings unavailable – skip */
      }
    }
    emit();
    if (judgeOn) {
      try {
        rec.eval.judge = await judge(settings, { question, context: formatContext(r.sources), answer: rec.answer, signal });
      } catch (e) {
        rec.eval.judgeError = String(e.message || e);
      }
    }
    add('evaluation', performance.now() - tEval);
    return { query: searchQuery, k, mode: r.effectiveMode, answer: rec.answer, eval: rec.eval, sources: r.sources, gen: rec.gen, prompt: rec.prompt };
  }

  try {
    // 1. standalone question for follow-ups
    let q0 = heuristicStandalone(question, history);
    if (llm && settings.condense && history.some((m) => m?.answer)) {
      const t0 = performance.now();
      const ctx = historyMessages(history).map((m) => `${m.role}: ${m.content}`).join('\n');
      q0 = (await llmText(settings, CONDENSE_SYSTEM, `${ctx}\nuser: ${question}`, 80, signal).catch(() => q0)) || q0;
      add('condense', performance.now() - t0);
      rec.trace.standalone = q0;
    }
    // 2. HyDE: embed a hypothetical answer passage instead of the bare question
    let semanticQuery;
    if (llm && settings.hyde && !c.vanilla) {
      const t0 = performance.now();
      const passage = await llmText(settings, HYDE_SYSTEM, q0, 160, signal).catch(() => '');
      add('hyde', performance.now() - t0);
      if (passage) {
        semanticQuery = `${q0}\n${passage}`;
        rec.trace.hyde = passage;
      }
    }
    const a = await attempt(q0, c.k, c.mode, semanticQuery);
    rec.attempts.push(summarize(a));

    // 3. corrective RAG: weak grounding -> rewrite the query, widen retrieval, keep the better answer
    if (c.corrective && !c.vanilla && !c.retrievalOnly && needsCorrection(a)) {
      rec.phase = 'correcting';
      emit();
      const t0 = performance.now();
      const q1 = llm ? await llmText(settings, REWRITE_SYSTEM, question, 48, signal).catch(() => q0) : q0;
      add('condense', performance.now() - t0);
      const b = await attempt(q1 || q0, c.k + 2, 'hybrid');
      const keepB = quality(b) >= quality(a);
      rec.attempts.push({ ...summarize(b), kept: keepB });
      if (!keepB) Object.assign(rec, { answer: a.answer, sources: a.sources, eval: a.eval, gen: a.gen, prompt: a.prompt });
    }
    if (rec.eval) rec.eval.confidence = confidence(rec.eval, rec.sources);
    rec.phase = 'done';
  } catch (e) {
    rec.phase = 'error';
    rec.error = e.name === 'AbortError' ? 'Stopped.' : String(e.message || e);
  }
  rec.timings.total = performance.now() - tStart;
  emit();
  return rec;
}

const quality = (a) => (a.eval?.heuristic?.fallback ? -2 : 0) + (a.eval?.judge?.groundedness ?? a.eval?.heuristic?.support?.score ?? 0);

function needsCorrection(a) {
  const h = a.eval?.heuristic;
  const j = a.eval?.judge?.groundedness;
  return h?.fallback || (j != null && j <= 3) || (h?.support?.share ?? 1) < 0.5;
}

function summarize(a) {
  return {
    query: a.query,
    k: a.k,
    mode: a.mode,
    refs: [...new Set(a.sources.filter((s) => !s.neighbor).map(sourceLabel))],
    groundedness: a.eval?.judge?.groundedness ?? null,
    support: a.eval?.heuristic?.support?.share ?? null,
    fallback: a.eval?.heuristic?.fallback,
  };
}

/** Saved records keep chunk references only; text is looked up again when displayed. */
export function slimRecord(rec) {
  if (!rec) return rec;
  const { prompt: _prompt, ...rest } = rec;
  return { ...rest, sources: rec.sources.map(({ text: _t, ...s }) => s) };
}

/** Re-attach chunk text to saved sources from the loaded knowledge bases. */
export function hydrateRecord(rec, kbOf) {
  if (!rec?.sources?.length || rec.sources[0].text != null) return rec;
  return {
    ...rec,
    sources: rec.sources.map((s) => ({ ...s, text: kbOf(s.docId)?.chunks[s.idx]?.text ?? '(document no longer available)' })),
  };
}

