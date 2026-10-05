// Domain presets: the app works for any document; a preset only tunes the assistant's
// role, answer style, judge wording and disclaimer. "General" is the default.

export const PRESETS = {
  general: {
    label: 'General',
    role: 'You are a precise research assistant.',
    style: 'Use short headings and bullet points when the answer has several parts.',
    domain: '',
    disclaimer: '',
  },
  medical: {
    label: 'Medical / clinical',
    role: 'You are a clinical decision-support assistant for doctors.',
    style: 'Use short headings and bullet points (e.g. symptoms, causes, diagnosis, treatment, precautions, recovery).',
    domain: ' in medicine',
    disclaimer: '\n- This is decision support for clinicians, not a substitute for clinical judgement.',
    sampleQuestions: [
      'What is the protocol for managing sepsis in a critical care unit?',
      'What are the common symptoms for appendicitis, and can it be cured via medicine? If not, what surgical procedure should be followed to treat it?',
      'What are the effective treatments or solutions for addressing sudden patchy hair loss, commonly seen as localized bald spots on the scalp, and what could be the possible causes behind it?',
      'What treatments are recommended for a person who has sustained a physical injury to brain tissue, resulting in temporary or permanent impairment of brain function?',
      'What are the necessary precautions and treatment steps for a person who has fractured their leg during a hiking trip, and what should be considered for their care and recovery?',
    ],
    // Results recorded in the Colab notebook (Mistral-7B Q4 judge, gte-large + ChromaDB, Merck Manual).
    reference: [
      { approach: 'Vanilla LLM', groundedness: 3.6, relevance: 5.0, latency: 6.7, truncated: '5/5' },
      { approach: 'Prompt-engineered (PE1)', groundedness: 4.4, relevance: 5.0, latency: 14.7, truncated: '1/5' },
      { approach: 'RAG C1 baseline (k=3)', groundedness: 5.0, relevance: 5.0, latency: 11.8, truncated: '0/5' },
      { approach: 'RAG C2 higher recall (k=5)', groundedness: 4.6, relevance: 4.6, latency: 15.3, truncated: '0/5' },
      { approach: 'RAG C3 strict precision (k=2)', groundedness: 5.0, relevance: 5.0, latency: 13.3, truncated: '1/5' },
      { approach: 'RAG C4 MMR (k=4)', groundedness: 4.8, relevance: 5.0, latency: 16.4, truncated: '1/5' },
      { approach: 'RAG C5 creative (temp=0.7)', groundedness: 5.0, relevance: 5.0, latency: 11.9, truncated: '0/5' },
    ],
  },
  legal: {
    label: 'Legal / policy',
    role: 'You are a careful legal and policy research assistant.',
    style: 'Quote the operative wording where it matters and name the clause or section it comes from.',
    domain: ' for legal and policy documents',
    disclaimer: '\n- This is research support, not legal advice.',
  },
  technical: {
    label: 'Technical / manual',
    role: 'You are a technical support engineer who explains documentation precisely.',
    style: 'Give step-by-step instructions as numbered lists and keep exact names of settings, commands and parts.',
    domain: ' for technical documentation',
    disclaimer: '',
  },
  academic: {
    label: 'Academic / research',
    role: 'You are a research assistant summarising academic papers.',
    style: 'State findings, methods and limitations separately, and keep the authors’ terminology.',
    domain: ' for academic papers',
    disclaimer: '',
  },
  finance: {
    label: 'Finance / reports',
    role: 'You are a financial analyst assistant.',
    style: 'Report figures exactly as written, with their period and unit.',
    domain: ' for financial documents',
    disclaimer: '\n- This is information, not investment advice.',
  },
};

export const preset = (id) => PRESETS[id] || PRESETS.general;
