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
 *
 * TWO FILES. This one owns everything that touches the network, the
 * filesystem or the clock; avm-versions-edits.mjs owns the version
 * comparison, the registry-document validation, the text edits and the
 * summary, and is re-exported here so a test imports from one place.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import prettier from 'prettier';

import { AVM_MODULES } from '../src/lib/landingZone/avmVersions.js';
import {
  EditRefused,
  RegistryError,
  UNKNOWN_DRIFT,
  envVendors,
  isNewer,
  latestFromRegistry,
  providerDrift,
  providersAt,
  registryModuleUrl,
  registryVersionsUrl,
  releaseNotesUrl,
  rewriteEnv,
  rewritePin,
  stampVerifiedOn,
  summarize,
  tarballUrl,
  terraformTfUrl,
} from './avm-versions-edits.mjs';

export * from './avm-versions-edits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');

export const PINS_FILE = path.join(frontendRoot, 'src', 'lib', 'landingZone', 'avmVersions.js');
export const VERSIONS_ENV_FILE = path.join(repoRoot, 'lab-image', 'versions.env');

const USER_AGENT =
  'HCW-HybridCloudWorks update-avm-versions (+https://github.com/HybridCloudWorks/HCW-HybridCloudWorks)';

// --- fetching ---------------------------------------------------------------

/**
 * A GET that either returns an OK response or throws RegistryError with one
 * sentence. `describeStatus` turns a non-2xx status into that sentence, so
 * a 404 on a tarball can say "GitHub has no tag" rather than just "404".
 */
async function fetchOk(url, fetchImpl, headers, describeStatus) {
  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new RegistryError(
      `${url} could not be fetched (${error.message}), so nothing was written.`
    );
  }
  if (!response.ok) throw new RegistryError(describeStatus(response.status));
  return response;
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchOk(
    url,
    fetchImpl,
    { accept: 'application/json', 'user-agent': USER_AGENT },
    (status) => `${url} answered HTTP ${status}, so nothing was written.`
  );
  return response.json().catch(() => {
    throw new RegistryError(`${url} did not return JSON, so nothing was written.`);
  });
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
  const response = await fetchOk(
    url,
    fetchImpl,
    { 'user-agent': USER_AGENT },
    (status) =>
      `${url} answered HTTP ${status}: the registry lists ${name} ${version} but GitHub has no tag v${version}, so nothing was written.`
  );
  return sha256Hex(await response.arrayBuffer());
}

// --- checking and applying --------------------------------------------------

/** The provider drift for a moved module, from the registry's versions document. */
async function driftFor(module, version, fetchImpl) {
  const versions = await fetchJson(registryVersionsUrl(module.name), fetchImpl);
  return providerDrift([...module.requiredProviders], providersAt(versions, version));
}

async function checkModule(module, fetchImpl) {
  const latest = latestFromRegistry(
    await fetchJson(registryModuleUrl(module.name), fetchImpl),
    module.name
  );
  const moved = isNewer(latest.version, module.version);
  return {
    name: module.name,
    from: module.version,
    to: latest.version,
    moved,
    publishedAt: latest.publishedAt,
    requiredProviders: [...module.requiredProviders],
    drift: moved ? await driftFor(module, latest.version, fetchImpl) : UNKNOWN_DRIFT,
    releaseNotes: releaseNotesUrl(module.name, latest.version),
    terraformTf: terraformTfUrl(module.name, latest.version),
    vendored: null,
    sha256: null,
  };
}

/**
 * One result per pinned module: what is pinned, what the registry lists, and
 * whether the two differ. Only reads; nothing here writes.
 */
export async function checkModules({ modules = AVM_MODULES, fetchImpl = fetch } = {}) {
  const results = [];
  for (const module of Object.values(modules)) {
    results.push(await checkModule(module, fetchImpl));
  }
  return results;
}

/**
 * Apply one bump to both files' text. Downloads the tarball even when the
 * lab image does not vendor the module, because the download is also the
 * proof that the registry's version exists as a tag on GitHub — the
 * cross-check avmVersions.js says every pin has had.
 */
async function applyBump(state, result, fetchImpl) {
  const pinsSource = rewritePin(state.pinsSource, result.name, result.from, result.to);
  result.sha256 = await fetchTarballSha256(result.name, result.to, fetchImpl);
  result.vendored = envVendors(state.envSource, result.name);
  const envSource = result.vendored
    ? rewriteEnv(state.envSource, result.name, result.from, result.to, result.sha256)
    : state.envSource;
  return { pinsSource, envSource };
}

/** Apply every bump, then stamp the date once if anything moved. */
export async function applyChanges({ results, pinsSource, envSource, today, fetchImpl = fetch }) {
  const moved = results.filter((result) => result.moved);
  let state = { pinsSource, envSource };
  for (const result of moved) {
    state = await applyBump(state, result, fetchImpl);
  }
  if (moved.length > 0) state.pinsSource = stampVerifiedOn(state.pinsSource, today);
  return { ...state, results };
}

// --- entry point -----------------------------------------------------------

const USAGE = 'Usage: node scripts/update-avm-versions.mjs [--dry-run] [--summary <path>]';

const ARG_HANDLERS = {
  '--dry-run': (args) => {
    args.dryRun = true;
    return 0;
  },
  '--summary': (args, next) => {
    args.summaryPath = next || null;
    return 1;
  },
};

export function parseArgs(argv) {
  const args = { dryRun: false, summaryPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const handler = ARG_HANDLERS[argv[index]];
    if (!handler) throw new TypeError(`Unknown argument ${argv[index]}. ${USAGE}`);
    index += handler(args, argv[index + 1]);
  }
  return args;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Write the bumped files, Prettier-formatting the pins; returns what was written. */
async function writeChanges(next, envSource) {
  const formatted = await prettier.format(next.pinsSource, {
    ...(await prettier.resolveConfig(PINS_FILE)),
    filepath: PINS_FILE,
  });
  await fs.writeFile(PINS_FILE, formatted);
  const written = [path.relative(repoRoot, PINS_FILE)];
  if (next.envSource !== envSource) {
    await fs.writeFile(VERSIONS_ENV_FILE, next.envSource);
    written.push(path.relative(repoRoot, VERSIONS_ENV_FILE));
  }
  return written;
}

function describeRun(movedCount, dryRun, written) {
  if (movedCount === 0) return 'No pin moved; nothing was written.';
  if (dryRun) return `Dry run: ${movedCount} pin(s) would move; nothing was written.`;
  return `Rewrote ${written.join(' and ')}.`;
}

export async function main(argv = process.argv.slice(2)) {
  const { dryRun, summaryPath } = parseArgs(argv);
  const today = todayIso();

  const results = await checkModules({ fetchImpl: fetch });
  const pinsSource = await fs.readFile(PINS_FILE, 'utf8');
  const envSource = await fs.readFile(VERSIONS_ENV_FILE, 'utf8');
  const next = await applyChanges({ results, pinsSource, envSource, today, fetchImpl: fetch });
  const movedCount = results.filter((result) => result.moved).length;

  const written = movedCount > 0 && !dryRun ? await writeChanges(next, envSource) : [];

  const summary = summarize({ results, today });
  if (summaryPath) await fs.writeFile(summaryPath, summary);

  console.log(describeRun(movedCount, dryRun, written));
  console.log('');
  console.log(summary);
}

/** One sentence for a source failure or a refused edit; the stack for a bug. */
const isOperatorError = (error) =>
  [RegistryError, EditRefused, TypeError].some((kind) => error instanceof kind);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(isOperatorError(error) ? error.message : error);
    process.exit(1);
  });
}
