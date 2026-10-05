// Built-in demo documents (original text) so the app can be tried without uploading.
// Pages are separated by form-feeds; "## " lines are section headings.

export const RAG_GUIDE_NAME = 'Guide to Retrieval-Augmented Generation';

export const RAG_GUIDE_TEXT = [
  `## What is Retrieval-Augmented Generation?
Retrieval-Augmented Generation (RAG) is a technique that lets a large language model answer questions from a specific set of documents instead of relying only on what it memorised during training. When a question arrives, a retriever first searches the documents for the most relevant passages. Those passages are inserted into the prompt as context, and the language model is instructed to answer using only that context and to cite where each statement came from.
RAG is used when answers must be traceable to a trusted source, when the source changes more often than a model can be retrained, or when the documents are private. Typical examples are company policies, product manuals, legal contracts, research papers and medical reference books.`,
  `## RAG compared with other approaches
A rule-based system answers with hand-written rules or decision trees. It is predictable but only covers the cases its authors anticipated.
A plain language model (a "vanilla LLM") answers from memory. It is fluent but cannot show its sources, may be out of date and can invent plausible-sounding facts, which is called hallucination.
Fine-tuning changes the model's weights with domain examples. It improves style and terminology but is expensive and still does not provide citations.
RAG keeps the model unchanged and supplies evidence at question time, so every answer can be checked against the cited pages.
An AI agent goes further: it plans, decides which tools to call and may loop several times. A RAG pipeline becomes "agentic" when it, for example, evaluates its own answer and retries the search with a rewritten query, which is known as corrective RAG.`,
  `## Step 1: Loading and cleaning documents
Documents are converted to plain text page by page, so every passage keeps its page number for citations. Cleaning removes noise that would otherwise be indexed thousands of times: watermarks, running headers and footers, licence notices and e-mail addresses. A robust approach detects lines that repeat on a large share of pages and removes them automatically.`,
  `## Step 2: Chunking
Long documents are split into chunks small enough to embed and to fit in the prompt. A recursive splitter prefers paragraph boundaries, then line breaks, then sentence ends, so chunks rarely cut a sentence in half. A chunk size of about 400 tokens with an overlap of 50 tokens is a common starting point: large enough to hold a complete sub-section, small enough to stay focused. Attaching the section heading to each chunk helps both keyword and semantic search.`,
  `## Step 3: Embeddings and the vector index
An embedding model converts each chunk into a vector of a few hundred numbers so that passages with similar meaning have similar vectors. Retrieval then compares the question's vector with every chunk vector using cosine similarity. Vectors can be quantised from 32-bit floats to 8-bit integers, which makes the index four times smaller with almost no loss in ranking quality.
Semantic search matches meaning, for example a lay phrase such as "sudden patchy hair loss" to the technical term used in a reference book.`,
  `## Step 4: Retrieval strategies
Keyword search with BM25 scores chunks by how often the question's words occur in them, weighted by how rare those words are. It is instant and excels at exact names, codes and numbers.
Semantic search finds passages with the same meaning even when they use different words.
Hybrid search runs both and merges the two rankings with Reciprocal Rank Fusion, which usually beats either method alone.
Maximal Marginal Relevance (MMR) trades some relevance for diversity so that the context is not filled with near-duplicate passages.
A cross-encoder reranker reads the question and each candidate passage together and re-orders the top candidates. It is slower than embeddings but more accurate, so it is applied only to the top 20 or so results.
The number of passages retrieved, called k, is a key setting: too few misses information, too many dilutes the context and slows the answer.`,
  `## Step 5: Generating a grounded answer
The prompt combines a system instruction, the retrieved passages with their source labels and the user's question. The instruction tells the model to use only the context, to cite the source after each key point and to reply with a fixed fallback sentence when the context does not contain the answer. A temperature of 0 makes answers reproducible. The maximum number of output tokens must be large enough for multi-part questions, otherwise answers are truncated.`,
  `## Step 6: Evaluating answers
Groundedness measures whether every claim in the answer is supported by the retrieved context. It detects hallucination.
Relevance measures whether the answer addresses every part of the question.
Context relevance measures whether retrieval found the information that was needed.
An LLM can act as a judge and score these on a 1 to 5 scale with a short justification, but a model judging its own output tends to be lenient. Judge-free checks complement it: the share of answer sentences whose words appear in the retrieved passages, whether the cited pages were actually retrieved, and the semantic similarity between question and answer.
Retrieval itself is measured with labelled questions: hit rate at k (was a correct page retrieved?), recall at k and mean reciprocal rank.`,
  `## Measuring time and cost
End-to-end latency is the sum of query embedding, search, optional reranking, answer generation and evaluation. Time to first token matters most for perceived speed, because answers stream word by word. Tokens per second describes generation speed. Longer contexts increase both cost and latency, which is why retrieving fewer but better passages is often the fastest way to improve quality.`,
  `## Limitations and good practice
RAG is only as good as its documents: outdated sources produce outdated answers. Groundedness is measured against what was retrieved, not against the truth, so a retrieval miss can still score well. Scanned documents need optical character recognition before they can be indexed. Good practice is to keep humans reviewing a sample of answers, to test retrieval with labelled questions and to show citations so that users can verify every claim.`,
].join('\f');

