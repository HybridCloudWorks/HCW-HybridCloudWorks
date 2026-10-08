import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LABELS,
  check,
  compareVersions,
  coreVersion,
  newest,
  newestAptVersion,
  newestDockerHubTag,
  newestGitHubRelease,
  newestGitHubTag,
  newestHashicorp,
  newestNodeLine,
  readPins,
  renderMarkdown,
  scalar,
  sources,
} from './lab-pins-upstream.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('version arithmetic', () => {
  it('extracts the dotted core from apt, tag and plain forms', () => {
    expect(coreVersion('5:29.8.1-1~ubuntu.26.04~resolute')).toBe('29.8.1');
    expect(coreVersion('v2.11.4')).toBe('2.11.4');
    expect(coreVersion('18.6')).toBe('18.6');
    expect(coreVersion('26.10.0-1nodesource1')).toBe('26.10.0');
    expect(coreVersion('latest')).toBeNull();
    expect(coreVersion(null)).toBeNull();
  });
  it('compares segment-wise, numerically', () => {
    expect(compareVersions('2.3.6', '2.3.10')).toBe(-1);
    expect(compareVersions('29.8.1', '29.8.1')).toBe(0);
    expect(compareVersions('18.6', '18.5.1')).toBe(1);
    expect(newest(['1.2.3', '1.10.0', '1.9.9'])).toBe('1.10.0');
    expect(newest([])).toBeNull();
  });
});

describe('reading the pins', () => {
  it('reads a scalar with or without quotes and ignores a trailing comment', () => {
    const text = 'a: "1.2.3"\nb: 4.5.6 # note\nc: v7\n';
    expect(scalar(text, 'a')).toBe('1.2.3');
    expect(scalar(text, 'b')).toBe('4.5.6');
    expect(scalar(text, 'c')).toBe('v7');
    expect(scalar(text, 'd')).toBeNull();
  });
  it('finds every watched pin in the real group_vars, so a renamed key cannot silently drop a component', () => {
    const pins = readPins(readFileSync(join(REPO, 'lab-host', 'ansible', 'group_vars', 'all.yml'), 'utf8'));
    for (const key of Object.keys(LABELS)) {
      expect(pins[key], key).toMatch(/^\d+(\.\d+)+$/);
    }
    expect(pins.dockerEngine).toMatch(/^29\./);
  });
});

describe('upstream readers', () => {
  it('reads the newest stable version of one package from a Debian Packages index', () => {
    const index = [
      'Package: docker-ce\nVersion: 5:29.8.1-1~ubuntu.26.04~resolute\nArchitecture: amd64',
      'Package: docker-ce\nVersion: 5:29.9.0-1~ubuntu.26.04~resolute\nArchitecture: amd64',
      'Package: containerd.io\nVersion: 2.3.7-1~ubuntu.26.04~resolute\nArchitecture: amd64',
      'Package: docker-ce-cli\nVersion: 5:30.0.0-1~ubuntu.26.04~resolute\nArchitecture: amd64',
    ].join('\n\n');
    expect(newestAptVersion(index, 'docker-ce')).toBe('29.9.0');
    expect(newestAptVersion(index, 'containerd.io')).toBe('2.3.7');
    expect(newestAptVersion(index, 'runc')).toBeNull();
    // The dot in a package name is a literal, not "any character".
    expect(newestAptVersion('Package: containerdXio\nVersion: 9.9.9\n', 'containerd.io')).toBeNull();
  });
  it('skips prereleases, drafts and non-numeric tags in a GitHub releases listing', () => {
    expect(
      newestGitHubRelease([
        { tag_name: 'v2.12.0-beta.1', prerelease: true, draft: false },
        { tag_name: 'v2.11.4', prerelease: false, draft: false },
        { tag_name: 'v2.11.5', prerelease: false, draft: true },
        { tag_name: 'nightly', prerelease: false, draft: false },
      ])
    ).toBe('2.11.4');
  });
  it('reads the newest stable tag from a GitHub tags listing', () => {
    expect(newestGitHubTag([{ name: 'v0.2.4' }, { name: 'v0.2.5-rc1' }, { name: 'v0.2.5' }, { name: 'tip' }])).toBe('0.2.5');
  });
  it('reads the newest stable version from a HashiCorp index and ignores rc/ent builds', () => {
    expect(newestHashicorp({ versions: { '2.1.1': {}, '2.2.0-rc1': {}, '2.1.1+ent': {}, '2.1.2': {} } })).toBe('2.1.2');
  });
  it('reads the newest tag in one line from a Docker Hub listing', () => {
    const results = [{ name: '18.6' }, { name: '18.7' }, { name: '18' }, { name: '18.7-alpine' }, { name: '17.12' }];
    expect(newestDockerHubTag(results, '18')).toBe('18.7');
  });
  it('reads the newest release in one Node.js line', () => {
    expect(newestNodeLine([{ version: 'v27.0.0' }, { version: 'v26.10.0' }, { version: 'v26.11.1' }], 26)).toBe('26.11.1');
  });
  it('has one source per watched pin', () => {
    expect(Object.keys(sources({})).sort()).toEqual(Object.keys(LABELS).sort());
  });
});

describe('the check', () => {
  const pins = Object.fromEntries(Object.keys(LABELS).map((k) => [k, '1.0.0']));
  const readers = (overrides) =>
    Object.fromEntries(Object.keys(LABELS).map((k) => [k, overrides[k] ?? (async () => '1.0.0')]));

  it('exits 0 when every pin is current', async () => {
    const { rows, exitCode } = await check({ pins, readers: readers({}) });
    expect(exitCode).toBe(0);
    expect(rows.every((r) => r.status === 'current')).toBe(true);
  });
  it('exits 1 when one pin is behind, and names it', async () => {
    const { rows, exitCode } = await check({ pins, readers: readers({ containerd: async () => '1.0.1' }) });
    expect(exitCode).toBe(1);
    expect(rows.find((r) => r.key === 'containerd').status).toBe('BEHIND');
    expect(renderMarkdown(rows)).toContain('| containerd.io (carries runc) | 1.0.0 | 1.0.1 | BEHIND |');
  });
  it('exits 2 when a source cannot be read, even if nothing is behind — not evaluated is not fine', async () => {
    const { rows, exitCode } = await check({
      pins,
      readers: readers({
        vault: async () => {
          throw new Error('HTTP 503');
        },
      }),
    });
    expect(exitCode).toBe(2);
    expect(rows.find((r) => r.key === 'vault').status).toMatch(/^unreadable: HTTP 503/);
  });
  it('exits 2 when a pin is missing from group_vars', async () => {
    const { exitCode, rows } = await check({ pins: { ...pins, caddy: null }, readers: readers({}) });
    expect(exitCode).toBe(2);
    expect(rows.find((r) => r.key === 'caddy').status).toBe('pin not found');
  });
});
