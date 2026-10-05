import { retrieve, formatContext } from './retrieve.js';
import { generate, extractiveAnswer } from './llm.js';
import { heuristicEvaluation, parseScore, parseJustification } from './evaluate.js';
import {
  DEFAULT_QNA_SYSTEM,
  QNA_USER_TEMPLATE,
  VANILLA_SYSTEM,
  GROUNDEDNESS_SYSTEM,
  RELEVANCE_SYSTEM,
  JUDGE_USER_TEMPLATE,
  fill,
} from './prompts.js';
import { uid } from './text.js';

// One question -> retrieve -> generate -> evaluate, with a timing for every step.
// `onUpdate` receives the growing record so the UI can stream the answer and the
// evaluation panel live.

function retrievalQuery(question, history) {
  const prev = [...(history || [])].reverse().find((m) => m.question)?.question;
  const short = question.split(/\s+/).length < 12;
  const anaphora = /\b(it|this|that|they|them|those|these|its|their|the condition|the disease)\b/i.test(question);
  return prev && short && anaphora ? `${prev} ${question}` : question;
}

function historyMessages(history, n = 2) {
  return (history || [])
    .filter((m) => m.answer && !m.error)
    .slice(-n)
    .flatMap((m) => [
      { role: 'user', content: m.question },
      { role: 'assistant', content: m.answer.length > 700 ? m.answer.slice(0, 700) + '…' : m.answer },
    ]);
}

export async function judge(settings, { question, context, answer, signal }) {
  const input = fill(JUDGE_USER_TEMPLATE, { question, context, answer });
  const run = async (system) => {
    const t0 = performance.now();
    const r = await generate(settings, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input },
      ],
      maxTokens: settings.judgeMaxTokens,
      temperature: 0,
      topP: 0.95,
      signal,
    });
    return { score: parseScore(r.text), justification: parseJustification(r.text), raw: r.text, ms: performance.now() - t0 };
  };
  const t0 = performance.now();
  let g;
  let rel;
  if (settings.provider === 'browser') {
    g = await run(GROUNDEDNESS_SYSTEM);
    rel = await run(RELEVANCE_SYSTEM);
  } else {
    [g, rel] = await Promise.all([run(GROUNDEDNESS_SYSTEM), run(RELEVANCE_SYSTEM)]);
  }
  return { groundedness: g, relevance: rel, ms: performance.now() - t0 };
}

async function rewriteQuery(settings, question, signal) {
  const r = await generate(settings, {
    messages: [
      {
        role: 'system',
        content:
          'Rewrite the user question as a short search query for a medical textbook index. Use precise clinical terminology (disease names, procedures). Output only the query.',
      },
      { role: 'user', content: question },
    ],
    maxTokens: 48,
    temperature: 0,
    topP: 0.95,
    signal,
  });
  return r.text.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '');
}

/**
 * Run one question.
 * cfg overrides settings for a single run (used by the Evaluation Lab):
 *   { mode, k, fetchK, lambda, temperature, maxTokens, vanilla, judge, corrective }
 */
