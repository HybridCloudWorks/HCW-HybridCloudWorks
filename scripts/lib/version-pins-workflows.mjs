/**
 * The version pins in a GitHub Actions workflow (#715): `node-version:`,
 * `python-version:` and `terraform_version:`, each labelled
 * `file > job > step` (or `> matrix row`), so a platform ceiling in
 * scripts/version-floors.json can name exactly the pins it governs.
 */
import { parseVersion } from './version-math.mjs';
import { clean, empty, indentOf, isComment, isDash, linesOf } from './pin-text.mjs';

/** The nearest preceding `- ` line indented less than line `at`, after `stopAt`; -1 when none. */
function ownerDash(lines, at, stopAt) {
  const indent = indentOf(lines[at]);
  for (let i = at - 1; i > stopAt; i -= 1) {
    if (isDash(lines[i]) && indentOf(lines[i]) < indent) return i;
  }
  return -1;
}

/** A `name:` key directly inside the item that starts at `dash`, before line `until`. */
function childName(lines, dash, until) {
  const want = indentOf(lines[dash]) + 2;
  for (let j = dash + 1; j < until; j += 1) {
    const named = indentOf(lines[j]) === want && /^\s*name:\s*(.+)$/.exec(lines[j]);
    if (named) return clean(named[1]);
  }
  return null;
}

/**
 * The label of the YAML sequence item holding line `at`: a step's or a matrix
 * row's `name:`, or failing that its `uses:` without the ref.
 */
function itemLabel(lines, at, stopAt) {
  const dash = ownerDash(lines, at, stopAt);
  if (dash === -1) return null;
  const own = /^\s*-\s+name:\s*(.+)$/.exec(lines[dash]);
  if (own) return clean(own[1]);
  const uses = /^\s*-\s+uses:\s*([^@\s]+)/.exec(lines[dash]);
  return childName(lines, dash, at) ?? (uses ? `uses ${uses[1]}` : `item at line ${dash + 1}`);
}

const VERSION_KEY = /^\s*(node-version|node-version-file|python-version|python-version-file|terraform_version):\s*(.*)$/;
const KIND_OF_KEY = {
  'node-version': 'node',
  'node-version-file': 'node',
  'python-version': 'python',
  'python-version-file': 'python',
  terraform_version: 'terraform',
};
const MATRIX_DEFAULT = /^\$\{\{\s*matrix\.[A-Za-z0-9_-]+\s*\|\|\s*'([^']+)'\s*\}\}$/;

/**
 * One version key. `${{ matrix.node-version || 'N' }}` is read as its
 * default, which is itself a pin: it is what a row without its own value
 * gets. Any other expression, and any `*-version-file`, is a problem.
 */
function versionKey(name, value, at) {
  const kind = KIND_OF_KEY[name];
  if (name.endsWith('-file')) {
    return { problem: { ...at, kind, message: `${name} is not read by the floors check; pin the version inline` } };
  }
  if (kind === 'terraform' && value === 'latest') return {};
  const fallback = MATRIX_DEFAULT.exec(value);
  if (fallback) return { pin: { ...at, kind, version: fallback[1], where: `${at.where} (matrix default)` } };
  if (parseVersion(value)) return { pin: { ...at, kind, version: value } };
  return { problem: { ...at, kind, message: `${name}: ${value} is not a literal version the floors check can read` } };
}

/** Does the step starting at `dash` carry `key` (or `key-file`) anywhere in its block? */
function stepHasKey(lines, dash, key) {
  const dashIndent = indentOf(lines[dash]);
  const pattern = new RegExp(`^\\s*${key}(-file)?:`);
  for (let k = dash + 1; k < lines.length; k += 1) {
    if (lines[k].trim() !== '' && indentOf(lines[k]) <= dashIndent) return false;
    if (pattern.test(lines[k])) return true;
  }
  return false;
}

/** `node` or `python` when line `i` is a setup-node or setup-python step with no version at all. */
function unversionedSetup(lines, i, jobLine) {
  const setup = /^\s*(-\s+)?uses:\s*actions\/setup-(node|python)@/.exec(lines[i]);
  if (!setup) return null;
  const dash = setup[1] ? i : ownerDash(lines, i, jobLine);
  return stepHasKey(lines, dash === -1 ? i : dash, `${setup[2]}-version`) ? null : setup[2];
}

/** Moves the job cursor. True when the line was structure (`jobs:` or a job id) and holds no pin. */
function advanceJob(cursor, line, i) {
  if (/^jobs:\s*(#.*)?$/.test(line)) {
    cursor.inJobs = true;
    return true;
  }
  if (/^\S/.test(line)) cursor.inJobs = false;
  const job = cursor.inJobs && /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
  if (job) Object.assign(cursor, { job: job[1], jobLine: i });
  return Boolean(job);
}

/**
 * Every Node.js, Python and Terraform version a workflow pins, and every
 * setup-node or setup-python step that names none (it runs whatever the
 * runner image ships).
 */
export function readWorkflow(file, source) {
  const lines = linesOf(source);
  const out = empty();
  const cursor = { inJobs: false, job: null, jobLine: -1 };
  const where = (i) => [file, cursor.job, itemLabel(lines, i, cursor.jobLine)].filter(Boolean).join(' > ');

  lines.forEach((line, i) => {
    if (isComment(line) || advanceJob(cursor, line, i)) return;
    const key = VERSION_KEY.exec(line);
    if (key) {
      const value = clean(key[2]);
      const found = versionKey(key[1], value, { file, line: i + 1, where: where(i), raw: value });
      if (found.pin) out.pins.push(found.pin);
      if (found.problem) out.problems.push(found.problem);
    }
    const setup = unversionedSetup(lines, i, cursor.jobLine);
    if (setup) {
      out.problems.push({
        file,
        line: i + 1,
        where: where(i),
        kind: setup,
        raw: '',
        message: `actions/setup-${setup} names no ${setup}-version, so it runs whatever the runner ships`,
      });
    }
  });
  return out;
}
