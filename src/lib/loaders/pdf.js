// legacy build = polyfilled for browsers without the newest JS features (e.g. Map.getOrInsertComputed)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Extract text page by page (1-based page numbers are what answers cite).
 * Lines set in a noticeably larger font than the page's body text are marked as
 * "## headings" so the chunker can attach section titles to chunks.
 */
export async function loadPdf(file, onProgress) {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const title = (await doc.getMetadata().catch(() => null))?.info?.Title || '';
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let cur = { text: '', h: 0 };
    for (const item of content.items) {
      if (!('str' in item)) continue;
      cur.text += item.str;
      if (item.str.trim()) cur.h = Math.max(cur.h, item.height || 0);
      if (item.hasEOL) {
        lines.push(cur);
        cur = { text: '', h: 0 };
      } else if (item.str && !item.str.endsWith(' ')) cur.text += ' ';
    }
    if (cur.text.trim()) lines.push(cur);
    const heights = lines.filter((l) => l.h > 0 && l.text.trim().length > 20).map((l) => l.h).sort((a, b) => a - b);
    const body = heights[Math.floor(heights.length / 2)] || 0;
    const text = lines
      .map((l) => {
        const t = l.text.trim();
        const heading = body && l.h >= body * 1.18 && t.length >= 3 && t.length <= 90 && !/[.,;]$/.test(t);
        return heading ? `## ${t}` : t;
      })
      .join('\n');
    pages.push({ page: i, text });
    page.cleanup();
    if (i % 25 === 0 || i === doc.numPages) onProgress?.(i, doc.numPages);
  }
  await task.destroy();
  return { pages, title };
}

// Small LRU of open documents so flipping through cited pages does not re-parse the PDF.
const open = new Map();

async function openDoc(key, blob) {
  if (open.has(key)) {
    const v = open.get(key);
    open.delete(key);
    open.set(key, v);
    return v.doc;
  }
  const task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
  const doc = await task.promise;
  open.set(key, { task, doc });
  while (open.size > 2) {
    const [k, v] = open.entries().next().value;
    open.delete(k);
    v.task.destroy();
  }
  return doc;
}

/** Render one PDF page to a canvas (citation page viewer). */
export async function renderPdfPage(key, blob, pageNumber, canvas, scale = 1.3) {
  const doc = await openDoc(key, blob);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = viewport.width * ratio;
  canvas.height = viewport.height * ratio;
  canvas.style.width = `${viewport.width}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return doc.numPages;
}
