// Plain-text family loaders. Documents without real pages are split into ~3,000-character
// "pages" on paragraph boundaries (form-feeds are honoured), so citations stay precise.

export function paginate(text, size = 3000) {
  if (text.includes('\f')) return text.split('\f').map((t, i) => ({ page: i + 1, text: t }));
  const pages = [];
  let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    // start a new page before a heading, or when the page is full
    if (cur && (cur.length + para.length > size || (/^#{1,3}\s/.test(para) && cur.length > size * 0.5))) {
      pages.push(cur);
      cur = '';
    }
    cur += para + '\n\n';
  }
  if (cur.trim()) pages.push(cur);
  return pages.map((t, i) => ({ page: i + 1, text: t.trim() }));
}

/** TXT and Markdown. Markdown headings (#, ##, ###) are kept for section detection. */
export async function loadText(file) {
  let text = await file.text();
  if (/\.(md|markdown)$/i.test(file.name)) {
    text = text
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ''))
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^(#{1,6})\s+/gm, (m, h) => (h.length <= 3 ? '## ' : ''));
  }
  const title = /^##\s+(.+)$/m.exec(text)?.[1] || '';
  return { pages: paginate(text), title };
}

/** Convert an HTML string to heading-marked plain text. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,nav,footer,header,aside,svg,form').forEach((n) => n.remove());
  const out = [];
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (/^h[1-3]$/.test(tag)) out.push(`\n## ${el.textContent.trim()}\n`);
      else if (/^h[4-6]$/.test(tag) || tag === 'p' || tag === 'li' || tag === 'pre' || tag === 'blockquote') {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push(tag === 'li' ? `- ${t}` : `${t}\n`);
      } else if (tag === 'tr') out.push([...el.children].map((c) => c.textContent.trim()).join(' | '));
      else walk(el);
    }
  };
  walk(doc.body || doc.documentElement);
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), title: doc.title || '' };
}

export async function loadHtml(file) {
  const { text, title } = htmlToText(await file.text());
  return { pages: paginate(text), title };
}

/** DOCX via mammoth (lazy-loaded only when a Word file is uploaded). */
export async function loadDocx(file) {
  const mammoth = (await import('mammoth/mammoth.browser.min.js')).default;
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const { text } = htmlToText(`<body>${value}</body>`);
  return { pages: paginate(text), title: '' };
}
