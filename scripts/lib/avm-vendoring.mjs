/**
 * Does the lab image vendor every module the Landing Zone Builder can emit?
 * (ADR 0032 decision 5.) The pure half of lab-image-avm-vendoring.test.mjs.
 *
 * The builder emits exactly the modules in AVM_MODULES
 * (frontend/src/lib/landingZone/avmVersions.js), each at its pinned version:
 * every emitted `module` block takes its `source` and `version` from that
 * table. The image vendors what lab-image/versions.env says, read three ways
 * by three readers that must agree with this one:
 *
 *   - Builder modules: every `AVM_<KEY>_VERSION` line, with the
 *     `AVM_<KEY>_SHA256` of its release tarball beside it. The Dockerfile's
 *     fetch stage vendors each at /opt/avm/<name>@<version>, <name> being
 *     `avm-` plus <KEY> lower-cased with `_` as `-`.
 *   - AVM_CHILD_CALLS: which builder module's tree reaches which registry
 *     child, one `<builder>@<version> <child>@<version>` line per pair, or
 *     the builder alone on a line when it calls none. Keyed by the builder's
 *     version, so a pin bump leaves the new version unrecorded.
 *   - AVM_CHILD_MODULES: each child once, `<name>@<version> <tree hash>`.
 *
 * The build (vendor-avm.sh) proves the last two against what `terraform get`
 * resolves, with network; this proves, with none, that the builder's pins
 * are what those records describe. Text scans, like every reader in
 * scripts/lib: nothing here parses HCL or shell.
 */

/** `avm-ptn-alz` -> `PTN_ALZ`, the <KEY> of its AVM_<KEY>_VERSION line. */
export const envKeyFor = (name) => String(name).replace(/^avm-/, '').toUpperCase().replace(/-/g, '_');

/** `PTN_ALZ` -> `avm-ptn-alz`, the Dockerfile's `tr 'A-Z_' 'a-z-'`. */
export const nameForKey = (key) => `avm-${String(key).toLowerCase().replace(/_/g, '-')}`;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The builder modules versions.env vendors: [{ name, version, sha256 }]. */
export function builderModules(env) {
  const text = String(env);
  return [...text.matchAll(/^AVM_([A-Z0-9_]+)_VERSION=(\S*)$/gm)].map(([, key, version]) => ({
    name: nameForKey(key),
    key,
    version,
    sha256: new RegExp(`^AVM_${key}_SHA256=(\\S*)$`, 'm').exec(text)?.[1] ?? null,
  }));
}

/** The non-blank lines of a quoted multi-line value `NAME='...'`, or null when it is absent. */
export function blockLines(env, name) {
  const match = new RegExp(`^${name}='([^']*)'`, 'm').exec(String(env));
  if (!match) return null;
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** AVM_CHILD_MODULES as a Map of `name@version` -> tree hash. */
export function childPins(env) {
  return new Map((blockLines(env, 'AVM_CHILD_MODULES') ?? []).map((line) => line.split(/\s+/)));
}

/** AVM_CHILD_CALLS as a Map of builder `name@version` -> Set of child `name@version`. */
export function childCalls(env) {
  const calls = new Map();
  for (const line of blockLines(env, 'AVM_CHILD_CALLS') ?? []) {
    const [builder, child] = line.split(/\s+/);
    if (!calls.has(builder)) calls.set(builder, new Set());
    if (child) calls.get(builder).add(child);
  }
  return calls;
}

// --- Terraform version constraints, as lab-image/lib/tf_constraints.py reads them ---

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const CLAUSE = /^(~>|>=|<=|!=|>|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

const parseVersion = (text) => VERSION.exec(String(text).trim())?.slice(1).map(Number) ?? null;

function compare(a, b) {
  const at = a.findIndex((part, i) => part !== b[i]);
  if (at === -1) return 0;
  return a[at] < b[at] ? -1 : 1;
}

const OPERATORS = {
  '=': (c) => c === 0,
  '!=': (c) => c !== 0,
  '>': (c) => c > 0,
  '>=': (c) => c >= 0,
  '<': (c) => c < 0,
  '<=': (c) => c <= 0,
};

function satisfiesClause(version, clause) {
  const m = CLAUSE.exec(clause.trim());
  if (!m) return false;
  const [major, minor, patch] = [m[2], m[3], m[4]].map((part) => Number(part ?? 0));
  const given = [major, minor, patch];
  if (m[1] === '~>') {
    const upper = m[4] === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0];
    return compare(version, given) >= 0 && compare(version, upper) < 0;
  }
  return OPERATORS[m[1] ?? '='](compare(version, given));
}

/** Terraform's comma-separated constraint over a `MAJOR.MINOR.PATCH` string. */
export function satisfies(version, constraint) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  if (!String(constraint).trim()) return true;
  return String(constraint)
    .split(',')
    .every((clause) => satisfiesClause(parsed, clause));
}

/** The highest of `versions` satisfying `constraint`, as hcw-terraform-validate chooses, or null. */
export function choose(versions, constraint) {
  const fits = versions.filter((v) => satisfies(v, constraint)).sort((a, b) => compare(parseVersion(a), parseVersion(b)));
  return fits.at(-1) ?? null;
}

