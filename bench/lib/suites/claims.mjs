// Hallucination check (judge-free claim support, evaluate.js supportAnalysis):
//  - SQuAD swapped facts: true sentences from each paragraph versus the same sentence with the
//    answer replaced by another answer of the same kind (number or name) from the same article.
//  - SciFact claims: human-written claims that the abstract supports versus contradicts.
import { mean } from '../metrics.mjs';
import { half } from '../data.mjs';

const isNum = (a) => /\d/.test(a);

export function swapPairs(E, squad, split) {
  const pairs = [];
  for (const art of squad) {
    const answers = art.paragraphs.flatMap((p) => p.qas.map((q) => q.answers[0]));
    art.paragraphs.forEach((p, pi) =>
      p.qas.forEach((q, qi) => {
        if (half(q.id) !== split) return;
        const ans = q.answers[0];
        const sent = E.text.splitSentences(p.context).find((x) => x.includes(ans));
        if (!sent || sent.length < 40) return;
        const pool = answers.filter((a) => a !== ans && isNum(a) === isNum(ans) && !p.context.includes(a) && a.length < 40);
        if (!pool.length) return;
        pairs.push({ id: q.id, title: art.title, context: p.context, sentence: sent, swapped: sent.replace(ans, pool[(pi * 7 + qi * 13) % pool.length]), kind: isNum(ans) ? 'number' : 'name' });
      })
    );
  }
  return pairs;
}

const status = (E, claim, text) => E.evaluate.supportAnalysis(`${claim} [Doc p. 1]`, [{ key: 'a', docId: 'a', docName: 'Doc', page: 1, text }]).rows[0]?.status || 'unsupported';

export function claimsSuite(E, squad, scifactClaims, { split = 'B', claimsSplit = 'dev' } = {}) {
  const pairs = swapPairs(E, squad, split);
  const truePass = pairs.map((p) => (status(E, p.sentence, p.context) === 'supported' ? 1 : 0));
  const caught = pairs.map((p) => (status(E, p.swapped, p.context) !== 'supported' ? 1 : 0));
  const byKind = (k) => mean(caught.filter((_, i) => pairs[i].kind === k));
  const sci = scifactClaims[claimsSplit];
  const sciPass = sci.map((c) => (status(E, c.claim, c.abstract) === 'supported' ? 1 : 0));
  const sup = sciPass.filter((_, i) => sci[i].label === 'SUPPORT');
  const con = sciPass.filter((_, i) => sci[i].label === 'CONTRADICT');
  return {
    split,
    claimsSplit,
    squad: { pairs: pairs.length, truePass: mean(truePass), swapCaught: mean(caught), numbersCaught: byKind('number'), namesCaught: byKind('name'), per: { truePass, caught }, ids: pairs.map((p) => p.id) },
    scifact: { supported: sup.length, contradicted: con.length, supportedPass: mean(sup), contradictedPass: mean(con), per: { pass: sciPass, label: sci.map((c) => (c.label === 'SUPPORT' ? 'S' : 'C')) }, ids: sci.map((c) => c.id) },
  };
}
