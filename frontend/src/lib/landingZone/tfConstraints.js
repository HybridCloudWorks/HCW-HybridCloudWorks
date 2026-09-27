/**
 * Terraform version constraints, and which vendored module version satisfies
 * one (#672): lab-image/lib/tf_constraints.py in JavaScript, the half of the
 * runner image's rewrite rule that labImage.js uses to predict what the lab
 * will do with each module block. Same regular expressions, same operators
 * (`=`, `!=`, `>`, `>=`, `<`, `<=`, `~>`, comma-separated), same choice (the
 * highest vendored version that satisfies the constraint).
 *
 * Pure: no React, no DOM, no network.
 */

// tf_constraints.py, verbatim in meaning.
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const CLAUSE = /^(~>|>=|<=|!=|>|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

/** Lexicographic comparison of two `[major, minor, patch]` tuples: -1, 0 or 1. */
function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** '0.21.0' or 'v0.21.0' → [0, 21, 0]; anything else → null. */
export function parseVersion(text) {
  const m = VERSION.exec(String(text).trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

/** One `<op> <version>` clause → { op, given, upper }, or null when malformed. */
function parseClause(clause) {
  const m = CLAUSE.exec(clause.trim());
  if (!m) return null;
  const [major, minor, patch] = [m[2], m[3], m[4]].map((g) => (g ? Number(g) : 0));
  // ~> 1.2 means >= 1.2.0, < 2.0.0; ~> 1.2.3 means >= 1.2.3, < 1.3.0.
  const upper = m[4] ? [major, minor + 1, 0] : [major + 1, 0, 0];
  return { op: m[1] || '=', given: [major, minor, patch], upper };
}

/** Each plain operator as the signs of `compare(version, given)` it accepts. */
const ACCEPTED_SIGNS = Object.freeze({
  '=': [0],
  '!=': [-1, 1],
  '>': [1],
  '>=': [0, 1],
  '<': [-1],
  '<=': [-1, 0],
});

/** One parsed clause over a version: `~>` is the half-open range, the rest a sign test. */
function clauseHolds(version, { op, given, upper }) {
  if (op === '~>') return compare(version, given) >= 0 && compare(version, upper) === -1;
  return ACCEPTED_SIGNS[op].includes(compare(version, given));
}

/** Terraform's constraint syntax (comma-separated clauses) over a version tuple. */
export function satisfies(version, constraint) {
  if (!String(constraint).trim()) return true;
  return String(constraint)
    .split(',')
    .map(parseClause)
    .every((clause) => clause !== null && clauseHolds(version, clause));
}

/** `{ name: [{ version, text }] }` for a list of `<name>@<version>` entries (tf_constraints.vendored_modules). */
export function vendoredModules(entries) {
  const found = {};
  for (const entry of entries) {
    const at = entry.lastIndexOf('@');
    const name = entry.slice(0, at);
    const text = entry.slice(at + 1);
    const version = parseVersion(text);
    if (at > 0 && version) (found[name] ??= []).push({ version, text });
  }
  return found;
}

/** The highest vendored version of `name` satisfying `constraint`, as text, or null (tf_constraints.choose). */
export function chooseVendored(vendored, name, constraint) {
  const candidates = (vendored[name] ?? []).filter((c) => satisfies(c.version, constraint));
  if (!candidates.length) return null;
  return candidates.reduce((best, c) => (compare(c.version, best.version) > 0 ? c : best)).text;
}
