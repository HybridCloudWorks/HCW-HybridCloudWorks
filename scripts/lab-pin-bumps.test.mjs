import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CAPABILITIES_PATH,
  CODER_TEMPLATE_PATH,
  DOCKERFILE_PATH,
  GROUP_VARS_PATH,
  HOST_BUMPERS,
  SANDBOX_DOCKERFILE_PATH,
  VERSIONS_ENV_PATH,
  aptPick,
  compareDebian,
  goSumHash,
  inReleaseSha256,
  makeHttp,
  parseImageRef,
  planHost,
  planImageBase,
  planImageDigests,
  readEnv,
  readManifest,
  registryOf,
  renderEvidence,
  renderNotes,
  renderPlan,
  replaceFrom,
  resolveTag,
  setEnvValue,
  setYamlScalar,
  sumsLine,
} from './lib/lab-pin-bumps.mjs';
import { LABELS } from './lab-pins-upstream.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const real = (path) => readFileSync(join(REPO, path), 'utf8');
const sha = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const hex = (c) => c.repeat(64);

/** A fetch that serves a fixed map of URL → body (string or object) with optional headers; anything else 404s. */
function fakeFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    const { body, headers = {} } = typeof route === 'object' && 'body' in route ? route : { body: route };
    const bytes = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(bytes, { status: 200, headers });
  };
}

describe('editing one line', () => {
  const groupVars = real(GROUP_VARS_PATH);

  it('moves one codename entry of docker_release_pins and keeps the quotes', () => {
    const { text, from, line } = setYamlScalar(groupVars, ['docker_release_pins', 'noble', 'engine'], '5:29.9.0-1~ubuntu.24.04~noble');
    expect(from).toBe('5:29.8.1-1~ubuntu.24.04~noble');
    expect(text.split('\n')[line - 1]).toBe('    engine: "5:29.9.0-1~ubuntu.24.04~noble"');
    const changed = text.split('\n').filter((l, i) => l !== groupVars.split('\n')[i]);
    expect(changed).toHaveLength(1);
    expect(text).toContain('    engine: "5:29.8.1-1~ubuntu.26.04~resolute"');
  });

  it('edits an unquoted top-level scalar and does not confuse a key with its prefix', () => {
    const { text, from } = setYamlScalar(groupVars, ['coder_image'], 'ghcr.io/coder/coder2');
    expect(from).toBe('ghcr.io/coder/coder');
    expect(text).toContain('coder_image: ghcr.io/coder/coder2\n');
    expect(text).toContain('coder_image_tag: v2.38.0\n');
    expect(setYamlScalar(groupVars, ['coder_postgres_image_tag'], '18.7').text).toContain('coder_postgres_image_tag: "18.7"\n');
  });

  it('refuses a key that is absent, and a value that is not a scalar on its line', () => {
    expect(() => setYamlScalar(groupVars, ['no_such_pin'], 'x')).toThrow(/found 0/);
    expect(() => setYamlScalar(groupVars, ['docker_release_pins'], 'x')).toThrow(/not a scalar/);
    expect(() => setYamlScalar(groupVars, ['docker_release_pins', 'jammy', 'engine'], 'x')).toThrow(/found 0/);
  });

  it('sets one versions.env line and refuses a missing one', () => {
    const env = real(VERSIONS_ENV_PATH);
    const { text, from } = setEnvValue(env, 'BASE_DIGEST', `sha256:${hex('a')}`);
    expect(from).toBe(readEnv(env).BASE_DIGEST);
    expect(readEnv(text).BASE_DIGEST).toBe(`sha256:${hex('a')}`);
    expect(() => setEnvValue(env, 'NOPE', 'x')).toThrow(/found 0/);
  });

  it('replaces every external FROM in the Dockerfile and none of its stages', () => {
    const env = readEnv(real(VERSIONS_ENV_PATH));
    const dockerfile = real(DOCKERFILE_PATH);
    const oldRef = `${env.BASE_IMAGE}@${env.BASE_DIGEST}`;
    const { text, count } = replaceFrom(dockerfile, oldRef, `python:9.9.9-slim-trixie@sha256:${hex('b')}`);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain(`FROM ${oldRef}`);
    expect(text).toContain('FROM fetch AS vendor');
    expect(() => replaceFrom(dockerfile, 'python:0@sha256:0', 'x')).toThrow(/no FROM/);
    const sandbox = real(SANDBOX_DOCKERFILE_PATH);
    expect(replaceFrom(sandbox, `${env.SANDBOX_BASE_IMAGE}@${env.SANDBOX_BASE_DIGEST}`, 'x').count).toBe(1);
  });
});

