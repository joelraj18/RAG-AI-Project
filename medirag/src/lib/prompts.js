// Prompts carried over from the Colab notebook (NLP_RAG_Project_Assignment_MA).
// The manual name is templated so any uploaded manual works, not only the Merck Manual.

export const DEFAULT_QNA_SYSTEM = `You are a clinical decision-support assistant for doctors. You answer questions using ONLY the excerpts from {manual} given in the ###Context section.
Instructions:
- Base every statement strictly on the context. Do not add facts, drugs or doses that are not in the context.
- Address every part of the question, using short headings and bullet points (e.g. symptoms, causes, treatment, surgery, precautions, recovery).
- After each key point, cite the source page in brackets, e.g. [PDF p. 851].
- If the context does not contain the answer, reply exactly: "The provided manual excerpts do not contain enough information to answer this question."
- This is decision support for clinicians, not a substitute for clinical judgement.`;

export const QNA_USER_TEMPLATE = `###Context
{context}

###Question
{question}`;

export const VANILLA_SYSTEM = `You are a helpful medical assistant. Answer the question clearly and concisely.`;

export const GROUNDEDNESS_SYSTEM = `You are a strict medical fact-checker evaluating the output of a retrieval-augmented system.
You will receive a ###Question, a ###Context (excerpts from a medical manual) and an ###Answer.
Judge ONLY whether each claim in the ###Answer is supported by the ###Context. Do not use your own medical knowledge: a claim that is true in general but absent from the context counts as unsupported.
Scoring rubric:
5 - Every claim is directly supported by the context.
4 - Almost all claims are supported; only minor details are not.
3 - Some important claims are supported, but others are not found in the context.
2 - Most claims are not supported by the context.
1 - The answer is not supported by the context at all, or contradicts it.
Respond in exactly this format:
Score: <1-5>
Justification: <2-3 sentences naming any unsupported claims>`;

export const RELEVANCE_SYSTEM = `You are an expert clinical reviewer evaluating the output of a question-answering system.
You will receive a ###Question, a ###Context and an ###Answer.
Judge how directly and completely the ###Answer addresses EVERY part of the ###Question (questions may have several parts, e.g. symptoms, treatment and surgery). Ignore style; focus on coverage and focus.
Scoring rubric:
5 - Addresses every part of the question directly and completely.
4 - Addresses all main parts, with minor gaps.
3 - Addresses the question only partially; an important part is missing.
2 - Mostly off-topic, only touches the question.
1 - Does not address the question.
Respond in exactly this format:
Score: <1-5>
Justification: <2-3 sentences naming any part of the question that is missing>`;

export const JUDGE_USER_TEMPLATE = `###Question
{question}

###Context
{context}

###Answer
{answer}`;

export const FALLBACK_ANSWER =
  'The provided manual excerpts do not contain enough information to answer this question.';

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// The five business questions from the notebook.
export const NOTEBOOK_QUESTIONS = [
  'What is the protocol for managing sepsis in a critical care unit?',
  'What are the common symptoms for appendicitis, and can it be cured via medicine? If not, what surgical procedure should be followed to treat it?',
  'What are the effective treatments or solutions for addressing sudden patchy hair loss, commonly seen as localized bald spots on the scalp, and what could be the possible causes behind it?',
  'What treatments are recommended for a person who has sustained a physical injury to brain tissue, resulting in temporary or permanent impairment of brain function?',
  'What are the necessary precautions and treatment steps for a person who has fractured their leg during a hiking trip, and what should be considered for their care and recovery?',
];

// Results recorded in the Colab run (Mistral-7B Q4 judge on a T4), shown for reference in the Evaluation Lab.
export const NOTEBOOK_REFERENCE = [
  { approach: 'Vanilla LLM', groundedness: 3.6, relevance: 5.0, latency: 6.7, truncated: '5/5' },
  { approach: 'Prompt-engineered (PE1)', groundedness: 4.4, relevance: 5.0, latency: 14.7, truncated: '1/5' },
  { approach: 'RAG C1 baseline (k=3)', groundedness: 5.0, relevance: 5.0, latency: 11.8, truncated: '0/5' },
  { approach: 'RAG C2 higher recall (k=5)', groundedness: 4.6, relevance: 4.6, latency: 15.3, truncated: '0/5' },
  { approach: 'RAG C3 strict precision (k=2)', groundedness: 5.0, relevance: 5.0, latency: 13.3, truncated: '1/5' },
  { approach: 'RAG C4 MMR (k=4)', groundedness: 4.8, relevance: 5.0, latency: 16.4, truncated: '1/5' },
  { approach: 'RAG C5 creative (temp=0.7)', groundedness: 5.0, relevance: 5.0, latency: 11.9, truncated: '0/5' },
];
