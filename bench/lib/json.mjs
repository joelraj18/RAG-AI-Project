// Result files: readable objects, but arrays of plain values on one line, so a file with thousands
// of per-question scores stays a few hundred lines long in a diff.
export function stringify(value) {
  return `${JSON.stringify(value, null, 1).replace(/\[\s*\n([^[\]{}]*?)\n\s*\]/g, (_, inner) => `[${inner.trim().split(/\s*\n\s*/).join(' ')}]`)}\n`;
}