describe('reading publisher indexes', () => {
  const packages = [
    'Package: docker-ce\nVersion: 5:29.8.2-1~ubuntu.26.04~resolute\nFilename: pool/docker-ce_29.8.2.deb\nSHA256: ' + hex('1'),
    'Package: docker-ce-cli\nVersion: 5:29.8.2-1~ubuntu.26.04~resolute\nSHA256: ' + hex('2'),
    'Package: docker-ce\nVersion: 5:29.8.1-1~ubuntu.26.04~resolute\nSHA256: ' + hex('3'),
    'Package: containerd.io\nVersion: 2.3.7-1~ubuntu.26.04~resolute',
  ].join('\n\n');

  it('picks the newest Debian revision of one upstream version', () => {
    const rebuilt = [
      `Package: docker-buildx-plugin\nVersion: 0.37.1-1~ubuntu.26.04~resolute\nSHA256: ${hex('1')}`,
      `Package: docker-buildx-plugin\nVersion: 0.37.1-2~ubuntu.26.04~resolute\nSHA256: ${hex('2')}`,
    ].join('\n\n');
    expect(aptPick(rebuilt, 'docker-buildx-plugin', '0.37.1').version).toBe('0.37.1-2~ubuntu.26.04~resolute');
    expect(compareDebian('5:29.8.2-1~ubuntu.26.04~resolute', '5:29.8.10-1~ubuntu.26.04~resolute')).toBe(-1);
    expect(compareDebian('26.10.0-1nodesource1', '26.10.0-1nodesource1')).toBe(0);
  });

  it('picks the one stanza for an upstream version, with its SHA256', () => {
    expect(aptPick(packages, 'docker-ce', '29.8.2')).toEqual({
      version: '5:29.8.2-1~ubuntu.26.04~resolute',
      sha256: hex('1'),
      filename: 'pool/docker-ce_29.8.2.deb',
    });
    expect(() => aptPick(packages, 'docker-ce', '30.0.0')).toThrow(/not in the index/);
    expect(() => aptPick(packages, 'containerd.io', '2.3.7')).toThrow(/no SHA256/);
  });

  it('reads the SHA256 InRelease lists for an index, and nothing from the MD5 section', () => {
    const inRelease = [
      '-----BEGIN PGP SIGNED MESSAGE-----',
      'Suite: resolute',
      'MD5Sum:',
      ` ${'f'.repeat(32)}  154747 stable/binary-amd64/Packages`,
      'SHA256:',
      ` ${hex('c')}  154747 stable/binary-amd64/Packages`,
      ` ${hex('d')}  27784 stable/binary-amd64/Packages.bz2`,
      '-----BEGIN PGP SIGNATURE-----',
    ].join('\n');
    expect(inReleaseSha256(inRelease, 'stable/binary-amd64/Packages')).toBe(hex('c'));
    expect(inReleaseSha256(inRelease, 'stable/binary-arm64/Packages')).toBeNull();
  });

  it('reads a sha256sum line and a Go checksum database line', () => {
    expect(sumsLine(`${hex('e')}  vault_2.1.2_linux_amd64.zip\n${hex('f')}  vault_2.1.2_darwin_arm64.zip\n`, 'vault_2.1.2_linux_amd64.zip')).toBe(hex('e'));
    expect(sumsLine('', 'x')).toBeNull();
    const lookup = '51560342\ngithub.com/caddy-dns/cloudflare v0.2.5 h1:abc+/=\ngithub.com/caddy-dns/cloudflare v0.2.5/go.mod h1:zzz=\n';
    expect(goSumHash(lookup, 'github.com/caddy-dns/cloudflare', 'v0.2.5')).toBe('h1:abc+/=');
  });

  it('names the registry an image lives in', () => {
    expect(registryOf('caddy').repository).toBe('library/caddy');
    expect(registryOf('portainer/portainer-ee').hubTags).toBe('https://hub.docker.com/v2/repositories/portainer/portainer-ee/tags/');
    expect(registryOf('ghcr.io/coder/coder')).toMatchObject({ host: 'ghcr.io', repository: 'coder/coder', hubTags: null });
    expect(parseImageRef(`ghcr.io/hybridcloudworks/hcw-lab:abc@sha256:${hex('0')}`)).toEqual({
      name: 'ghcr.io/hybridcloudworks/hcw-lab',
      tag: 'abc',
      digest: `sha256:${hex('0')}`,
    });
    expect(parseImageRef('Not An Image')).toBeNull();
  });
});

