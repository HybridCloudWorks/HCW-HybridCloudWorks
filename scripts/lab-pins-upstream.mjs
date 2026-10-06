/**
 * lab-pins-upstream.mjs — are the lab host's pinned versions behind upstream?
 *
 * Everything on the lab host is pinned and held: Docker Engine and containerd
 * (which carries runc), Caddy and its Cloudflare module, Coder, PostgreSQL,
 * Portainer, Vault, node_exporter, Node.js. That is right for a host that runs
 * untrusted code — nothing moves without a reviewed change — and it has a
 * cost the 2026-10-06 estate review named (finding LAB-3): no mechanism
 * noticed when a pin fell behind, so a runc or containerd advisory after the
 * pin date stayed unpatched until a human happened to look. Dependabot cannot
 * read Ansible group_vars.
 *
 * This script is that mechanism's eyes. It reads the pins from
 * lab-host/ansible/group_vars/all.yml (by regex over the lines the pins are
 * on, not a YAML parser: the file is one document and every pin is a scalar
 * on its own line), asks each publisher for its newest stable version, and
 * prints a table. Exit 0 when every pin is current, 1 when one is behind, 2
 * when a source could not be read — the last is "cannot evaluate", not
 * "fine", for the reason .claude/CLAUDE.md gives: a check that cannot run has
 * not run.
 *
 * It does not bump anything. Most of these pins come with a checksum or a
 * digest that has to be read from the publisher and reviewed beside the
 * version, so the bump is a pull request a person reads;
 * .github/workflows/lab-supply-chain.yml turns a non-zero exit into an issue
 * that names what moved. Automating the bump itself is the next step.
 *
 * Usage: node scripts/lab-pins-upstream.mjs [--summary <file>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const GROUP_VARS = join(REPO, 'lab-host', 'ansible', 'group_vars', 'all.yml');
const USER_AGENT =
  'HCW-HybridCloudWorks lab-pins-upstream (+https://github.com/HybridCloudWorks/HCW-HybridCloudWorks)';

// ── Version arithmetic ─────────────────────────────────────────────────────

/** `5:29.8.1-1~ubuntu.26.04~resolute` → `29.8.1`; `v2.11.4` → `2.11.4`; `18.6` → `18.6`. */
export function coreVersion(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/(\d+(?:\.\d+)+)/);
  return m ? m[1] : null;
}

/** Numeric, segment-wise comparison of dotted versions. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Newest of a list of version strings, by compareVersions; null when empty. */
export function newest(versions) {
  return versions.reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
}

const STABLE = /^\d+(\.\d+)+$/;
const isStable = (v) => STABLE.test(v);

// ── Reading the pins ───────────────────────────────────────────────────────

/** The scalar value of `key: value` on its own line, quotes stripped; null when absent. */
export function scalar(text, key) {
  const m = text.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n#]+?)"?\\s*(?:#.*)?$`, 'm'));
  return m ? m[1].trim() : null;
}

/** The pins this script watches, read from group_vars/all.yml. */
export function readPins(text) {
  // docker_release_pins is nested: take the resolute (26.04) block's values.
  const resolute = text.match(/^docker_release_pins:\s*\n\s+resolute:\s*\n([\s\S]*?)\n\s+noble:/m)?.[1] ?? '';
  return {
    dockerEngine: coreVersion(scalar(resolute, 'engine')),
    containerd: coreVersion(scalar(resolute, 'containerd')),
    caddy: coreVersion(scalar(text, 'caddy_version')),
    caddyCloudflare: coreVersion(scalar(text, 'caddy_cloudflare_module_version')),
    coder: coreVersion(scalar(text, 'coder_image_tag')),
    postgres: coreVersion(scalar(text, 'coder_postgres_image_tag')),
    portainer: coreVersion(scalar(text, 'portainer_image_tag')),
    vault: coreVersion(scalar(text, 'vault_version')),
    nodeExporter: coreVersion(scalar(text, 'node_exporter_version')),
    node: coreVersion(scalar(text, 'labs_agent_node_version')),
  };
}

// ── Upstream readers ───────────────────────────────────────────────────────

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}
async function fetchJson(url, headers = {}) {
  return JSON.parse(await fetchText(url, { Accept: 'application/json', ...headers }));
}

/** Newest stable version in a Debian Packages index for one package name. */
export function newestAptVersion(packagesText, packageName) {
  const versions = [];
  for (const stanza of packagesText.split(/\n\n+/)) {
    if (!new RegExp(`^Package: ${packageName}$`, 'm').test(stanza)) continue;
    const v = coreVersion(stanza.match(/^Version: (.+)$/m)?.[1]);
    if (v) versions.push(v);
  }
  return newest(versions);
}

/** Newest stable tag from a GitHub releases listing (prereleases and drafts skipped). */
export function newestGitHubRelease(releases) {
  const versions = releases
    .filter((r) => !r.prerelease && !r.draft)
    .map((r) => coreVersion(r.tag_name))
    .filter((v) => v && isStable(v));
  return newest(versions);
}

/** Newest stable tag from a GitHub tags listing (for a repository that tags but publishes no releases). */
export function newestGitHubTag(tags) {
  const versions = tags.map((t) => coreVersion(t.name)).filter((v) => v && isStable(v));
  return newest(versions);
}

