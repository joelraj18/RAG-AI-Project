import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Modal, Button, Badge } from './ui.jsx';
import { db } from '../lib/db.js';

/** Shows the real PDF page behind a citation, plus the retrieved chunk text from that page. */
export default function PageViewer({ manual, page, highlight, onClose, chunksForPage }) {
  const canvas = useRef(null);
  const [p, setP] = useState(page);
  const [state, setState] = useState({ loading: true, total: manual?.pageCount, error: null, hasFile: true });

  useEffect(() => setP(page), [page]);

  useEffect(() => {
    if (!page || !manual) return;
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const blob = manual.isPdf ? await db.getFile(manual.id) : null;
      if (cancelled) return;
      if (!blob) return setState((s) => ({ ...s, loading: false, hasFile: false }));
      try {
        const { renderPdfPage } = await import('../lib/pdf.js');
        const total = await renderPdfPage(blob, p, canvas.current, 1.3);
        if (!cancelled) setState({ loading: false, total, error: null, hasFile: true });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: String(e.message || e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manual, p, page]);

  const chunks = chunksForPage?.(p) || [];
  return (
    <Modal open={!!page} onClose={onClose} title={`${manual?.name || 'Manual'} — PDF page ${p}`} wide>
      <div className="grid gap-0 md:grid-cols-[1fr_340px]">
        <div className="flex flex-col items-center gap-3 bg-slate-100 p-4 dark:bg-slate-950">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={p <= 1} onClick={() => setP(p - 1)}>
              Prev
            </Button>
            <Badge color="brand">
              Page {p}
              {state.total ? ` / ${state.total}` : ''}
            </Badge>
            <Button size="sm" variant="secondary" disabled={state.total && p >= state.total} onClick={() => setP(p + 1)}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {state.loading && <Loader2 className="h-6 w-6 animate-spin text-brand-600" />}
          {!state.hasFile && (
            <p className="py-10 text-sm text-slate-500">The original file is not stored for this manual (imported pack or text file). Showing extracted text instead.</p>
          )}
          {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
          <canvas ref={canvas} className={`max-w-full rounded bg-white shadow-lg ${state.hasFile ? '' : 'hidden'}`} />
        </div>
        <div className="scroll-thin max-h-[80vh] overflow-auto border-l border-slate-200 p-4 dark:border-slate-800">
          <h4 className="mb-2 text-sm font-semibold">Indexed chunks on this page ({chunks.length})</h4>
          {chunks.map((c) => (
            <div
              key={c.id}
              className={`mb-3 rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap ${
                highlight?.includes(c.id) ? 'border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              {highlight?.includes(c.id) && <Badge color="brand" className="mb-1">retrieved for this answer</Badge>}
              <div>{c.text}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