describe('registry reads', () => {
  const manifest = JSON.stringify({ schemaVersion: 2, manifests: [] });
  const token = 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/caddy:pull';
  const url = 'https://registry-1.docker.io/v2/library/caddy/manifests/2.11.7-builder';
  const hub = 'https://hub.docker.com/v2/repositories/library/caddy/tags/2.11.7-builder';

  it('hashes the bytes it was served and refuses a Docker-Content-Digest that disagrees', async () => {
    const good = makeHttp(fakeFetch({ [token]: { token: 't' }, [url]: { body: manifest, headers: { 'docker-content-digest': sha(manifest) } } }));
    expect((await readManifest(good, 'caddy', '2.11.7-builder')).digest).toBe(sha(manifest));
    const bad = makeHttp(fakeFetch({ [token]: { token: 't' }, [url]: { body: manifest, headers: { 'docker-content-digest': `sha256:${hex('0')}` } } }));
    await expect(readManifest(bad, 'caddy', '2.11.7-builder')).rejects.toThrow(/hash to/);
  });

  it('requires Docker Hub\'s API to report the same digest as the registry', async () => {
    const agree = makeHttp(fakeFetch({ [token]: { token: 't' }, [url]: manifest, [hub]: { digest: sha(manifest) } }));
    const resolved = await resolveTag(agree, 'caddy', '2.11.7-builder');
    expect(resolved.digest).toBe(sha(manifest));
    expect(resolved.reads).toHaveLength(2);
    const disagree = makeHttp(fakeFetch({ [token]: { token: 't' }, [url]: manifest, [hub]: { digest: `sha256:${hex('9')}` } }));
    await expect(resolveTag(disagree, 'caddy', '2.11.7-builder')).rejects.toThrow(/Docker Hub's API reports/);
  });
});

describe('the host plan', () => {
  const text = real(GROUP_VARS_PATH);
  const row = (key, pinned, latest, status = 'BEHIND') => ({ key, label: LABELS[key], pinned, latest, status });

  it('has a bump procedure for every pin the check watches', () => {
    expect(Object.keys(HOST_BUMPERS).sort()).toEqual(Object.keys(LABELS).sort());
  });

  it('edits only BEHIND rows, and turns a bump without evidence into a note that edits nothing', async () => {
    const bumpers = {
      vault: async () => ({
        edits: [
          { file: GROUP_VARS_PATH, where: 'vault_version', to: '2.1.2', apply: (t) => setYamlScalar(t, ['vault_version'], '2.1.2') },
          { file: GROUP_VARS_PATH, where: 'vault_checksum', to: `sha256:${hex('e')}`, apply: (t) => setYamlScalar(t, ['vault_checksum'], `sha256:${hex('e')}`) },
        ],
        evidence: [{ item: 'vault_2.1.2_linux_amd64.zip (SHA256)', value: hex('e'), source: 'https://releases.hashicorp.com/vault/2.1.2/vault_2.1.2_SHA256SUMS' }],
      }),
      coder: async () => {
        throw new Error('ghcr.io/coder/coder:v2.39.0: HTTP 404');
      },
      caddy: async () => {
        throw new Error('must not be called for a current row');
      },
    };
    const plan = await planHost({
      text,
      rows: [row('vault', '2.1.1', '2.1.2'), row('coder', '2.38.0', '2.39.0'), row('caddy', '2.11.4', '2.11.4', 'current')],
      http: null,
      bumpers,
    });
    expect(plan.applied.map((b) => b.key)).toEqual(['vault']);
    const out = plan.files[GROUP_VARS_PATH];
    expect(out).toContain('vault_version: "2.1.2"\n');
    expect(out).toContain(`vault_checksum: sha256:${hex('e')}\n`);
    expect(out).toContain('coder_image_tag: v2.38.0\n');
    expect(plan.notes).toEqual([{ label: LABELS.coder, from: '2.38.0', to: '2.39.0', reason: 'ghcr.io/coder/coder:v2.39.0: HTTP 404' }]);
    expect(renderPlan(plan.applied)).toContain('lab-host/ansible/group_vars/all.yml: vault_checksum: sha256:');
    const evidence = renderEvidence(plan.applied, { set: 'host', date: '2026-10-13' });
    expect(evidence).toContain('`node scripts/lab-pins-upstream.mjs --bump host`');
    expect(evidence).toContain(hex('e'));
    expect(evidence).toContain('https://releases.hashicorp.com/vault/2.1.2/vault_2.1.2_SHA256SUMS');
    expect(renderNotes(plan.notes)).toContain('**Coder** 2.38.0 → 2.39.0: ghcr.io/coder/coder:v2.39.0: HTTP 404');
  });

  it('re-reads a current image pin and moves its digest when the publisher re-pushed the same tag', async () => {
    const pinned = setYamlScalar(text, ['coder_postgres_image_digest'], 'x').from;
    const rebuilt = JSON.stringify({ rebuilt: true });
    const routes = (manifest) => ({
      'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/postgres:pull': { token: 't' },
      'https://registry-1.docker.io/v2/library/postgres/manifests/18.6': manifest,
      'https://hub.docker.com/v2/repositories/library/postgres/tags/18.6': { digest: sha(manifest) },
    });
    const plan = await planHost({ text, rows: [row('postgres', '18.6', '18.6', 'current')], http: makeHttp(fakeFetch(routes(rebuilt))) });
    expect(plan.applied).toHaveLength(1);
    expect(plan.applied[0].to).toBe('18.6 (same release, newer build)');
    expect(plan.files[GROUP_VARS_PATH]).toContain(`coder_postgres_image_digest: ${sha(rebuilt)}\n`);
    expect(plan.files[GROUP_VARS_PATH]).not.toContain(pinned);
    expect(plan.files[GROUP_VARS_PATH]).toContain('coder_postgres_image_tag: "18.6"\n');
  });

  it('proposes nothing for a current pin whose re-read matches, and never re-reads a released checksum file', async () => {
    let vaultCalls = 0;
    const same = async () => ({
      edits: [{ file: GROUP_VARS_PATH, where: 'coder_image_tag', to: 'v2.38.0', apply: (t) => setYamlScalar(t, ['coder_image_tag'], 'v2.38.0') }],
      evidence: [],
    });
    const plan = await planHost({
      text,
      rows: [row('coder', '2.38.0', '2.38.0', 'current'), row('vault', '2.1.1', '2.1.1', 'current')],
      http: null,
      bumpers: {
        coder: Object.assign(same, { refresh: true }),
        vault: async () => {
          vaultCalls += 1;
          return { edits: [], evidence: [] };
        },
      },
    });
    expect(plan.applied).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.files[GROUP_VARS_PATH]).toBe(text);
    expect(vaultCalls).toBe(0);
    expect(HOST_BUMPERS.vault.refresh).toBeUndefined();
    expect(HOST_BUMPERS.postgres.refresh).toBe(true);
    expect(HOST_BUMPERS.containerd.refresh).toBe(true);
  });

  it('moves both codenames of a Docker pin from the signed index chain, with the CLI riding the engine', async () => {
    const base = 'https://download.docker.com/linux/ubuntu/dists';
    const routes = {};
    for (const [codename, release] of [
      ['resolute', '26.04'],
      ['noble', '24.04'],
    ]) {
      const v = `5:29.9.0-1~ubuntu.${release}~${codename}`;
      const packages = `Package: docker-ce\nVersion: ${v}\nSHA256: ${hex('1')}\n\nPackage: docker-ce-cli\nVersion: ${v}\nSHA256: ${hex('2')}\n`;
      routes[`${base}/${codename}/stable/binary-amd64/Packages`] = packages;
      routes[`${base}/${codename}/InRelease`] = `SHA256:\n ${sha(packages).slice(7)} 1 stable/binary-amd64/Packages\n`;
    }
    const plan = await planHost({ text, rows: [row('dockerEngine', '29.8.1', '29.9.0')], http: makeHttp(fakeFetch(routes)) });
    expect(plan.notes).toEqual([]);
    expect(plan.files[GROUP_VARS_PATH]).toContain('    engine: "5:29.9.0-1~ubuntu.26.04~resolute"');
    expect(plan.files[GROUP_VARS_PATH]).toContain('    engine: "5:29.9.0-1~ubuntu.24.04~noble"');
    expect(plan.applied[0].evidence.map((e) => e.item)).toContain('docker-ce-cli 5:29.9.0-1~ubuntu.24.04~noble (.deb SHA256)');
  });

  it('refuses an index whose hash InRelease does not list', async () => {
    const base = 'https://download.docker.com/linux/ubuntu/dists/resolute';
    const routes = {
      [`${base}/stable/binary-amd64/Packages`]: `Package: containerd.io\nVersion: 2.3.7-1~ubuntu.26.04~resolute\nSHA256: ${hex('1')}\n`,
      [`${base}/InRelease`]: `SHA256:\n ${hex('0')} 1 stable/binary-amd64/Packages\n`,
    };
    const plan = await planHost({ text, rows: [row('containerd', '2.3.6', '2.3.7')], http: makeHttp(fakeFetch(routes)) });
    expect(plan.applied).toEqual([]);
    expect(plan.notes[0].reason).toMatch(/InRelease lists/);
    expect(plan.files[GROUP_VARS_PATH]).toBe(text);
  });
});

