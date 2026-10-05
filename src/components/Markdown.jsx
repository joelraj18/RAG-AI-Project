import { Fragment } from 'react';

import { parseCitations } from '../lib/evaluate.js';

// Minimal, safe markdown renderer (headings, lists, bold/italic, code) that turns
// citations like "[Guide p. 12]" or "[A p. 3; B p. 9]" into chips opening the source page.

const CITE = /(\[[^[\]]*?\bp(?:age|g|p)?\.?\s*\d[^[\]]*\])/gi;

function inline(text, onCite, showNames, keyBase) {
  return text.split(CITE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    const cites = i % 2 === 1 ? parseCitations(part) : [];
    if (cites.length) {
      return (
        <span key={key} className="mx-0.5 inline-flex flex-wrap gap-0.5 align-baseline">
          {cites.map((c, j) => (
            <button
              key={j}
              onClick={() => onCite?.(c)}
              className="rounded-md bg-brand-50 px-1.5 py-0 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300 dark:ring-brand-800"
              title={`Open ${c.name || 'source'} page ${c.page}`}
            >
              {showNames && c.name ? `${c.name.slice(0, 18)} ` : ''}p.{c.page}
            </button>
          ))}
        </span>
      );
    }
    const segs = part.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g);
    return (
      <Fragment key={key}>
        {segs.map((sg, j) => {
          if (/^\*\*[^*]+\*\*$/.test(sg)) return <strong key={j}>{sg.slice(2, -2)}</strong>;
          if (/^\*[^*]+\*$/.test(sg)) return <em key={j}>{sg.slice(1, -1)}</em>;
          if (/^`[^`]+`$/.test(sg)) return <code key={j}>{sg.slice(1, -1)}</code>;
          return sg;
        })}
      </Fragment>
    );
  });
}

export default function Markdown({ text, onCite, streaming, showNames = false }) {
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
          return <Tag key={i}>{inline(b.text, onCite, showNames, i)}</Tag>;
        }
        if (b.t === 'ul' || b.t === 'ol') {
          const Tag = b.t;
          return (
            <Tag key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, onCite, showNames, `${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={i}>{inline(b.text, onCite, showNames, i)}</p>;
      })}
    </div>
  );
}
