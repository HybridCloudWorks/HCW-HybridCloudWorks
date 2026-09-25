/**
 * The pure half of the AVM pin updater (#671): version comparison, registry
 * document validation, the targeted text edits that move a pin, and the
 * Markdown summary. Nothing here reads a file, a clock or the network; the
 * entry point and its I/O live in update-avm-versions.mjs, which re-exports
 * everything below so a test can import from one place.
 *
 * Every edit is a refusal first. A pin that is missing, doubled, or not at
 * the version that was read means the file has been reshaped into something
 * this script should not guess at, so it throws EditRefused with the line
 * named and nothing is written.
 */

const GITHUB_ORG = 'https://github.com/Azure';
export const REGISTRY_BASE = 'https://registry.terraform.io/v1/modules';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

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

function releaseParts(text) {
  const parts = parseVersion(text);
  if (!parts) throw new TypeError(`Not a release version: ${JSON.stringify(text)}`);
  return parts;
}

/** -1, 0 or 1. Throws for a string that is not a plain release version. */
export function compareVersions(a, b) {
  const left = releaseParts(a);
  const right = releaseParts(b);
  const index = left.findIndex((part, at) => part !== right[at]);
  if (index === -1) return 0;
  return left[index] < right[index] ? -1 : 1;
}

export function isNewer(candidate, pinned) {
  return compareVersions(candidate, pinned) > 0;
}

// --- registry documents -----------------------------------------------------

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

const isRealProvider = (provider) => Boolean(provider?.name && provider.source);
const providerName = (provider) => String(provider.name).toLowerCase();

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
  const names = (entry.root?.providers ?? []).filter(isRealProvider).map(providerName);
  return [...new Set(names)].sort();
}

export const UNKNOWN_DRIFT = Object.freeze({ added: [], removed: [], unknown: true });

/** What the release requires that the pin does not list, and the reverse. */
export function providerDrift(pinned, latest) {
  if (latest === null) return UNKNOWN_DRIFT;
  const pinnedSet = new Set(pinned);
  const latestSet = new Set(latest);
  return {
    added: latest.filter((name) => !pinnedSet.has(name)),
    removed: pinned.filter((name) => !latestSet.has(name)),
    unknown: false,
  };
}

// --- targeted text edits ---------------------------------------------------

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The one match of `pattern` in `source`, or EditRefused naming how many
 * there were. Every edit below goes through this, so "exactly one line, or
 * nothing is written" is said once.
 */
function onlyMatch(source, pattern, file, what) {
  const matches = [...String(source).matchAll(pattern)];
  if (matches.length !== 1) {
    throw new EditRefused(
      `${file} holds ${matches.length} ${what}, not one, so it was not written.`
    );
  }
  return matches[0];
}

function assertRelease(version) {
  if (!parseVersion(version)) throw new TypeError(`Not a release version: ${version}`);
}

/**
 * Rewrite one module's pin in avmVersions.js and nothing else: the second
 * argument of its `avm('<name>', '<version>', …)` call, whether that call is
 * on one line or Prettier has broken it across several. Exactly one pin must
 * match and it must currently read `fromVersion`, or the file is refused —
 * a file that has been reshaped is a file this edit should not guess at.
 */
export function rewritePin(source, name, fromVersion, toVersion) {
  assertRelease(toVersion);
  const pattern = new RegExp(
    `(avm\\(\\s*'${escapeRegExp(name)}',\\s*')(\\d+\\.\\d+\\.\\d+)(')`,
    'g'
  );
  const [, , current] = onlyMatch(source, pattern, 'avmVersions.js', `pins for ${name}`);
  if (current !== fromVersion) {
    throw new EditRefused(
      `avmVersions.js pins ${name} at ${current}, not the ${fromVersion} that was read, so it was not written.`
    );
  }
  return String(source).replace(pattern, `$1${toVersion}$3`);
}

