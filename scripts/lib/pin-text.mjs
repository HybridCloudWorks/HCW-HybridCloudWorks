/**
 * Line helpers shared by the version-pin readers (#715): reading a file,
 * indentation, YAML-ish scalars with their comments removed. Text only,
 * because nothing in this repository parses YAML and `scripts/` keeps its
 * dependencies to two on purpose.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const empty = () => ({ pins: [], problems: [] });
export const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
export const linesOf = (text) => text.split(/\r?\n/);
export const indentOf = (line) => line.length - line.trimStart().length;
export const isComment = (line) => /^\s*#/.test(line);
export const isDash = (line) => /^\s*- /.test(line);

export function unquote(value) {
  const v = value.trim();
  const quoted = (v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'));
  return quoted ? v.slice(1, -1) : v;
}

/** A YAML scalar with any trailing ` # comment` removed (quoted values keep their `#`). */
export function scalar(raw) {
  const v = raw.trim();
  if (!v.startsWith("'") && !v.startsWith('"')) return v.replace(/\s+#.*$/, '').trim();
  const end = v.indexOf(v[0], 1);
  return end === -1 ? v : v.slice(0, end + 1);
}

/** A scalar, unquoted and without its comment. */
export const clean = (raw) => unquote(scalar(raw));

/** Several reader results as one. */
export const merge = (results) => ({ pins: results.flatMap((r) => r.pins), problems: results.flatMap((r) => r.problems) });
