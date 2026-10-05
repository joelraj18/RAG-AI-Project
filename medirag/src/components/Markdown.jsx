import { Fragment } from 'react';

// Minimal, safe markdown renderer (headings, lists, bold/italic, code) that turns
// "[PDF p. 175]" citations into clickable chips which open the page viewer.

const CITE = /(\[(?:PDF\s*)?p(?:age|g)?\.?\s*[\d,\s–-]+\])/gi;

function inline(text, onCite, keyBase) {
  const parts = text.split(CITE);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (CITE.test(part)) {
      CITE.lastIndex = 0;
      const pages = (part.match(/\d+/g) || []).map(Number);
      return (
        <span key={key} className="mx-0.5 inline-flex flex-wrap gap-0.5 align-baseline">
          {pages.map((p) => (
            <button
              key={p}
              onClick={() => onCite?.(p)}
              className="rounded-md bg-brand-50 px-1.5 py-0 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300 dark:ring-brand-800"
              title={`Open PDF page ${p}`}
            >
              p.{p}
            </button>
          ))}
        </span>
      );
    }
    CITE.lastIndex = 0;
    const segs = part.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g);
    return (
      <Fragment key={key}>
        {segs.map((s, j) => {
          if (/^\*\*[^*]+\*\*$/.test(s)) return <strong key={j}>{s.slice(2, -2)}</strong>;
          if (/^\*[^*]+\*$/.test(s)) return <em key={j}>{s.slice(1, -1)}</em>;
          if (/^`[^`]+`$/.test(s)) return <code key={j}>{s.slice(1, -1)}</code>;
          return s;
        })}
      </Fragment>
    );
  });
}

export default function Markdown({ text, onCite, streaming }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let list = null;
  const flush = () => {
    if (list) blocks.push(list);
    list = null;
  };
  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: 'h', level: h[1].length, text: h[2] });
    } else if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (!list || list.t !== type) {
        flush();
        list = { t: type, items: [] };
      }
      list.items.push((ul || ol)[1]);
    } else if (!line.trim()) {
      flush();
    } else if (/^[A-Z][^.!?]{2,60}:$/.test(line.trim()) || /^\*\*[^*]+\*\*:?$/.test(line.trim())) {
      flush();
      blocks.push({ t: 'h', level: 4, text: line.trim().replace(/^\*\*|\*\*:?$|\*\*$/g, '').replace(/:$/, '') });
    } else {
      flush();
      blocks.push({ t: 'p', text: line });
    }
  });
  flush();
  return (
    <div className={`prose-answer text-[15px] ${streaming ? 'caret' : ''}`}>
      {blocks.map((b, i) => {
        if (b.t === 'h') {
          const Tag = `h${Math.min(4, b.level + 1)}`;
          return <Tag key={i}>{inline(b.text, onCite, i)}</Tag>;
        }
        if (b.t === 'ul' || b.t === 'ol') {
          const Tag = b.t;
          return (
            <Tag key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, onCite, `${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={i}>{inline(b.text, onCite, i)}</p>;
      })}
    </div>
  );
}
