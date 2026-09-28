/**
 * The lab_images role's plan: which lab images this host holds, which it has
 * to pull, and which stale ones it removes (roles/lab_images/README.md).
 *
 * The pins are read from checkouts of this repository, never copied, so a
 * pin bump reaches the host with no second edit:
 *
 *   - every value of `IMAGES` in vps-agent/lib/capabilities.js, read by
 *     importing that module, so Node itself is the parser and whatever the
 *     module exports is what gets pulled;
 *   - the Coder workspace image, `local.image` in
 *     lab-host/coder/templates/hcw-lab/main.tf, rebuilt from the template's
 *     `image` and `image_digest` locals the way Terraform does.
 *
 * Every pin must be `name[:tag]@sha256:<64 hex>`. A tag alone is refused,
 * as capabilities.test.js refuses it, because a mutable tag is the thing the
 * digest pins exist to rule out.
 *
 * Pulls are named `repository@digest`, without the tag. Docker ignores the
 * tag of a reference that carries a digest, and community.docker's
 * docker_image_pull splits `name:tag@digest` at the `@` and then looks for a
 * repository literally named `name:tag`, which it never finds, so the tagged
 * form would pull on every run.
 *
 * Removals are every reference Docker lists for an image in one of the lab's
 * own repositories (the repositories the pins name, and anything under
 * ghcr.io/hybridcloudworks/hcw-lab*) when none of the image's references is
 * a pin. An image that a container, running or stopped, still uses is kept
 * and reported instead, and a reference in any other repository is never
 * listed, so an image that also carries one keeps its data.
 *
 * Usage, with the Docker API's /images/json and /containers/json?all=1 on
 * stdin as {"images": [...], "containers": [...]} (what
 * community.docker.docker_host_info returns with verbose_output):
 *
 *   node lab-images.mjs [--pull-workspace] <checkout> [<checkout> ...]
 *
 * Prints the plan as one JSON object on stdout. Exits 1, with the reason on
 * stderr, when a checkout lacks either file, a pin is not a digest
 * reference, or the template's image cannot be found.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where the pins live, relative to a checkout of this repository. */
export const CAPABILITIES_FILE = 'vps-agent/lib/capabilities.js';
export const WORKSPACE_TEMPLATE_FILE = 'lab-host/coder/templates/hcw-lab/main.tf';

/**
 * The lab's own repositories beyond the ones the pins name: the images
 * lab-image/ builds and publish-lab-image.yml pushes. A stale image here is
 * removed even when no current pin names its repository.
 */
export const LAB_REPOSITORY_PATTERN = /^ghcr\.io\/hybridcloudworks\/hcw-lab[a-z0-9._-]*$/;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PATH_COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const REPOSITORY = new RegExp(`^(?:[a-zA-Z0-9.-]+(?::[0-9]+)?/)?${PATH_COMPONENT}(?:/${PATH_COMPONENT})*$`);
const TAG = /^[\w][\w.-]{0,127}$/;

/**
 * Docker's familiar form of a repository name, the form /images/json uses in
 * RepoTags and RepoDigests: Docker Hub's host and its `library/` namespace
 * are dropped, so `docker.io/library/alpine` and `alpine` compare equal.
 */
export function familiarRepository(repository) {
  let name = repository;
  for (const hub of ['docker.io/', 'index.docker.io/', 'registry-1.docker.io/']) {
    if (name.startsWith(hub)) {
      name = name.slice(hub.length);
      break;
    }
  }
  if (name.startsWith('library/') && name.split('/').length === 2) {
    name = name.slice('library/'.length);
  }
  return name;
}

/**
 * Split an image reference into repository (familiar form), tag and digest.
 * Returns null for anything that is not a reference, such as Docker's
 * `<none>:<none>` placeholder.
 */
export function parseReference(reference) {
  if (typeof reference !== 'string') return null;
  let name = reference;
  let digest = null;
  const at = name.indexOf('@');
  if (at !== -1) {
    digest = name.slice(at + 1);
    name = name.slice(0, at);
    if (!DIGEST.test(digest)) return null;
  }
  let tag = null;
  const colon = name.lastIndexOf(':');
  if (colon > name.lastIndexOf('/')) {
    tag = name.slice(colon + 1);
    name = name.slice(0, colon);
    if (!TAG.test(tag)) return null;
  }
  if (!REPOSITORY.test(name)) return null;
  return { repository: familiarRepository(name), tag, digest };
}

/** The reference Docker lists for a parsed reference, digest first. */
function formatReference({ repository, tag, digest }) {
  return digest ? `${repository}@${digest}` : `${repository}:${tag}`;
}

/**
 * One pin, checked: it must carry a digest. `source` names where it came
 * from, so a refusal says which entry to fix.
 */
export function pinFrom(reference, source) {
  const parsed = parseReference(reference);
  if (!parsed || !parsed.digest) {
    throw new Error(
      `${source} is ${JSON.stringify(reference)}, which is not an image pinned by digest (name[:tag]@sha256:<64 hex>)`
    );
  }
  return {
    source,
    reference,
    repository: parsed.repository,
    digest: parsed.digest,
    pull: `${parsed.repository}@${parsed.digest}`,
  };
}