/** Newest stable version from releases.hashicorp.com/<product>/index.json. */
export function newestHashicorp(index) {
  return newest(Object.keys(index.versions ?? {}).filter(isStable));
}

/** Newest tag in a Docker Hub tag listing that starts with `line.` (e.g. `18.` → 18.x). */
export function newestDockerHubTag(results, line) {
  const versions = results
    .map((t) => t.name)
    .filter((name) => new RegExp(`^${line.replace('.', '\\.')}\\.\\d+$`).test(name));
  return newest(versions);
}

/** Newest release in one major line from nodejs.org/dist/index.json. */
export function newestNodeLine(index, major) {
  const versions = index
    .map((e) => coreVersion(e.version))
    .filter((v) => v && v.startsWith(`${major}.`));
  return newest(versions);
}

function githubHeaders(env) {
  return env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {};
}

/** Every source, each returning the newest stable version or throwing. */
export function sources(env = process.env) {
  const gh = (repo) => async () =>
    newestGitHubRelease(await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=30`, githubHeaders(env)));
  // caddy-dns/cloudflare tags its versions and publishes no releases.
  const ghTags = (repo) => async () =>
    newestGitHubTag(await fetchJson(`https://api.github.com/repos/${repo}/tags?per_page=30`, githubHeaders(env)));
  const dockerApt = 'https://download.docker.com/linux/ubuntu/dists/resolute/stable/binary-amd64/Packages';
  return {
    dockerEngine: async () => newestAptVersion(await fetchText(dockerApt), 'docker-ce'),
    containerd: async () => newestAptVersion(await fetchText(dockerApt), 'containerd.io'),
    caddy: gh('caddyserver/caddy'),
    caddyCloudflare: ghTags('caddy-dns/cloudflare'),
    coder: gh('coder/coder'),
    postgres: async () =>
      newestDockerHubTag(
        (await fetchJson('https://hub.docker.com/v2/repositories/library/postgres/tags?page_size=100&name=18.')).results,
        '18'
      ),
    portainer: gh('portainer/portainer'),
    vault: async () => newestHashicorp(await fetchJson('https://releases.hashicorp.com/vault/index.json')),
    nodeExporter: gh('prometheus/node_exporter'),
    node: async () => newestNodeLine(await fetchJson('https://nodejs.org/dist/index.json'), 26),
  };
}

export const LABELS = {
  dockerEngine: 'Docker Engine (docker-ce, Ubuntu 26.04 apt)',
  containerd: 'containerd.io (carries runc)',
  caddy: 'Caddy',
  caddyCloudflare: 'caddy-dns/cloudflare',
  coder: 'Coder',
  postgres: 'PostgreSQL image (18 line)',
  portainer: 'Portainer',
  vault: 'HashiCorp Vault',
  nodeExporter: 'node_exporter',
  node: 'Node.js (26 line)',
};

// ── Run ────────────────────────────────────────────────────────────────────

/** Compare pins to upstream; returns rows and a verdict. Injectable for tests. */
export async function check({ pins, readers }) {
  const rows = [];
  for (const key of Object.keys(LABELS)) {
    const pinned = pins[key];
    let latest = null;
    let error = null;
    try {
      latest = await readers[key]();
      if (!latest) throw new Error('no stable version found');
    } catch (e) {
      error = e?.message || String(e);
    }
    let status;
    if (!pinned) status = 'pin not found';
    else if (error) status = `unreadable: ${error}`;
    else status = compareVersions(pinned, latest) < 0 ? 'BEHIND' : 'current';
    rows.push({ key, label: LABELS[key], pinned, latest, status });
  }
  const unreadable = rows.some((r) => r.status.startsWith('unreadable') || r.status === 'pin not found');
  const behind = rows.some((r) => r.status === 'BEHIND');
  return { rows, exitCode: unreadable ? 2 : behind ? 1 : 0 };
}

export function renderMarkdown(rows) {
  const lines = ['| Component | Pinned | Newest stable | Status |', '| --- | --- | --- | --- |'];
  for (const r of rows) lines.push(`| ${r.label} | ${r.pinned ?? '—'} | ${r.latest ?? '—'} | ${r.status} |`);
  return lines.join('\n');
}

async function main(argv) {
  const summaryAt = argv.includes('--summary') ? argv[argv.indexOf('--summary') + 1] : null;
  const pins = readPins(readFileSync(GROUP_VARS, 'utf8'));
  const { rows, exitCode } = await check({ pins, readers: sources() });
  const table = renderMarkdown(rows);
  const heading =
    exitCode === 0
      ? 'Every lab host pin is current.'
      : exitCode === 1
        ? 'At least one lab host pin is behind upstream.'
        : 'At least one source could not be read; the check did not evaluate.';
  const out = `## Lab host pins against upstream\n\n${heading}\n\n${table}\n`;
  process.stdout.write(out);
  if (summaryAt) writeFileSync(summaryAt, out);
  process.exitCode = exitCode;
}

if (process.argv[1] && process.argv[1].endsWith('lab-pins-upstream.mjs')) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 2;
  });
}
