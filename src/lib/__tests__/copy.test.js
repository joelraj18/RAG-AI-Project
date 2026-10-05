import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanHeading } from '../../components/ui.jsx';

// House style: no em dashes anywhere in the app or README, and no full stop at the end of a heading.
const root = join(import.meta.dirname, '..', '..', '..');
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe('copy style', () => {
  it('uses no em dashes', () => {
    const files = [...walk(join(root, 'src')).filter((f) => /\.(jsx?|css|html)$/.test(f)), join(root, 'README.md'), join(root, 'index.html')];
    const bad = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((l, i) => (l.includes('\u2014') ? `${f.slice(root.length + 1)}:${i + 1}` : null))
        .filter(Boolean)
    );
    expect(bad).toEqual([]);
  });
  it('drops a trailing full stop from headings', () => {
    expect(cleanHeading('Your library.')).toBe('Your library');
    expect(cleanHeading('Wait...')).toBe('Wait...');
    expect(cleanHeading('v1.2')).toBe('v1.2');
    expect(cleanHeading(42)).toBe(42);
  });
});
