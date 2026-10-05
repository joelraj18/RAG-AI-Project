// legacy build = polyfilled for browsers without the newest JS features (e.g. Map.getOrInsertComputed)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Extract text page by page (page numbers are 1-based PDF pages, as cited in answers). */
export async function extractPdfPages(file, onProgress) {
  const buf = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: buf });
  const doc = await task.promise;
  const pages = [];
  const title = (await doc.getMetadata().catch(() => null))?.info?.Title || '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      text += item.hasEOL ? '\n' : item.str && !item.str.endsWith(' ') ? ' ' : '';
    }
    pages.push({ page: i, text });
    page.cleanup();
    if (i % 25 === 0 || i === doc.numPages) onProgress?.(i, doc.numPages);
  }
  await task.destroy();
  return { pages, title };
}

/** Plain text / markdown: split on form-feeds, otherwise into ~3,000-character "pages". */
export async function extractTextPages(file) {
  const text = await file.text();
  const parts = text.includes('\f') ? text.split('\f') : [];
  if (!parts.length) {
    const paras = text.split(/\n{2,}/);
    let cur = '';
    for (const p of paras) {
      if ((cur + p).length > 3000 && cur) {
        parts.push(cur);
        cur = '';
      }
      cur += p + '\n\n';
    }
    if (cur.trim()) parts.push(cur);
  }
  return { pages: parts.map((t, i) => ({ page: i + 1, text: t })), title: '' };
}

/** Render one PDF page to a canvas (used by the citation page viewer). */
export async function renderPdfPage(blob, pageNumber, canvas, scale = 1.4) {
  const task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
  const doc = await task.promise;
  try {
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
  } finally {
    task.destroy();
  }
}
