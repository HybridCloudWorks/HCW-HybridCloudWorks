/**
 * Bump the Azure Verified Module pins when the Terraform Registry has a newer
 * release (#671, Phase 5 of #657).
 *
 * The Landing Zone Builder emits `module` blocks pinned to the versions in
 * src/lib/landingZone/avmVersions.js, and the lab image vendors the same
 * modules at the same versions from lab-image/versions.env (#658). Both files
 * say the pins were "looked up, not remembered"; this script is what keeps
 * that true without a human remembering to look.
 *
 * What it does, in order:
 *
 *   1. Reads AVM_MODULES out of avmVersions.js (imported as ESM; the module
 *      is pure) and asks `https://registry.terraform.io/v1/modules/Azure/
 *      <name>/azurerm` for each module's latest release.
 *   2. For a module the registry lists at a newer release: rewrites that one
 *      `avm('<name>', '<version>', …)` pin with a targeted text edit, stamps
 *      AVM_VERIFIED_ON with today's UTC date, downloads the release source
 *      tarball from GitHub (which is also the proof the tag exists) and, where
 *      lab-image/versions.env vendors the module, rewrites its `_VERSION` and
 *      `_SHA256` lines with the new version and the tarball's SHA256 — the
 *      same sum `sha256sum` prints and the Dockerfile checks.
 *   3. Prints a Markdown summary: every module's pinned and registry version,
 *      each bump's old → new with a link to the GitHub release notes, and
 *      whether the release's `required_providers` differ from the pinned
 *      `requiredProviders`, because that is the edit this script does NOT
 *      make (see below).
 *
 * Exit code 0 and no writes when nothing moved. `--dry-run` prints without
 * writing. `--summary <path>` also writes the summary to a file, which the
 * workflow carries into the pull request body.
 *
 * WHAT IT DOES NOT DO, on purpose. AVM input names drift between versions,
 * and so do provider constraints. The script edits version strings and a
 * checksum; it does not touch `requiredProviders`, PROVIDER_PINS, the
 * docblocks that quote each module's constraints, or the HCL emitters. The
 * workflow refreshes the snapshot tests after a bump so the pull request
 * carries the Terraform diff, and a human reads the module's release notes
 * against that diff before merging. That review is the gate; this is the
 * reminder.
 *
 * Every registry response is validated before it is believed: a `version`
 * that is not `MAJOR.MINOR.PATCH`, or whose `tag` is not `v<version>`, ends
 * the run with exit code 1 and one sentence, and nothing is written.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import prettier from 'prettier';

import { AVM_MODULES } from '../src/lib/landingZone/avmVersions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');

export const PINS_FILE = path.join(frontendRoot, 'src', 'lib', 'landingZone', 'avmVersions.js');
export const VERSIONS_ENV_FILE = path.join(repoRoot, 'lab-image', 'versions.env');

export const REGISTRY_BASE = 'https://registry.terraform.io/v1/modules';
const GITHUB_ORG = 'https://github.com/Azure';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const requestHeaders = {
  accept: 'application/json',
  'user-agent':
    'HCW-HybridCloudWorks update-avm-versions (+https://github.com/HybridCloudWorks/HCW-HybridCloudWorks)',
};

/** A source that could not be read or said something unusable. One sentence. */
export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * A file whose shape is not the one this script knows how to edit: a pin
 * that is missing, doubled or not at the version that was read. Nothing is
 * written, and the sentence names the line. Not a bug, so no stack.
 */
export class EditRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'EditRefused';
  }
}

// --- versions ---------------------------------------------------------------

/** `[major, minor, patch]` for a release string, or null for anything else. */
export function parseVersion(text) {
  const match = SEMVER.exec(String(text ?? '').trim());
  return match ? match.slice(1).map(Number) : null;
}