export const MEDICAL_DEMO_NAME = 'Demo Clinical Handbook (sample)';

export const MEDICAL_DEMO_TEXT = [
  `## Sepsis and Septic Shock
Sepsis is a clinical syndrome of life-threatening organ dysfunction caused by a dysregulated response to infection. Septic shock is sepsis with persistent hypotension that requires vasopressors to maintain a mean arterial pressure of 65 mm Hg or more despite adequate fluid resuscitation.
Symptoms and signs: fever or hypothermia, tachycardia, tachypnea, hypotension, altered mental status, decreased urine output and mottled skin.
Diagnosis: blood cultures should be obtained before antibiotics whenever this does not delay treatment. Serum lactate is measured and repeated if elevated. Cultures of other suspected sites, a chest x-ray and urinalysis help identify the source.`,
  `## Management of sepsis in the critical care unit
Treatment: Early recognition and immediate treatment improve survival.
Fluid resuscitation: give 30 mL/kg of IV crystalloid within the first 3 hours for hypotension or lactate of 4 mmol/L or more, guided by repeated assessment of perfusion.
Antibiotics: start broad-spectrum IV antibiotics within 1 hour of recognition, then narrow therapy when culture results are available.
Source control: drain abscesses, remove infected catheters and debride necrotic tissue as soon as practical.
Vasopressors: norepinephrine is the first-line vasopressor when hypotension persists after fluids; target mean arterial pressure is 65 mm Hg.
Corticosteroids: IV hydrocortisone may be considered when shock persists despite fluids and vasopressors.
Supportive care: oxygen or mechanical ventilation, glucose control, prophylaxis against venous thromboembolism and stress ulcers, and close monitoring of urine output and lactate.`,
  `## Appendicitis
Appendicitis is acute inflammation of the vermiform appendix, usually caused by obstruction of the lumen.
Symptoms and signs: the classic symptoms are epigastric or periumbilical pain followed by nausea, vomiting and anorexia; after a few hours the pain shifts to the right lower quadrant. Tenderness at McBurney's point, low-grade fever and leukocytosis are common.
Diagnosis: clinical evaluation, often supported by CT or ultrasound, especially in children and pregnant women.
Treatment: the standard treatment is surgical removal of the appendix (appendectomy), performed by open or laparoscopic technique, together with IV fluids and antibiotics. Antibiotics alone may resolve selected uncomplicated cases, but recurrence is common, so surgery remains the definitive treatment. If perforation or abscess is present, the abscess is drained and the appendectomy may be delayed.`,
  `## Alopecia Areata
Alopecia areata is sudden patchy hair loss in people with no obvious skin or systemic disorder. It typically appears as round or oval, smooth, well-demarcated bald patches on the scalp.
Causes: it is thought to be an autoimmune disorder in which T cells attack hair follicles. Genetic predisposition is common, and it is associated with other autoimmune conditions such as thyroid disease and vitiligo. Emotional stress or illness may trigger episodes.
Diagnosis: clinical; short broken "exclamation point" hairs at the edge of patches are characteristic.
Treatment: intralesional corticosteroid injections are first-line for limited patches. Topical corticosteroids, topical minoxidil, anthralin and contact immunotherapy are alternatives. Oral JAK inhibitors may be used for extensive disease. Many patches regrow spontaneously within a year.`,
  `## Traumatic Brain Injury
Traumatic brain injury (TBI) is physical injury to brain tissue that temporarily or permanently impairs brain function.
Initial management: secure the airway, ensure adequate ventilation and oxygenation, and correct hypotension to maintain cerebral perfusion. Immobilise the cervical spine until injury is excluded.
Evaluation: Glasgow Coma Scale assessment and CT of the head.
Treatment: surgery is indicated to evacuate significant hematomas or decompress the brain. In the intensive care unit, monitor and control intracranial pressure, maintain normal blood glucose and temperature, prevent seizures in severe injury, and avoid hypoxia and hypotension.
Rehabilitation: physical, occupational, speech and cognitive therapy help patients recover function; recovery can continue for months.`,
  `## Fractures of the Leg
Fractures cause pain, swelling, deformity and inability to bear weight.
First aid and precautions: check circulation, sensation and movement below the injury. Immobilise the limb with a splint that includes the joints above and below the fracture before moving the person. Cover open wounds with a sterile dressing; an open fracture needs urgent antibiotics and surgical care. Elevate the limb, apply ice and give analgesia. Watch for compartment syndrome: severe pain out of proportion, pain on passive stretch and tense swelling require urgent evaluation.
Definitive treatment: reduction of displaced fractures, then immobilisation with a cast or surgical fixation (plates, screws or intramedullary nails).
Recovery: early mobilisation as allowed, physical therapy to restore strength and range of motion, prevention of venous thromboembolism, and follow-up imaging to confirm healing.`,
].join('\f');