/** Terraform source with comment lines removed, so a commented-out local is not read. */
function codeLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join('\n');
}

function onlyMatch(text, pattern, what, source) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `${source}: expected exactly one ${what}, found ${matches.length}; the lab_images plan reads the workspace image from it`
    );
  }
  return matches[0][1];
}

/**
 * The workspace image the Coder template runs: `local.image`, which main.tf
 * builds as "<repository>@${local.image_digest}".
 */
export function workspaceImageFromTemplate(text, source) {
  const code = codeLines(text);
  const digest = onlyMatch(
    code,
    /^\s*image_digest\s*=\s*"(sha256:[0-9a-f]{64})"\s*$/gm,
    '`image_digest = "sha256:<64 hex>"` local',
    source
  );
  const repository = onlyMatch(
    code,
    /^\s*image\s*=\s*"([^"@$]+)@\$\{local\.image_digest\}"\s*$/gm,
    '`image = "<repository>@${local.image_digest}"` local',
    source
  );
  return pinFrom(`${repository}@${digest}`, source);
}

/** The pins one checkout carries: the capability images and the workspace image. */
export async function readPins(checkout) {
  const capabilitiesPath = path.resolve(checkout, CAPABILITIES_FILE);
  const templatePath = path.resolve(checkout, WORKSPACE_TEMPLATE_FILE);
  const { IMAGES } = await import(pathToFileURL(capabilitiesPath).href);
  if (!IMAGES || typeof IMAGES !== 'object' || Object.keys(IMAGES).length === 0) {
    throw new Error(`${capabilitiesPath} exports no IMAGES entries`);
  }
  const capabilities = Object.entries(IMAGES).map(([key, reference]) =>
    pinFrom(reference, `IMAGES.${key} in ${capabilitiesPath}`)
  );
  const workspace = workspaceImageFromTemplate(await readFile(templatePath, 'utf8'), templatePath);
  return { checkout: path.resolve(checkout), capabilities, workspace };
}

function unique(values) {
  return [...new Set(values)];
}

function containerName(container) {
  const [name] = container.Names || [];
  return name ? name.replace(/^\//, '') : String(container.Id || '').slice(0, 12);
}

/**
 * The plan. `checkouts` is readPins' result for each checkout; the pins of
 * all of them are held (the union), so an agent held at an older commit keeps
 * its images while the playbook's commit gets its own.
 *
 * @returns {{
 *   pinned: string[],        every pin, as repository@digest
 *   pull: string[],          what to pull (docker_image_pull, pull: not_present)
 *   remove: string[],        references to remove (docker image rm), tags before digests
 *   in_use: {image: string, references: string[], containers: string[]}[],
 *   checkouts: string[],
 * }}
 */
export function planImages({ checkouts, pullWorkspace = false, images = [], containers = [] }) {
  const pins = checkouts.flatMap((c) => [...c.capabilities, c.workspace]);
  const pinned = new Set(pins.map((p) => p.pull));
  const pinnedRepositories = new Set(pins.map((p) => p.repository));
  const isLabRepository = (repository) =>
    pinnedRepositories.has(repository) || LAB_REPOSITORY_PATTERN.test(repository);

  const pull = unique(
    checkouts.flatMap((c) => [...c.capabilities, ...(pullWorkspace ? [c.workspace] : [])]).map((p) => p.pull)
  );

  const remove = [];
  const inUse = [];
  for (const image of images) {
    const references = unique([...(image.RepoTags || []), ...(image.RepoDigests || [])])
      .map(parseReference)
      .filter(Boolean);
    const ours = references.filter((r) => isLabRepository(r.repository));
    if (ours.length === 0) continue;
    if (references.some((r) => r.digest && pinned.has(`${r.repository}@${r.digest}`))) continue;

    // Tags first: in the classic image store, removing a digest reference
    // leaves the image's tags in place.
    const stale = unique([
      ...ours.filter((r) => !r.digest).map(formatReference),
      ...ours.filter((r) => r.digest).map(formatReference),
    ]);
    const users = containers.filter((c) => c.ImageID && c.ImageID === image.Id).map(containerName);
    if (users.length > 0) {
      inUse.push({ image: image.Id, references: stale, containers: users });
    } else {
      remove.push(...stale);
    }
  }

  return {
    pinned: [...pinned],
    pull,
    remove: unique(remove),
    in_use: inUse,
    checkouts: checkouts.map((c) => c.checkout),
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(args) {
  const pullWorkspace = args.includes('--pull-workspace');
  const checkoutArgs = unique(args.filter((a) => a !== '--pull-workspace'));
  if (checkoutArgs.length === 0) {
    throw new Error('usage: node lab-images.mjs [--pull-workspace] <checkout> [<checkout> ...] < docker-host.json');
  }
  const input = (await readStdin()).trim();
  const host = input ? JSON.parse(input) : {};
  const checkouts = [];
  for (const checkout of checkoutArgs) checkouts.push(await readPins(checkout));
  return planImages({
    checkouts,
    pullWorkspace,
    images: host.images || [],
    containers: host.containers || [],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (plan) => process.stdout.write(`${JSON.stringify(plan)}\n`),
    (error) => {
      process.stderr.write(`lab-images: ${error.message}\n`);
      process.exit(1);
    }
  );
}