/** -1, 0 or 1. Throws for a string that is not a plain release version. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left) throw new TypeError(`Not a release version: ${JSON.stringify(a)}`);
  if (!right) throw new TypeError(`Not a release version: ${JSON.stringify(b)}`);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function isNewer(candidate, pinned) {
  return compareVersions(candidate, pinned) > 0;
}

// --- registry ---------------------------------------------------------------

export const registryModuleUrl = (name) => `${REGISTRY_BASE}/Azure/${name}/azurerm`;
export const registryVersionsUrl = (name) => `${registryModuleUrl(name)}/versions`;
export const releaseNotesUrl = (name, version) =>
  `${GITHUB_ORG}/terraform-azurerm-${name}/releases/tag/v${version}`;
export const tarballUrl = (name, version) =>
  `${GITHUB_ORG}/terraform-azurerm-${name}/archive/refs/tags/v${version}.tar.gz`;
export const terraformTfUrl = (name, version) =>
  `${GITHUB_ORG}/terraform-azurerm-${name}/blob/v${version}/terraform.tf`;

/**
 * The latest release from the registry's module document, validated: the
 * version is a plain MAJOR.MINOR.PATCH and, when the document carries a tag,
 * the tag is `v<version>`. Anything else is refused rather than pinned.
 */
export function latestFromRegistry(document, name) {
  const version = String(document?.version ?? '').trim();
  if (!parseVersion(version)) {
    throw new RegistryError(
      `The registry lists ${name} at ${JSON.stringify(document?.version ?? null)}, which is not a MAJOR.MINOR.PATCH release, so nothing was written.`
    );
  }
  const tag = document.tag == null ? null : String(document.tag);
  if (tag !== null && tag !== `v${version}`) {
    throw new RegistryError(
      `The registry lists ${name} ${version} under tag ${JSON.stringify(tag)} rather than v${version}, so nothing was written.`
    );
  }
  return { version, tag, publishedAt: document.published_at ?? null };
}

/**
 * The provider names one release requires, from the registry's versions
 * document. The registry lists a pseudo-provider named `terraform` with an
 * empty source for the `required_version` line; it is not a provider and is
 * dropped. Null when the release is not in the document.
 */
export function providersAt(versionsDocument, version) {
  const entries = versionsDocument?.modules?.[0]?.versions ?? [];
  const entry = entries.find((candidate) => candidate?.version === version);
  if (!entry) return null;
  const providers = entry.root?.providers ?? [];
  return [
    ...new Set(
      providers
        .filter((provider) => provider?.name && provider.source)
        .map((provider) => String(provider.name).toLowerCase())
    ),
  ].sort();
}

/** What the release requires that the pin does not list, and the reverse. */
export function providerDrift(pinned, latest) {
  if (latest === null) return { added: [], removed: [], unknown: true };
  const pinnedSet = new Set(pinned);
  const latestSet = new Set(latest);
  return {
    added: latest.filter((name) => !pinnedSet.has(name)),
    removed: pinned.filter((name) => !latestSet.has(name)),
    unknown: false,
  };
}

