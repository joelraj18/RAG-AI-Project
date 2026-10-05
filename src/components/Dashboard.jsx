import { Modal, Stat, Sparkline, Badge } from './ui.jsx';
import { fmtMs, mean, percentile } from '../lib/text.js';
import { STEPS } from './EvalPanel.jsx';

/** Session-level statistics: latency percentiles, quality averages, trends and feedback. */
export default function Dashboard({ session, open, onClose }) {
  const recs = (session?.messages || []).map((m) => m.rag).filter((r) => r && r.phase === 'done');
  const lat = recs.map((r) => r.timings.total);
  const g = recs.map((r) => r.eval?.judge?.groundedness);
  const sup = recs.map((r) => (r.eval?.heuristic?.support?.rows?.length ? r.eval.heuristic.support.share * 100 : null));
  const fb = (session?.messages || []).map((m) => m.feedback).filter(Boolean);
  const stepAvg = STEPS.map((s) => ({ ...s, v: mean(recs.map((r) => r.timings[s.key] || 0)) })).filter((s) => s.v > 0);
  const stepTotal = stepAvg.reduce((a, s) => a + s.v, 0) || 1;
  const conf = recs.map((r) => r.eval?.confidence?.level).filter(Boolean);
  return (
    <Modal open={open} onClose={onClose} title={`Session dashboard — ${session?.title || ''}`} wide>
      <div className="space-y-5 p-5">
        {!recs.length ? (
          <p className="text-sm text-slate-500">Ask a few questions to see statistics.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Answers" value={recs.length} hint={`${recs.filter((r) => r.gen?.truncated).length} truncated`} />
              <Stat label="Latency p50" value={fmtMs(percentile(lat, 50))} hint={`p95 ${fmtMs(percentile(lat, 95))}`} />
              <Stat label="Avg groundedness" value={mean(g) != null ? mean(g).toFixed(2) : '–'} hint="LLM judge 1–5" />
              <Stat label="Avg claim support" value={mean(sup) != null ? `${Math.round(mean(sup))}%` : '–'} hint="judge-free" />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">Latency trend</div>
                <Sparkline values={lat} width={220} height={40} />
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">Claim support trend</div>
                <Sparkline values={sup} width={220} height={40} max={100} />
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">Confidence & feedback</div>
                <div className="flex flex-wrap gap-1">
                  {['High', 'Medium', 'Low'].map((l) => (
                    <Badge key={l} color={l === 'High' ? 'green' : l === 'Medium' ? 'amber' : 'red'}>
                      {l}: {conf.filter((c) => c === l).length}
                    </Badge>
                  ))}
                  <Badge color="green">👍 {fb.filter((f) => f === 'up').length}</Badge>
                  <Badge color="red">👎 {fb.filter((f) => f === 'down').length}</Badge>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">Where the time goes (average per answer)</div>
              <div className="flex h-5 overflow-hidden rounded">
                {stepAvg.map((s) => (
                  <div key={s.key} className={s.color} style={{ width: `${(s.v / stepTotal) * 100}%` }} title={`${s.label}: ${fmtMs(s.v)}`} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {stepAvg.map((s) => (
                  <span key={s.key} className="flex items-center gap-1">
                    <span className={`h-2.5 w-2.5 rounded ${s.color}`} /> {s.label} {fmtMs(s.v)}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
