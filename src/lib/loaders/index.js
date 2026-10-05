// File-type dispatch. Every loader returns { pages: [{ page, text }], title } and is
// imported lazily, so pdf.js and mammoth are only downloaded when needed.

export const ACCEPT = '.pdf,.txt,.md,.markdown,.html,.htm,.docx';

export function fileKind(file) {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (/\.html?$/.test(n) || file.type === 'text/html') return 'html';
  if (/\.(txt|md|markdown)$/.test(n) || file.type.startsWith('text/')) return 'text';
  return null;
}

export async function loadFile(file, onProgress) {
  const kind = fileKind(file);
  if (kind === 'pdf') return { kind, ...(await (await import('./pdf.js')).loadPdf(file, onProgress)) };
  const m = await import('./text.js');
  if (kind === 'docx') return { kind, ...(await m.loadDocx(file)) };
  if (kind === 'html') return { kind, ...(await m.loadHtml(file)) };
  if (kind === 'text') return { kind, ...(await m.loadText(file)) };
  throw new Error(`Unsupported file type: ${file.name}. Use PDF, DOCX, HTML, TXT or Markdown.`);
}