export async function runQuestion({ question, manual, kb, settings, history = [], cfg = {}, onUpdate, signal }) {
  const c = {
    mode: settings.retrievalMode,
    k: settings.k,
    fetchK: settings.fetchK,
    lambda: settings.mmrLambda,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    topP: settings.topP,
    vanilla: false,
    judge: settings.judgeEnabled,
    corrective: settings.corrective,
    ...cfg,
  };
  const rec = {
    id: uid(),
    createdAt: Date.now(),
    question,
    kind: c.vanilla ? 'vanilla' : 'rag',
    provider: settings.provider,
    model:
      settings.provider === 'hf'
        ? settings.hfModel
        : settings.provider === 'openai'
          ? settings.openaiModel
          : settings.provider === 'browser'
            ? settings.browserModel
            : 'extractive',
    config: { mode: c.mode, k: c.k, temperature: c.temperature, maxTokens: c.maxTokens, embedModel: manual.embedModel },
    phase: 'retrieving',
    answer: '',
    sources: [],
    timings: {},
    attempts: [],
  };
  const tStart = performance.now();
  const emit = () => onUpdate?.({ ...rec, timings: { ...rec.timings } });
  emit();

  const llmAvailable = settings.provider !== 'extractive';

  async function attempt(searchQuery, k, mode) {
    // 1. retrieval (always performed; vanilla answers are judged against the same context, as in the notebook)
    const r = await retrieve(kb, manual, searchQuery, { mode, k, fetchK: c.fetchK, lambda: c.lambda });
    rec.sources = r.sources;
    rec.effectiveMode = r.effectiveMode;
    rec.timings.queryEmbed = (rec.timings.queryEmbed || 0) + r.timings.embedMs;
    rec.timings.search = (rec.timings.search || 0) + r.timings.searchMs;
    rec.phase = 'generating';
    rec.answer = '';
    emit();

    // 2. generation
    const context = formatContext(r.sources);
    let g;
    const tGen = performance.now();
    if (!llmAvailable) {
      g = extractiveAnswer(question, r.sources);
      rec.answer = g.text;
    } else {
      const system = c.vanilla
        ? VANILLA_SYSTEM
        : fill(settings.systemPrompt || DEFAULT_QNA_SYSTEM, { manual: manual.title || manual.name });
      const user = c.vanilla ? question : fill(QNA_USER_TEMPLATE, { context, question });
      g = await generate(settings, {
        messages: [{ role: 'system', content: system }, ...historyMessages(history), { role: 'user', content: user }],
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
    rec.timings.generation = (rec.timings.generation || 0) + (performance.now() - tGen);
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

    // 3. evaluation
    const tEval = performance.now();
    const heuristic = heuristicEvaluation({ question, answer: rec.answer, sources: r.sources });
    rec.eval = { heuristic, judge: null };
    emit();
    if (c.judge && llmAvailable) {
      try {
        rec.eval.judge = await judge(settings, { question, context, answer: rec.answer, signal });
      } catch (e) {
        rec.eval.judgeError = String(e.message || e);
      }
    }
    rec.timings.evaluation = (rec.timings.evaluation || 0) + (performance.now() - tEval);
    return { query: searchQuery, k, mode: r.effectiveMode, answer: rec.answer, eval: rec.eval, sources: r.sources, gen: rec.gen };
  }

  try {
    const q0 = retrievalQuery(question, history);
    let a = await attempt(q0, c.k, c.mode);
    rec.attempts.push(summarizeAttempt(a));

    // 4. corrective RAG: if the answer looks weakly grounded, rewrite the query and retry once
    if (c.corrective && !c.vanilla && needsCorrection(a)) {
      rec.phase = 'correcting';
      emit();
      const q1 = llmAvailable ? await rewriteQuery(settings, question, signal).catch(() => q0) : q0;
      const prev = { ...rec, timings: rec.timings };
      const b = await attempt(q1 || q0, c.k + 2, 'hybrid');
      rec.attempts.push(summarizeAttempt(b));
      if (qualityOf(b) < qualityOf(a)) {
        // keep the better first attempt
        Object.assign(rec, { answer: prev.answer, sources: a.sources, eval: a.eval, gen: a.gen });
        rec.attempts[1].kept = false;
      } else {
        rec.attempts[1].kept = true;
      }
    }
    rec.phase = 'done';
  } catch (e) {
    rec.phase = 'error';
    rec.error = e.name === 'AbortError' ? 'Stopped.' : String(e.message || e);
  }
  rec.timings.total = performance.now() - tStart;
  emit();
  return rec;
}

function qualityOf(a) {
  const j = a.eval?.judge?.groundedness?.score;
  const h = a.eval?.heuristic?.support?.score ?? 0;
  return (a.eval?.heuristic?.fallback ? -2 : 0) + (j ?? h);
}

function needsCorrection(a) {
  const h = a.eval?.heuristic;
  const j = a.eval?.judge?.groundedness?.score;
  return h?.fallback || (j != null && j <= 3) || (h?.support?.share ?? 1) < 0.5;
}

function summarizeAttempt(a) {
  return {
    query: a.query,
    k: a.k,
    mode: a.mode,
    pages: [...new Set(a.sources.map((s) => s.page))],
    groundedness: a.eval?.judge?.groundedness?.score ?? null,
    support: a.eval?.heuristic?.support?.share ?? null,
    fallback: a.eval?.heuristic?.fallback,
  };
}
