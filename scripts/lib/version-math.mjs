/**
 * Version arithmetic for the floors check (#715): comparing versions, the
 * N-2 floors, npm `engines` ranges and Terraform `required_version`
 * constraints. Pure; no I/O. scripts/version-floors.mjs re-exports all of it.
 */

/** `26`, `26.10`, `26.10.0` → [26], [26, 10], [26, 10, 0]; anything else → null. */
export function parseVersion(text) {
  const value = String(text ?? '').trim();
  if (!/^\d+(\.\d+){0,2}$/.test(value)) return null;
  return value.split('.').map(Number);
}

/** Numeric comparison, shorter versions padded with zeros. */
export function compareVersions(a, b) {
  const x = Array.isArray(a) ? a : parseVersion(a);
  const y = Array.isArray(b) ? b : parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Does `pin` meet `floor`? A pin less precise than the floor floats: `3.14`
 * in `actions/setup-python` and `26` in `actions/setup-node` resolve to the
 * newest release on that line when the job runs, so they are compared at
 * their own precision (`3.14` against `3.14`, not against `3.14.5`).
 */
export function meetsFloor(pin, floor) {
  const p = parseVersion(pin);
  const f = parseVersion(floor);
  if (!p || !f) throw new Error(`not a version: ${!p ? pin : floor}`);
  return compareVersions(p, f.slice(0, Math.max(p.length, 1))) >= 0;
}

function exact(newest, name) {
  const parts = parseVersion(newest);
  if (!parts || parts.length !== 3) throw new Error(`${name} needs MAJOR.MINOR.PATCH, got ${newest}`);
  return parts;
}

/** Newest release N at MAJOR.MINOR.PATCH → the floor two patch releases behind it. */
export function patchFloor(newest) {
  const [major, minor, patch] = exact(newest, 'patchFloor');
  return `${major}.${minor}.${Math.max(patch - 2, 0)}`;
}

/** Newest release N at MAJOR.MINOR.PATCH → the floor two minor releases behind it. */
export function minorFloor(newest) {
  const [major, minor] = exact(newest, 'minorFloor');
  return `${major}.${Math.max(minor - 2, 0)}.0`;
}

// ---------------------------------------------------------------------------
// npm `engines` ranges — the subset package.json files actually use
// ---------------------------------------------------------------------------

const full = (parts) => [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];

/** Increment component `index` and zero everything after it. */
function bump(parts, index) {
  const out = full(parts);
  out[index] += 1;
  for (let i = index + 1; i < 3; i += 1) out[i] = 0;
  return out;
}

/** Where a caret range's upper bound lands: the first non-zero given component. */
function caretIndex(lo, n) {
  if (lo[0] > 0 || n === 1) return 0;
  if (lo[1] > 0 || n === 2) return 1;
  return 2;
}

/** A bare or `=` version: exact at full precision, an x-range otherwise. */
const exactOrXRange = (lo, n) =>
  n === 3
    ? [{ op: '=', v: lo }]
    : [
        { op: '>=', v: lo },
        { op: '<', v: bump(lo, n - 1) },
      ];

/**
 * Each npm comparator operator as primitive comparators over full versions.
 * `n` is how many components the token gave: `>1.2` is `>=1.3.0`, and
 * `<=1.2` is `<1.3.0`, exactly as npm's semver reads them.
 */
const COMPARATORS = {
  '>=': (lo) => [{ op: '>=', v: lo }],
  '>': (lo, n) => [{ op: '>=', v: bump(lo, n - 1) }],
  '<': (lo) => [{ op: '<', v: lo }],
  '<=': (lo, n) => (n === 3 ? [{ op: '<=', v: lo }] : [{ op: '<', v: bump(lo, n - 1) }]),
  '^': (lo, n) => [
    { op: '>=', v: lo },
    { op: '<', v: bump(lo, caretIndex(lo, n)) },
  ],
  '~': (lo, n) => [
    { op: '>=', v: lo },
    { op: '<', v: bump(lo, n === 1 ? 0 : 1) },
  ],
  '=': exactOrXRange,
  '': exactOrXRange,
};

const TOKEN = /^(>=|<=|>|<|=|\^|~)?v?(\*|x|\d+(?:\.(?:\d+|x|\*)){0,2})$/i;

/** One comparator token → primitive comparators ({ op, v }). Throws on syntax it does not model. */
function expandComparator(token) {
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`unsupported range token "${token}"`);
  const op = m[1] ?? '';
  const raw = m[2].toLowerCase();
  if (raw === '*' || raw === 'x') return op === '' || op === '>=' ? [] : [{ op: '<', v: [0, 0, 0] }];
  // `26.x` and `26.*` stop at the wildcard: the given components are `26`.
  const parts = raw.split('.');
  const cut = parts.findIndex((p) => p === 'x' || p === '*');
  const numeric = (cut === -1 ? parts : parts.slice(0, cut)).map(Number);
  return COMPARATORS[op](full(numeric), numeric.length);
}

