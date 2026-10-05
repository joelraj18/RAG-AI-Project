// Prompt templates. The grounding rules come from the Colab notebook, generalised to any
// document set; the domain preset (presets.js) contributes role, style and disclaimer.

export const FALLBACK_ANSWER = 'The provided document excerpts do not contain enough information to answer this question.';

export const QNA_SYSTEM = `{role} You answer questions using ONLY the excerpts from {documents} given in the ###Context section.
Instructions:
- Base every statement strictly on the context. Do not add facts, numbers or names that are not in the context.
- Address every part of the question. {style}
- After each key point, cite its source exactly as labelled in the context, e.g. [{cite}].
- If the context does not contain the answer, reply exactly: "${FALLBACK_ANSWER}"{disclaimer}`;

export const QNA_USER_TEMPLATE = `###Context
{context}

###Question
{question}`;

export const VANILLA_SYSTEM = 'You are a helpful assistant. Answer the question clearly and concisely.';

export const GROUNDEDNESS_SYSTEM = `You are a strict fact-checker evaluating the output of a retrieval-augmented system{domain}.
You will receive a ###Question, a ###Context (excerpts from documents) and an ###Answer.
Judge ONLY whether each claim in the ###Answer is supported by the ###Context. Do not use your own knowledge: a claim that is true in general but absent from the context counts as unsupported.
Scoring rubric:
5 - Every claim is directly supported by the context.
4 - Almost all claims are supported; only minor details are not.
3 - Some important claims are supported, but others are not found in the context.
2 - Most claims are not supported by the context.
1 - The answer is not supported by the context at all, or contradicts it.
Respond in exactly this format:
Score: <1-5>
Justification: <2-3 sentences naming any unsupported claims>`;

export const RELEVANCE_SYSTEM = `You are an expert reviewer evaluating the output of a question-answering system{domain}.
You will receive a ###Question, a ###Context and an ###Answer.
Judge how directly and completely the ###Answer addresses EVERY part of the ###Question. Ignore style; focus on coverage and focus.
Scoring rubric:
5 - Addresses every part of the question directly and completely.
4 - Addresses all main parts, with minor gaps.
3 - Addresses the question only partially; an important part is missing.
2 - Mostly off-topic, only touches the question.
1 - Does not address the question.
Respond in exactly this format:
Score: <1-5>
Justification: <2-3 sentences naming any part of the question that is missing>`;

// One call instead of two (about half the evaluation time), also scoring the retrieval.
export const COMBINED_JUDGE_SYSTEM = `You are a strict evaluator of a retrieval-augmented question-answering system{domain}.
You receive a ###Question, a ###Context (retrieved document excerpts) and an ###Answer. Score on 1-5 scales:
- groundedness: are ALL claims in the Answer supported by the Context? (5 = every claim supported, 3 = some important claims unsupported, 1 = unsupported or contradicted). Do not use outside knowledge.
- relevance: does the Answer address EVERY part of the Question? (5 = completely, 3 = an important part missing, 1 = off-topic)
- context_relevance: does the Context contain the information needed to answer the Question? (5 = fully, 3 = partially, 1 = not at all)
Reply with JSON only, no prose:
{"groundedness": <1-5>, "relevance": <1-5>, "context_relevance": <1-5>, "unsupported_claims": ["..."], "missing_parts": ["..."], "justification": "<2 sentences>"}`;

export const JUDGE_USER_TEMPLATE = `###Question
{question}

###Context
{context}

###Answer
{answer}`;

export const CONDENSE_SYSTEM =
  'Rewrite the latest user question as one standalone question that can be understood without the conversation. Keep all specifics. Output only the question.';

export const REWRITE_SYSTEM =
  'Rewrite the user question as a short search query for the document index. Use the precise technical terms a reference text would use. Output only the query.';

export const HYDE_SYSTEM =
  'Write a short, factual passage (3-4 sentences) that would answer the question, in the style of a reference document. Output only the passage.';

export const SUGGEST_SYSTEM =
  'You write exam-style questions. Given section titles and an excerpt from a document, write 5 diverse, specific questions that the document can answer. One per line, no numbering.';

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
