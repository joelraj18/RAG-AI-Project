import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Modal, Button, Badge } from './ui.jsx';
import { db } from '../lib/db.js';
import { useStore } from '../state/store.jsx';

/** Shows the real PDF page behind a citation, next to the indexed chunks of that page. */
export default function PageViewer() {
  const { viewer, setViewer, docs, kbOf } = useStore();
  const doc = docs.find((d) => d.id === viewer?.docId);
  const canvas = useRef(null);
  const [p, setP] = useState(viewer?.page || 1);
  const [state, setState] = useState({ loading: false, error: null });

  useEffect(() => setP(viewer?.page || 1), [viewer]);

  useEffect(() => {
    if (!doc?.hasFile) return;
    let cancelled = false;
    (async () => {
      setState({ loading: true, error: null });
      try {
        const blob = await db.getFile(doc.id);
        if (!blob) throw new Error('Original file was removed to save space.');
        const { renderPdfPage } = await import('../lib/loaders/pdf.js');
        if (!cancelled) await renderPdfPage(doc.id, blob, p, canvas.current);
        if (!cancelled) setState({ loading: false, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: String(e.message || e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, p]);

  if (!viewer || !doc) return null;
  const chunks = (kbOf(doc.id)?.chunks || []).filter((c) => c.page === p);
  const highlight = new Set((viewer.highlight || []).map((k) => Number(String(k).split(':')[1])));
  return (
    <Modal open onClose={() => setViewer(null)} title={`${doc.name} · page ${p}`} wide>
      <div className="grid md:grid-cols-[1fr_340px]">
        <div className="flex flex-col items-center gap-3 bg-slate-100 p-4 dark:bg-slate-950">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={p <= 1} onClick={() => setP(p - 1)}>
              Prev
            </Button>
            <Badge color="brand">
              Page {p} / {doc.pageCount}
            </Badge>
            <Button size="sm" variant="secondary" disabled={p >= doc.pageCount} onClick={() => setP(p + 1)}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {state.loading && <Loader2 className="h-6 w-6 animate-spin text-brand-600" />}
          {!doc.hasFile && <p className="py-6 text-center text-sm text-slate-500">This {doc.kind || 'document'} has no page image; the indexed text of this page is shown on the right.</p>}
          {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
          <canvas ref={canvas} className={`max-w-full rounded bg-white shadow-lg ${doc.hasFile && !state.error ? '' : 'hidden'}`} />
        </div>
        <div className="scroll-thin max-h-[80vh] overflow-auto border-l border-slate-200 p-4 dark:border-slate-800">
          <h4 className="mb-2 text-sm font-semibold">Indexed chunks on this page ({chunks.length})</h4>
          {chunks.map((c, i) => {
            const idx = (kbOf(doc.id)?.chunks || []).indexOf(c);
            const hit = highlight.has(idx);
            return (
              <div key={i} className={`mb-3 rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap ${hit ? 'border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30' : 'border-slate-200 dark:border-slate-800'}`}>
                {hit && <Badge color="brand" className="mb-1">used in this answer</Badge>}
                {c.section && <div className="mb-1 font-semibold text-slate-500">§ {c.section}</div>}
                <div>{c.text}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