/** `^24.19.0 || >=26.8.0` → [[comparators], [comparators]]. Throws on syntax it does not know. */
export function parseNpmRange(range) {
  const text = String(range ?? '').trim();
  if (!text) throw new Error('empty range');
  return text.split('||').map((alternative) => {
    const set = alternative.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    if (set === '') return [];
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) return [...expandComparator(`>=${hyphen[1]}`), ...expandComparator(`<=${hyphen[2]}`)];
    return set.split(/\s+/).flatMap(expandComparator);
  });
}

const PASSES = {
  '>=': (d) => d >= 0,
  '<=': (d) => d <= 0,
  '<': (d) => d < 0,
  '=': (d) => d === 0,
};

const passes = (version, { op, v }) => PASSES[op](compareVersions(version, v));

/** Does the npm range admit this exact version? */
export function npmRangeAdmits(range, version) {
  const v = full(parseVersion(version) ?? []);
  return parseNpmRange(range).some((set) => set.every((c) => passes(v, c)));
}

/** The lowest version one comparator set admits, or null when it admits none. */
function setMinimum(set) {
  let lo = [0, 0, 0];
  for (const c of set) if ((c.op === '>=' || c.op === '=') && compareVersions(c.v, lo) > 0) lo = c.v;
  return set.every((c) => passes(lo, c)) ? lo : null;
}

/** The lowest version the npm range admits, as MAJOR.MINOR.PATCH, or null when it admits none. */
export function npmRangeMinimum(range) {
  const minima = parseNpmRange(range)
    .map(setMinimum)
    .filter(Boolean)
    .sort(compareVersions);
  return minima.length ? minima[0].join('.') : null;
}

// ---------------------------------------------------------------------------
// Terraform `required_version` constraints
// ---------------------------------------------------------------------------

const TF_OPERATORS = {
  '=': (d) => d === 0,
  '!=': (d) => d !== 0,
  '>=': (d) => d >= 0,
  '>': (d) => d > 0,
  '<=': (d) => d <= 0,
  '<': (d) => d < 0,
};

/**
 * One clause of a constraint. `~>` increments the second-to-last given
 * component: `~> 1.6` is >= 1.6, < 2.0; `~> 1.6.2` is >= 1.6.2, < 1.7.0.
 */
function clauseAdmits(part, v) {
  const m = /^(=|!=|>=|<=|>|<|~>)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(part);
  if (!m) throw new Error(`unsupported Terraform constraint "${part}"`);
  const op = m[1] ?? '=';
  const parts = parseVersion(m[2]);
  const lo = full(parts);
  const d = compareVersions(v, lo);
  if (op !== '~>') return TF_OPERATORS[op](d);
  return d >= 0 && compareVersions(v, bump(lo, Math.max(parts.length - 2, 0))) < 0;
}

/** Does a Terraform version constraint (`~> 1.6`, `>= 1.12, < 2.0`) admit this version? */
export function terraformConstraintAdmits(constraint, version) {
  const v = full(parseVersion(version) ?? []);
  return String(constraint)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .every((part) => clauseAdmits(part, v));
}