/** Every `module` block's `source` and `version` in some HCL text (top-level attributes only). */
export function moduleCalls(hcl) {
  const calls = [];
  for (const block of String(hcl).matchAll(/^module\s+"([^"]+)"\s*\{([\s\S]*?)^\}/gm)) {
    const source = /^\s*source\s*=\s*"([^"]*)"/m.exec(block[2])?.[1] ?? null;
    const version = /^\s*version\s*=\s*"([^"]*)"/m.exec(block[2])?.[1] ?? '';
    calls.push({ block: block[1], source, version });
  }
  return calls;
}

// --- the check ---

const PRINT =
  'docker build --target vendor --build-arg AVM_PRINT_PINS=1 --progress=plain lab-image, then paste the AVM_CHILD_MODULES and AVM_CHILD_CALLS blocks it prints (lab-image/README.md, "Updating a version")';

function builderProblems(modules, vendored) {
  const problems = [];
  const byName = new Map(vendored.map((m) => [m.name, m]));
  for (const { name, version } of modules) {
    const entry = byName.get(name);
    const key = `AVM_${envKeyFor(name)}`;
    if (!entry) {
      problems.push(`the builder emits ${name} ${version}, and lab-image/versions.env has no ${key}_VERSION line, so the image does not vendor it`);
    } else if (entry.version !== version) {
      problems.push(`the builder emits ${name} ${version}, and lab-image/versions.env vendors ${entry.version} (${key}_VERSION)`);
    }
    if (entry && !SHA256_HEX.test(entry.sha256 ?? '')) {
      problems.push(`lab-image/versions.env has ${key}_VERSION without a 64-hex ${key}_SHA256 beside it`);
    }
  }
  const emitted = new Set(modules.map((m) => m.name));
  for (const { name, version } of vendored) {
    if (!emitted.has(name)) {
      problems.push(`lab-image/versions.env vendors ${name} ${version} as a builder module, and the builder does not emit it, so nothing would ever bump it`);
    }
  }
  return problems;
}

function childProblems(modules, env) {
  const problems = [];
  const calls = childCalls(env);
  const pins = childPins(env);
  const builders = new Set(modules.map((m) => `${m.name}@${m.version}`));
  if (blockLines(env, 'AVM_CHILD_CALLS') === null) problems.push('lab-image/versions.env has no AVM_CHILD_CALLS block');
  for (const builder of builders) {
    if (!calls.has(builder)) {
      problems.push(`lab-image/versions.env records nothing for ${builder} in AVM_CHILD_CALLS, so what it calls is unknown to the image; run ${PRINT}`);
    }
  }
  for (const [builder, children] of calls) {
    if (!builders.has(builder)) {
      problems.push(`AVM_CHILD_CALLS records ${builder}, a version the builder does not emit; run ${PRINT}`);
    }
    for (const child of children) {
      if (!pins.has(child) && !builders.has(child)) {
        problems.push(`${builder} calls ${child}, and AVM_CHILD_MODULES does not pin it, so the image does not vendor it`);
      }
    }
  }
  const called = new Set([...calls.values()].flatMap((set) => [...set]));
  for (const [child, hash] of pins) {
    if (!/^[^@\s]+@\d+\.\d+\.\d+$/.test(child) || !SHA256_HEX.test(hash ?? '')) {
      problems.push(`AVM_CHILD_MODULES line "${child} ${hash ?? ''}" is not <name>@<version> <sha256>`);
    }
    if (!called.has(child)) problems.push(`AVM_CHILD_MODULES pins ${child}, which no AVM_CHILD_CALLS line calls`);
  }
  return problems;
}

/** Every version of `name` the image carries: the builder module's and any child copies. */
export function vendoredVersions(env, name) {
  const versions = builderModules(env)
    .filter((m) => m.name === name)
    .map((m) => m.version);
  for (const child of childPins(env).keys()) {
    const [childName, version] = child.split('@');
    if (childName === name) versions.push(version);
  }
  return versions;
}

function fixtureProblems(modules, env, fixture) {
  const problems = [];
  const calls = moduleCalls(fixture);
  for (const { name, version } of modules) {
    const source = `Azure/${name}/azurerm`;
    const blocks = calls.filter((c) => c.source === source);
    if (blocks.length !== 1) {
      problems.push(`lab-image/smoke/terraform-validate-payload/main.tf calls ${source} ${blocks.length} times, not once; smoke.sh expects one rewrite per builder module`);
      continue;
    }
    const picked = choose(vendoredVersions(env, name), blocks[0].version);
    if (picked !== version) {
      problems.push(`the smoke payload's module "${blocks[0].block}" (${source} "${blocks[0].version}") resolves to ${picked ?? 'no vendored version'}, not the builder's ${version}`);
    }
  }
  return problems;
}

/**
 * Every way the image fails to carry what the builder can emit, as one
 * sentence each; an empty list is a pass. `modules` is AVM_MODULES' values
 * (`{ name, version }`), `env` the text of versions.env, `fixture` the text
 * of the smoke payload's main.tf.
 */
export function vendoringProblems({ modules, env, fixture }) {
  const list = [...modules].map(({ name, version }) => ({ name, version }));
  return [
    ...builderProblems(list, builderModules(env)),
    ...childProblems(list, env),
    ...fixtureProblems(list, env, fixture),
  ];
}