async function fetchJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { headers: requestHeaders });
  } catch (error) {
    throw new RegistryError(
      `${url} could not be fetched (${error.message}), so nothing was written.`
    );
  }
  if (!response.ok) {
    throw new RegistryError(`${url} answered HTTP ${response.status}, so nothing was written.`);
  }
  try {
    return await response.json();
  } catch {
    throw new RegistryError(`${url} did not return JSON, so nothing was written.`);
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/**
 * The SHA256 of the release source tarball, computed from the bytes GitHub
 * serves — the same value `sha256sum` prints for the download and the value
 * the lab image's Dockerfile checks before it unpacks anything.
 */
export async function fetchTarballSha256(name, version, fetchImpl = fetch) {
  const url = tarballUrl(name, version);
  let response;
  try {
    response = await fetchImpl(url, { headers: { 'user-agent': requestHeaders['user-agent'] } });
  } catch (error) {
    throw new RegistryError(
      `${url} could not be downloaded (${error.message}), so nothing was written.`
    );
  }
  if (!response.ok) {
    throw new RegistryError(
      `${url} answered HTTP ${response.status}: the registry lists ${name} ${version} but GitHub has no tag v${version}, so nothing was written.`
    );
  }
  return sha256Hex(await response.arrayBuffer());
}

/**
 * One result per pinned module: what is pinned, what the registry lists, and
 * whether the two differ. Only reads; nothing here writes.
 */
export async function checkModules({ modules = AVM_MODULES, fetchImpl = fetch } = {}) {
  const results = [];
  for (const module of Object.values(modules)) {
    const latest = latestFromRegistry(
      await fetchJson(registryModuleUrl(module.name), fetchImpl),
      module.name
    );
    const moved = isNewer(latest.version, module.version);
    let drift = { added: [], removed: [], unknown: true };
    if (moved) {
      const versions = await fetchJson(registryVersionsUrl(module.name), fetchImpl);
      drift = providerDrift([...module.requiredProviders], providersAt(versions, latest.version));
    }
    results.push({
      name: module.name,
      from: module.version,
      to: latest.version,
      moved,
      publishedAt: latest.publishedAt,
      requiredProviders: [...module.requiredProviders],
      drift,
      releaseNotes: releaseNotesUrl(module.name, latest.version),
      terraformTf: terraformTfUrl(module.name, latest.version),
      vendored: null,
      sha256: null,
    });
  }
  return results;
}

// --- targeted text edits ---------------------------------------------------

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrite one module's pin in avmVersions.js and nothing else: the second
 * argument of its `avm('<name>', '<version>', …)` call, whether that call is
 * on one line or Prettier has broken it across several. Exactly one pin must
 * match and it must currently read `fromVersion`, or the file is refused —
 * a file that has been reshaped is a file this edit should not guess at.
 */
export function rewritePin(source, name, fromVersion, toVersion) {
  if (!parseVersion(toVersion)) throw new TypeError(`Not a release version: ${toVersion}`);
  const pattern = new RegExp(
    `(avm\\(\\s*'${escapeRegExp(name)}',\\s*')(\\d+\\.\\d+\\.\\d+)(')`,
    'g'
  );
  const matches = [...String(source).matchAll(pattern)];
  if (matches.length !== 1) {
    throw new EditRefused(
      `avmVersions.js holds ${matches.length} pins for ${name}, not one, so it was not written.`
    );
  }
  if (matches[0][2] !== fromVersion) {
    throw new EditRefused(
      `avmVersions.js pins ${name} at ${matches[0][2]}, not the ${fromVersion} that was read, so it was not written.`
    );
  }
  return String(source).replace(pattern, `$1${toVersion}$3`);
}

/** Stamp the shared verification date; refuses a file that lost the line. */
export function stampVerifiedOn(source, date) {
  if (!ISO_DATE.test(date)) throw new TypeError(`Not a YYYY-MM-DD date: ${date}`);
  const pattern = /^(export const AVM_VERIFIED_ON = ')(\d{4}-\d{2}-\d{2})(';)$/gm;
  const matches = [...String(source).matchAll(pattern)];
  if (matches.length !== 1) {
    throw new EditRefused(
      `avmVersions.js holds ${matches.length} AVM_VERIFIED_ON lines, not one, so it was not written.`
    );
  }
  return String(source).replace(pattern, `$1${date}$3`);
}

/** `avm-ptn-alz` → `AVM_PTN_ALZ`, the prefix of its lines in versions.env. */
export function envKeyFor(name) {
  return String(name).toUpperCase().replace(/-/g, '_');
}

/** Whether versions.env vendors this module (has its `_VERSION` line). */
export function envVendors(envSource, name) {
  return new RegExp(`^${envKeyFor(name)}_VERSION=`, 'm').test(String(envSource));
}

/**
 * Rewrite one module's two lines in lab-image/versions.env: `_VERSION` to the
 * new release and `_SHA256` to the new tarball sum. Both lines must exist
 * exactly once and the version must currently read `fromVersion`; a file
 * with one line and not the other is refused, because a version without its
 * sum is a build that fails at the download and a sum without its version is
 * a build that verifies the wrong archive.
 */
export function rewriteEnv(envSource, name, fromVersion, toVersion, sha256) {
  if (!parseVersion(toVersion)) throw new TypeError(`Not a release version: ${toVersion}`);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new TypeError(`Not a SHA256 hex digest: ${sha256}`);
  const key = envKeyFor(name);
  const source = String(envSource);

  const versionPattern = new RegExp(`^(${key}_VERSION=)(\\S+)$`, 'gm');
  const versionMatches = [...source.matchAll(versionPattern)];
  if (versionMatches.length !== 1) {
    throw new EditRefused(
      `versions.env holds ${versionMatches.length} ${key}_VERSION lines, not one, so it was not written.`
    );
  }
  if (versionMatches[0][2] !== fromVersion) {
    throw new EditRefused(
      `versions.env has ${key}_VERSION=${versionMatches[0][2]}, not the ${fromVersion} avmVersions.js pins, so it was not written.`
    );
  }

  const shaPattern = new RegExp(`^(${key}_SHA256=)([0-9a-f]{64})$`, 'gm');
  const shaMatches = [...source.matchAll(shaPattern)];
  if (shaMatches.length !== 1) {
    throw new EditRefused(
      `versions.env holds ${shaMatches.length} ${key}_SHA256 lines beside its _VERSION line, not one, so it was not written.`
    );
  }

  return source.replace(versionPattern, `$1${toVersion}`).replace(shaPattern, `$1${sha256}`);
}

/**
 * Apply every bump to both files' text. Downloads each moved module's tarball
 * even when the lab image does not vendor it, because the download is also
 * the proof that the registry's version exists as a tag on GitHub — the
 * cross-check avmVersions.js says every pin has had.
 */
export async function applyChanges({ results, pinsSource, envSource, today, fetchImpl = fetch }) {
  const moved = results.filter((result) => result.moved);
  let nextPins = pinsSource;
  let nextEnv = envSource;
  for (const result of moved) {
    nextPins = rewritePin(nextPins, result.name, result.from, result.to);
    result.sha256 = await fetchTarballSha256(result.name, result.to, fetchImpl);
    result.vendored = envVendors(envSource, result.name);
    if (result.vendored) {
      nextEnv = rewriteEnv(nextEnv, result.name, result.from, result.to, result.sha256);
    }
  }
  if (moved.length > 0) nextPins = stampVerifiedOn(nextPins, today);
  return { pinsSource: nextPins, envSource: nextEnv, results };
}

// --- summary ---------------------------------------------------------------

const code = (text) => `\`${text}\``;

/** The Markdown the workflow puts in the pull request body. */
export function summarize({ results, today }) {
  const moved = results.filter((result) => result.moved);
  const lines = [];
  lines.push(`### Azure Verified Module pins, checked ${today}`);
  lines.push('');
  if (moved.length === 0) {
    lines.push(
      `Nothing moved: every pin in ${code('frontend/src/lib/landingZone/avmVersions.js')} is the latest release the Terraform Registry lists.`
    );
  } else {
    lines.push(
      `${moved.length} of ${results.length} pins moved. ${code('AVM_VERIFIED_ON')} is now ${today}.`
    );
  }
  lines.push('');
  lines.push('| Module | Pinned | Registry | Release notes |');
  lines.push('| --- | --- | --- | --- |');
  for (const result of results) {
    const change = result.moved ? `**${result.from} → ${result.to}**` : result.to;
    const notes = result.moved ? `[v${result.to}](${result.releaseNotes})` : '—';
    lines.push(`| ${code(result.name)} | ${result.from} | ${change} | ${notes} |`);
  }
  for (const result of moved) {
    lines.push('');
    lines.push(`#### ${code(result.name)} ${result.from} → ${result.to}`);
    lines.push('');
    const published = result.publishedAt
      ? `, published ${String(result.publishedAt).slice(0, 10)}`
      : '';
    lines.push(`- Release notes: ${result.releaseNotes}${published}.`);
    if (result.vendored === true) {
      lines.push(
        `- ${code('lab-image/versions.env')}: ${code(`${envKeyFor(result.name)}_VERSION`)} and ${code(`${envKeyFor(result.name)}_SHA256`)} rewritten; the tarball's SHA256 is ${code(result.sha256)}.`
      );
    } else if (result.vendored === false) {
      lines.push(
        `- ${code('lab-image/versions.env')} does not vendor this module, so it has no line to move; the tag was still downloaded (SHA256 ${code(result.sha256)}) to prove it exists.`
      );
    }
    if (result.drift.unknown) {
      lines.push(
        `- ${code('required_providers')} at v${result.to} could not be read from the registry; compare ${result.terraformTf} with ${code('requiredProviders')} by hand.`
      );
    } else if (result.drift.added.length === 0 && result.drift.removed.length === 0) {
      lines.push(
        `- ${code('required_providers')} at v${result.to} names the same providers as the pinned ${code('requiredProviders')} (${result.requiredProviders.join(', ')}); the version constraints may still have moved, so read ${result.terraformTf}.`
      );
    } else {
      const parts = [];
      if (result.drift.added.length) parts.push(`adds ${result.drift.added.join(', ')}`);
      if (result.drift.removed.length) parts.push(`drops ${result.drift.removed.join(', ')}`);
      lines.push(
        `- **HAND EDIT NEEDED.** ${code('required_providers')} at v${result.to} ${parts.join(' and ')} against the pinned ${code('requiredProviders')}. This script does not edit ${code('requiredProviders')}, ${code('PROVIDER_PINS')} or the docblocks that quote the constraints; read ${result.terraformTf} and change them in this pull request before merging.`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

// --- entry point -----------------------------------------------------------

export function parseArgs(argv) {
  const args = { dryRun: false, summaryPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') {
      args.dryRun = true;
    } else if (argv[index] === '--summary') {
      args.summaryPath = argv[index + 1] || null;
      index += 1;
    } else {
      throw new TypeError(
        `Unknown argument ${argv[index]}. Usage: node scripts/update-avm-versions.mjs [--dry-run] [--summary <path>]`
      );
    }
  }
  return args;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export async function main(argv = process.argv.slice(2)) {
  const { dryRun, summaryPath } = parseArgs(argv);
  const today = todayIso();

  const results = await checkModules({ fetchImpl: fetch });
  const pinsSource = await fs.readFile(PINS_FILE, 'utf8');
  const envSource = await fs.readFile(VERSIONS_ENV_FILE, 'utf8');
  const next = await applyChanges({ results, pinsSource, envSource, today, fetchImpl: fetch });
  const moved = results.filter((result) => result.moved);

  if (moved.length > 0 && !dryRun) {
    const formatted = await prettier.format(next.pinsSource, {
      ...(await prettier.resolveConfig(PINS_FILE)),
      filepath: PINS_FILE,
    });
    await fs.writeFile(PINS_FILE, formatted);
    if (next.envSource !== envSource) await fs.writeFile(VERSIONS_ENV_FILE, next.envSource);
  }

  const summary = summarize({ results, today });
  if (summaryPath) await fs.writeFile(summaryPath, summary);

  if (moved.length === 0) {
    console.log('No pin moved; nothing was written.');
  } else if (dryRun) {
    console.log(`Dry run: ${moved.length} pin(s) would move; nothing was written.`);
  } else {
    const written = [path.relative(repoRoot, PINS_FILE)];
    if (next.envSource !== envSource) written.push(path.relative(repoRoot, VERSIONS_ENV_FILE));
    console.log(`Rewrote ${written.join(' and ')}.`);
  }
  console.log('');
  console.log(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // One sentence for a source failure or a refused edit; the stack for a bug.
    if (
      error instanceof RegistryError ||
      error instanceof EditRefused ||
      error instanceof TypeError
    ) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