describe('the image base plan', () => {
  const files = Object.fromEntries([VERSIONS_ENV_PATH, DOCKERFILE_PATH, SANDBOX_DOCKERFILE_PATH].map((p) => [p, real(p)]));
  const env = readEnv(files[VERSIONS_ENV_PATH]);
  const [, major, minor] = env.BASE_PYTHON_VERSION.match(/^(\d+)\.(\d+)\.(\d+)$/);
  const variant = env.BASE_IMAGE.replace(/^python:\d+\.\d+\.\d+/, '');
  const lineTag = `${major}.${minor}${variant}`;
  const next = `${major}.${minor}.99`;

  function registry({ pythonVersion = next, patchAgrees = true } = {}) {
    const config = JSON.stringify({ config: { Env: ['PATH=/usr/local/bin', `PYTHON_VERSION=${pythonVersion}`] } });
    const amd64 = JSON.stringify({ schemaVersion: 2, config: { digest: sha(config) } });
    const index = JSON.stringify({ schemaVersion: 2, manifests: [{ digest: sha(amd64), platform: { os: 'linux', architecture: 'amd64' } }] });
    const other = JSON.stringify({ schemaVersion: 2, manifests: [] });
    const reg = 'https://registry-1.docker.io/v2';
    const hub = 'https://hub.docker.com/v2/repositories';
    const sandboxManifest = JSON.stringify({ sandbox: true });
    const sandbox = parseImageRef(env.SANDBOX_BASE_IMAGE);
    return {
      'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/python:pull': { token: 't' },
      [`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${sandbox.name}:pull`]: { token: 't' },
      [`${reg}/library/python/manifests/${lineTag}`]: index,
      [`${hub}/library/python/tags/${lineTag}`]: { digest: sha(index) },
      [`${reg}/library/python/manifests/${pythonVersion}${variant}`]: patchAgrees ? index : other,
      [`${hub}/library/python/tags/${pythonVersion}${variant}`]: { digest: sha(patchAgrees ? index : other) },
      [`${reg}/library/python/manifests/${sha(amd64)}`]: amd64,
      [`${reg}/library/python/blobs/${sha(config)}`]: config,
      [`${reg}/${sandbox.name}/manifests/${sandbox.tag}`]: sandboxManifest,
      [`${hub}/${sandbox.name}/tags/${sandbox.tag}`]: { digest: sha(sandboxManifest) },
      _index: index,
    };
  }

  it('moves BASE_IMAGE, BASE_DIGEST, BASE_PYTHON_VERSION and every external FROM together', async () => {
    const routes = registry();
    const plan = await planImageBase({ files, http: makeHttp(fakeFetch(routes)) });
    const base = plan.applied.find((b) => b.key === 'base');
    expect(base).toBeTruthy();
    const newEnv = readEnv(plan.files[VERSIONS_ENV_PATH]);
    expect(newEnv.BASE_IMAGE).toBe(`python:${next}${variant}`);
    expect(newEnv.BASE_DIGEST).toBe(sha(routes._index));
    expect(newEnv.BASE_PYTHON_VERSION).toBe(next);
    expect(plan.files[DOCKERFILE_PATH]).toContain(`FROM python:${next}${variant}@${sha(routes._index)} AS runner`);
    expect(plan.files[DOCKERFILE_PATH]).not.toContain(env.BASE_DIGEST);
    expect(base.evidence.map((e) => e.value)).toContain(next);
  });

  it('moves nothing when the patch tag and the line tag have not settled on one digest', async () => {
    const plan = await planImageBase({ files, http: makeHttp(fakeFetch(registry({ patchAgrees: false }))) });
    expect(plan.applied.filter((b) => b.key === 'base')).toEqual([]);
    expect(plan.files[VERSIONS_ENV_PATH]).toContain(`BASE_DIGEST=${env.BASE_DIGEST}`);
    expect(plan.notes.map((n) => n.reason).join(' ')).toMatch(/have not settled/);
  });

  it('moves the sandbox template base and its one FROM, independently of the python base', async () => {
    const plan = await planImageBase({ files, http: makeHttp(fakeFetch(registry({ patchAgrees: false }))) });
    expect(plan.applied.map((b) => b.key)).toEqual(['sandbox']);
    const sandbox = plan.applied.find((b) => b.key === 'sandbox');
    expect(sandbox).toBeTruthy();
    expect(plan.files[SANDBOX_DOCKERFILE_PATH]).not.toContain(env.SANDBOX_BASE_DIGEST);
    expect(readEnv(plan.files[VERSIONS_ENV_PATH]).SANDBOX_BASE_DIGEST).toBe(sha(JSON.stringify({ sandbox: true })));
  });
});