/** Stamp the shared verification date; refuses a file that lost the line. */
export function stampVerifiedOn(source, date) {
  if (!ISO_DATE.test(date)) throw new TypeError(`Not a YYYY-MM-DD date: ${date}`);
  const pattern = /^(export const AVM_VERIFIED_ON = ')(\d{4}-\d{2}-\d{2})(';)$/gm;
  onlyMatch(source, pattern, 'avmVersions.js', 'AVM_VERIFIED_ON lines');
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
  assertRelease(toVersion);
  if (!SHA256_HEX.test(sha256)) throw new TypeError(`Not a SHA256 hex digest: ${sha256}`);
  const key = envKeyFor(name);
  const source = String(envSource);

  const versionPattern = new RegExp(`^(${key}_VERSION=)(\\S+)$`, 'gm');
  const [, , current] = onlyMatch(source, versionPattern, 'versions.env', `${key}_VERSION lines`);
  if (current !== fromVersion) {
    throw new EditRefused(
      `versions.env has ${key}_VERSION=${current}, not the ${fromVersion} avmVersions.js pins, so it was not written.`
    );
  }

  const shaPattern = new RegExp(`^(${key}_SHA256=)([0-9a-f]{64})$`, 'gm');
  onlyMatch(source, shaPattern, 'versions.env', `${key}_SHA256 lines beside its _VERSION line`);

  return source.replace(versionPattern, `$1${toVersion}`).replace(shaPattern, `$1${sha256}`);
}

// --- summary ---------------------------------------------------------------

const code = (text) => `\`${text}\``;
const PINS_PATH = 'frontend/src/lib/landingZone/avmVersions.js';
const ENV_PATH = 'lab-image/versions.env';

function headline(results, moved, today) {
  if (moved.length === 0) {
    return `Nothing moved: every pin in ${code(PINS_PATH)} is the latest release the Terraform Registry lists.`;
  }
  return `${moved.length} of ${results.length} pins moved. ${code('AVM_VERIFIED_ON')} is now ${today}.`;
}

function tableRow(result) {
  const change = result.moved ? `**${result.from} → ${result.to}**` : result.to;
  const notes = result.moved ? `[v${result.to}](${result.releaseNotes})` : '—';
  return `| ${code(result.name)} | ${result.from} | ${change} | ${notes} |`;
}

function releaseNotesLine(result) {
  const published = result.publishedAt
    ? `, published ${String(result.publishedAt).slice(0, 10)}`
    : '';
  return `- Release notes: ${result.releaseNotes}${published}.`;
}

/** One line about versions.env, or none when the tarball was never fetched. */
function envLine(result) {
  const key = envKeyFor(result.name);
  const byState = {
    true: `- ${code(ENV_PATH)}: ${code(`${key}_VERSION`)} and ${code(`${key}_SHA256`)} rewritten; the tarball's SHA256 is ${code(result.sha256)}.`,
    false: `- ${code(ENV_PATH)} does not vendor this module, so it has no line to move; the tag was still downloaded (SHA256 ${code(result.sha256)}) to prove it exists.`,
  };
  return byState[String(result.vendored)] ?? null;
}

const driftParts = (drift) =>
  [
    drift.added.length ? `adds ${drift.added.join(', ')}` : null,
    drift.removed.length ? `drops ${drift.removed.join(', ')}` : null,
  ].filter(Boolean);

function providersLine(result) {
  const { drift, to, terraformTf } = result;
  const tf = code('required_providers');
  const pinned = code('requiredProviders');
  if (drift.unknown) {
    return `- ${tf} at v${to} could not be read from the registry; compare ${terraformTf} with ${pinned} by hand.`;
  }
  const parts = driftParts(drift);
  if (parts.length === 0) {
    return `- ${tf} at v${to} names the same providers as the pinned ${pinned} (${result.requiredProviders.join(', ')}); the version constraints may still have moved, so read ${terraformTf}.`;
  }
  return `- **HAND EDIT NEEDED.** ${tf} at v${to} ${parts.join(' and ')} against the pinned ${pinned}. This script does not edit ${pinned}, ${code('PROVIDER_PINS')} or the docblocks that quote the constraints; read ${terraformTf} and change them in this pull request before merging.`;
}

function bumpSection(result) {
  return [
    '',
    `#### ${code(result.name)} ${result.from} → ${result.to}`,
    '',
    releaseNotesLine(result),
    envLine(result),
    providersLine(result),
  ].filter((line) => line !== null);
}

/** The Markdown the workflow puts in the pull request body. */
export function summarize({ results, today }) {
  const moved = results.filter((result) => result.moved);
  return [
    `### Azure Verified Module pins, checked ${today}`,
    '',
    headline(results, moved, today),
    '',
    '| Module | Pinned | Registry | Release notes |',
    '| --- | --- | --- | --- |',
    ...results.map(tableRow),
    ...moved.flatMap(bumpSection),
    '',
  ].join('\n');
}
