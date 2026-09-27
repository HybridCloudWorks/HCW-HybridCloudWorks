/**
 * Does the lab image vendor every module the Landing Zone Builder can emit?
 * (ADR 0032 decision 5.) The pure half of lab-image-avm-vendoring.test.mjs.
 *
 * The builder emits exactly the modules in AVM_MODULES
 * (frontend/src/lib/landingZone/avmVersions.js), each at its pinned version:
 * every emitted `module` block takes its `source` and `version` from that
 * table. The image vendors what lab-image/versions.env says, read three ways:
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
 * are what those records describe. Which vendored copy a `module` block
 * resolves to is decided by labModuleReport, the builder's own port of
 * lab-image/lib/tf_rewrite.py, which labImage.test.js holds to the Python
 * case for case, so this file carries no third copy of that rule.
 */
import { labModuleReport } from '../../frontend/src/lib/landingZone/labImage.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CHILD_PIN = /^[^@\s]+@\d+\.\d+\.\d+$/;
const PRINT =
  'docker build --target vendor --build-arg AVM_PRINT_PINS=1 --progress=plain lab-image, then paste the AVM_CHILD_MODULES and AVM_CHILD_CALLS blocks it prints (lab-image/README.md, "Updating a version")';

/** `avm-ptn-alz` -> `PTN_ALZ`, the <KEY> of its AVM_<KEY>_VERSION line. */
export const envKeyFor = (name) => String(name).replace(/^avm-/, '').toUpperCase().replace(/-/g, '_');

/** `PTN_ALZ` -> `avm-ptn-alz`, the Dockerfile's `tr 'A-Z_' 'a-z-'`. */
export const nameForKey = (key) => `avm-${String(key).toLowerCase().replace(/_/g, '-')}`;

const idOf = ({ name, version }) => `${name}@${version}`;

// --- reading versions.env ---

/** The builder modules versions.env vendors: [{ name, key, version, sha256 }]. */
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

/** Every `/opt/avm/<name>@<version>` the image carries: the builder modules and every pinned child. */
export function vendoredEntries(env) {
  return [...new Set([...builderModules(env).map(idOf), ...childPins(env).keys()])].sort();
}

// --- the checks, one question each ---

/** A builder module versions.env does not vendor, or vendors at another version or without a sum. */
function builderProblem({ name, version }, entry) {
  const key = `AVM_${envKeyFor(name)}`;
  if (!entry) {
    return `the builder emits ${name} ${version}, and lab-image/versions.env has no ${key}_VERSION line, so the image does not vendor it`;
  }
  if (entry.version !== version) {
    return `the builder emits ${name} ${version}, and lab-image/versions.env vendors ${entry.version} (${key}_VERSION)`;
  }
  if (!SHA256_HEX.test(entry.sha256 ?? '')) {
    return `lab-image/versions.env has ${key}_VERSION without a 64-hex ${key}_SHA256 beside it`;
  }
  return null;
}

/** The builder's modules against versions.env's builder pairs, in both directions. */
function builderProblems(modules, vendored) {
  const byName = new Map(vendored.map((m) => [m.name, m]));
  const emitted = new Set(modules.map((m) => m.name));
  const extra = vendored
    .filter((m) => !emitted.has(m.name))
    .map(
      (m) =>
        `lab-image/versions.env vendors ${m.name} ${m.version} as a builder module, and the builder does not emit it, so nothing would ever bump it`
    );
  return [...modules.map((m) => builderProblem(m, byName.get(m.name))).filter(Boolean), ...extra];
}

/** A record for every builder version, and none for a version the builder does not emit. */
function recordProblems(builders, calls) {
  const unrecorded = [...builders]
    .filter((builder) => !calls.has(builder))
    .map(
      (builder) =>
        `lab-image/versions.env records nothing for ${builder} in AVM_CHILD_CALLS, so what it calls is unknown to the image; run ${PRINT}`
    );
  const stale = [...calls.keys()]
    .filter((builder) => !builders.has(builder))
    .map((builder) => `AVM_CHILD_CALLS records ${builder}, a version the builder does not emit; run ${PRINT}`);
  return [...unrecorded, ...stale];
}

/** Every recorded child is pinned, or is itself a builder module. */
function unpinnedCalls(builders, calls, pins) {
  return [...calls].flatMap(([builder, children]) =>
    [...children]
      .filter((child) => !pins.has(child) && !builders.has(child))
      .map(
        (child) =>
          `${builder} calls ${child}, and AVM_CHILD_MODULES does not pin it, so the image does not vendor it`
      )
  );
}

/** Every pin is well formed and called by some record. */
function pinProblems(calls, pins) {
  const called = new Set([...calls.values()].flatMap((children) => [...children]));
  return [...pins].flatMap(([child, hash]) => [
    ...(CHILD_PIN.test(child) && SHA256_HEX.test(hash ?? '')
      ? []
      : [`AVM_CHILD_MODULES line "${child} ${hash ?? ''}" is not <name>@<version> <sha256>`]),
    ...(called.has(child) ? [] : [`AVM_CHILD_MODULES pins ${child}, which no AVM_CHILD_CALLS line calls`]),
  ]);
}

function childProblems(modules, env) {
  const calls = childCalls(env);
  const pins = childPins(env);
  const builders = new Set(modules.map(idOf));
  const absent = blockLines(env, 'AVM_CHILD_CALLS') === null ? ['lab-image/versions.env has no AVM_CHILD_CALLS block'] : [];
  return [
    ...absent,
    ...recordProblems(builders, calls),
    ...unpinnedCalls(builders, calls, pins),
    ...pinProblems(calls, pins),
  ];
}

/**
 * The smoke payload calls each builder module once, and the image's rewrite
 * (labModuleReport, as hcw-terraform-validate) sends that call to the
 * builder's version, not an older copy beside it.
 */
function fixtureProblems(modules, env, fixture) {
  const report = labModuleReport([{ path: 'main.tf', content: fixture }], vendoredEntries(env));
  return modules.flatMap(({ name, version }) => {
    const rows = report.filter((row) => row.module === name);
    if (rows.length !== 1) {
      return [
        `lab-image/smoke/terraform-validate-payload/main.tf calls Azure/${name}/azurerm ${rows.length} times, not once; smoke.sh expects one rewrite per builder module`,
      ];
    }
    const [row] = rows;
    if (row.vendored === `${name}@${version}`) return [];
    return [
      `the smoke payload's module "${row.block}" (${row.source} "${row.constraint}") resolves to ${row.vendored ?? 'no vendored copy'}, not the builder's ${name}@${version}`,
    ];
  });
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