describe('the consumers\' digest plan', () => {
  const files = Object.fromEntries([CAPABILITIES_PATH, CODER_TEMPLATE_PATH].map((p) => [p, real(p)]));
  const runnerManifest = JSON.stringify({ runner: 1 });
  const fullManifest = JSON.stringify({ full: 1 });
  const tag = 'f'.repeat(40);
  const routes = (fullServed = fullManifest) => ({
    'https://ghcr.io/token?scope=repository:hybridcloudworks/hcw-lab-runner:pull': { token: 't' },
    'https://ghcr.io/token?scope=repository:hybridcloudworks/hcw-lab:pull': { token: 't' },
    [`https://ghcr.io/v2/hybridcloudworks/hcw-lab-runner/manifests/${tag}`]: runnerManifest,
    [`https://ghcr.io/v2/hybridcloudworks/hcw-lab/manifests/${tag}`]: fullServed,
  });
  const runner = `ghcr.io/hybridcloudworks/hcw-lab-runner:${tag}@${sha(runnerManifest)}`;
  const full = `ghcr.io/hybridcloudworks/hcw-lab:${tag}@${sha(fullManifest)}`;

  it('pins both consumers to the digests GHCR serves for the published tag', async () => {
    const plan = await planImageDigests({ files, http: makeHttp(fakeFetch(routes())), runner, full });
    expect(plan.notes).toEqual([]);
    expect(plan.files[CAPABILITIES_PATH]).toContain(`'${runner}'`);
    expect(plan.files[CODER_TEMPLATE_PATH]).toMatch(new RegExp(`image_tag\\s*=\\s*"${tag}"`));
    expect(plan.files[CODER_TEMPLATE_PATH]).toMatch(new RegExp(`image_digest\\s*=\\s*"${sha(fullManifest)}"`));
    const before = files[CODER_TEMPLATE_PATH].split('\n');
    expect(plan.files[CODER_TEMPLATE_PATH].split('\n').filter((l, i) => l !== before[i])).toHaveLength(2);
  });

  it('pins neither image whose registry digest disagrees with the publish job, and says so', async () => {
    const plan = await planImageDigests({ files, http: makeHttp(fakeFetch(routes('{"other":1}'))), runner, full });
    expect(plan.files[CODER_TEMPLATE_PATH]).toBe(files[CODER_TEMPLATE_PATH]);
    expect(plan.notes[0].reason).toMatch(/not the .* the publish job reported/);
  });

  it('refuses references that are not the two lab images', async () => {
    await expect(planImageDigests({ files, http: null, runner: 'alpine:3', full })).rejects.toThrow(/--runner must be/);
  });
});
