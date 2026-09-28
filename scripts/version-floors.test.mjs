/**
 * Every pin the repository carries meets the floor in version-floors.json
 * (#715, #714).
 *
 * The last describe block is the gate: it reads the real tree and fails with
 * one line per pin that is behind, naming the file, the pin and the floor.
 * Everything above it holds the readers and the rules to what they claim, so
 * the gate cannot pass by reading nothing.
 */
import { afterAll, describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { IMAGES } from '../vps-agent/lib/capabilities.js';
import {
  BUILT_HERE,
  ENGINES_EXEMPT,
  JOB_IMAGES_FILE,
  collectPins,
  compareVersions,
  findViolations,
  formatFindings,
  judge,
  loadFloors,
  majorMinorFloor,
  meetsFloor,
  minorFloor,
  npmRangeAdmits,
  npmRangeMinimum,
  parseNpmRange,
  patchFloor,
  readDockerfile,
  readJobImages,
  readLabHost,
  readWorkflow,
  terraformConstraintAdmits,
} from './version-floors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const floors = loadFloors(ROOT);

describe('version arithmetic', () => {
  it('compares numerically, padding the shorter side', () => {
    expect(compareVersions('26.10.0', '26.8.0')).toBe(1);
    expect(compareVersions('3.14', '3.14.0')).toBe(0);
    expect(compareVersions('24.21.0', '26')).toBe(-1);
  });

  it('lets a line-only pin float to the newest release on its line', () => {
    expect(meetsFloor('26', '26.8.0')).toBe(true);
    expect(meetsFloor('3.14', '3.14.5')).toBe(true);
    expect(meetsFloor('24', '26.8.0')).toBe(false);
    expect(meetsFloor('3.13', '3.14.5')).toBe(false);
  });

  it('compares an exact pin exactly', () => {
    expect(meetsFloor('26.7.9', '26.8.0')).toBe(false);
    expect(meetsFloor('26.8.0', '26.8.0')).toBe(true);
    expect(meetsFloor('3.14.4', '3.14.5')).toBe(false);
  });

  it('derives N-2 patch and N-2 minor floors, never below zero', () => {
    expect(patchFloor('3.14.7')).toBe('3.14.5');
    expect(patchFloor('1.16.1')).toBe('1.16.0');
    expect(minorFloor('26.10.0')).toBe('26.8.0');
    expect(minorFloor('28.1.3')).toBe('28.0.0');
  });

  it('derives the N-2 minor floor of a MAJOR.MINOR release, and refuses any other shape', () => {
    expect(majorMinorFloor('18.6')).toBe('18.4');
    expect(majorMinorFloor('19.1')).toBe('19.0');
    expect(() => majorMinorFloor('18.6.0')).toThrow(/needs MAJOR\.MINOR, got 18\.6\.0/);
    expect(() => majorMinorFloor('18')).toThrow(/needs MAJOR\.MINOR/);
  });
});

describe("reading the lab host's PostgreSQL pin", () => {
  const dir = mkdtempSync(join(tmpdir(), 'version-floors-lab-'));
  mkdirSync(join(dir, 'lab-host', 'ansible', 'group_vars'), { recursive: true });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** readLabHost on a group_vars holding `lines`, cut to the postgresql kind. */
  const postgresqlOf = (lines) => {
    writeFileSync(join(dir, 'lab-host', 'ansible', 'group_vars', 'all.yml'), `${['---', ...lines].join('\n')}\n`);
    const { pins, problems } = readLabHost(dir);
    const own = (p) => p.kind === 'postgresql';
    return { pins: pins.filter(own), problems: problems.filter(own) };
  };

  it('reads coder_postgres_image_tag as MAJOR.MINOR, quoted or not', () => {
    for (const value of ['"18.6"', "'18.6'", '18.6']) {
      const { pins, problems } = postgresqlOf(['coder_postgres_image: postgres', `coder_postgres_image_tag: ${value}`]);
      expect(problems).toEqual([]);
      expect(pins).toEqual([
        {
          file: 'lab-host/ansible/group_vars/all.yml',
          line: 3,
          where: 'lab-host/ansible/group_vars/all.yml > coder_postgres_image_tag',
          kind: 'postgresql',
          raw: '18.6',
          version: '18.6',
        },
      ]);
    }
  });

  it('refuses a major-only tag, a beta and a release candidate, and says why', () => {
    for (const value of ['"18"', '"19beta4"', '"19rc1"', '"18.6-trixie"']) {
      const { pins, problems } = postgresqlOf([`coder_postgres_image_tag: ${value}`]);
      expect(pins).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toMatch(/is not a general release as MAJOR\.MINOR/);
    }
  });

  it('reports a missing pin rather than passing on nothing', () => {
    const { pins, problems } = postgresqlOf(['coder_postgres_image: postgres']);
    expect(pins).toEqual([]);
    expect(problems.map((p) => p.message)).toEqual(['coder_postgres_image_tag is missing']);
  });
});

describe("reading the lab host's HashiCorp Vault pin", () => {
  const dir = mkdtempSync(join(tmpdir(), 'version-floors-vault-'));
  mkdirSync(join(dir, 'lab-host', 'ansible', 'group_vars'), { recursive: true });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** readLabHost on a group_vars holding `lines`, cut to the vault kind. */
  const vaultOf = (lines) => {
    writeFileSync(join(dir, 'lab-host', 'ansible', 'group_vars', 'all.yml'), `${['---', ...lines].join('\n')}\n`);
    const { pins, problems } = readLabHost(dir);
    const own = (p) => p.kind === 'vault';
    return { pins: pins.filter(own), problems: problems.filter(own) };
  };

  it('reads vault_version as MAJOR.MINOR.PATCH, quoted or not, and not vault_enabled or the checksums', () => {
    for (const value of ['"2.1.1"', "'2.1.1'", '2.1.1']) {
      const { pins, problems } = vaultOf(['vault_enabled: false', `vault_version: ${value}`, 'vault_checksum: sha256:00']);
      expect(problems).toEqual([]);
      expect(pins).toEqual([
        {
          file: 'lab-host/ansible/group_vars/all.yml',
          line: 3,
          where: 'lab-host/ansible/group_vars/all.yml > vault_version',
          kind: 'vault',
          raw: '2.1.1',
          version: '2.1.1',
        },
      ]);
    }
  });

  it('refuses a line-only version, a release candidate and a tag, and says why', () => {
    for (const value of ['"2.1"', '"2.2.0-rc1"', 'latest', '"v2.1.1"']) {
      const { pins, problems } = vaultOf([`vault_version: ${value}`]);
      expect(pins).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toMatch(/is not a release as MAJOR\.MINOR\.PATCH/);
    }
  });

  it('reports a missing pin rather than passing on nothing', () => {
    const { pins, problems } = vaultOf(['vault_enabled: false']);
    expect(pins).toEqual([]);
    expect(problems.map((p) => p.message)).toEqual(['vault_version is missing']);
  });
});

describe('npm engines ranges', () => {
  it('finds the lowest version a range admits', () => {
    expect(npmRangeMinimum('>=26.8.0')).toBe('26.8.0');
    expect(npmRangeMinimum('^22.12.0 || ^24.0.0 || >=26.0.0')).toBe('22.12.0');
    expect(npmRangeMinimum('>=18.0.0')).toBe('18.0.0');
    expect(npmRangeMinimum('>=22')).toBe('22.0.0');
    expect(npmRangeMinimum('^24.19.0')).toBe('24.19.0');
    expect(npmRangeMinimum('>25')).toBe('26.0.0');
    expect(npmRangeMinimum('26.x')).toBe('26.0.0');
    expect(npmRangeMinimum('>=27 <26')).toBe(null);
  });

  it('decides admission the way npm does for caret, tilde and x-ranges', () => {
    expect(npmRangeAdmits('^24.19.0', '24.21.0')).toBe(true);
    expect(npmRangeAdmits('^24.19.0', '25.0.0')).toBe(false);
    expect(npmRangeAdmits('~26.8.0', '26.9.0')).toBe(false);
    expect(npmRangeAdmits('>=26.8.0', '28.0.0')).toBe(true);
    expect(npmRangeAdmits('24', '24.99.0')).toBe(true);
    expect(npmRangeAdmits('22.12.0 - 24.0.0', '24.0.0')).toBe(true);
  });

  it('refuses syntax it does not model rather than guessing', () => {
    expect(() => parseNpmRange('>=26.0.0-rc.1')).toThrow(/unsupported/);
    expect(() => parseNpmRange('latest')).toThrow(/unsupported/);
  });
});

describe('Terraform required_version constraints', () => {
  it.each([
    ['~> 1.5', '1.16.4', true],
    ['~> 1.6', '2.0.0', false],
    ['~> 1.16.0', '1.16.4', true],
    ['~> 1.15.0', '1.16.4', false],
    ['>= 1.12, < 2.0', '1.16.4', true],
    ['>= 1.9.0', '1.16.4', true],
    ['< 1.16', '1.16.4', false],
    ['!= 1.16.4', '1.16.4', false],
    ['1.16.4', '1.16.4', true],
  ])('%s admits %s: %s', (constraint, version, want) => {
    expect(terraformConstraintAdmits(constraint, version)).toBe(want);
  });
});

describe('reading a workflow', () => {
  const workflow = [
    'name: x',
    'jobs:',
    '  verify:',
    '    strategy:',
    '      matrix:',
    '        include:',
    '          - name: frontend',
    '            dir: frontend',
    '          - name: functions (azure)',
    '            dir: functions',
    "            node-version: '24'",
    '    steps:',
    '      # node-version: 18 in a comment is not a pin',
    '      - name: Set up Node.js',
    '        uses: actions/setup-node@0000000000000000000000000000000000000000 # v7',
    '        with:',
    "          node-version: ${{ matrix.node-version || '26' }}",
    '  other:',
    '    steps:',
    '      - uses: actions/setup-node@0000000000000000000000000000000000000000 # v7',
    '        with:',
    '          node-version: 22',
    '      - uses: actions/setup-python@0000000000000000000000000000000000000000 # v7',
    '      - name: Python',
    '        uses: actions/setup-python@0000000000000000000000000000000000000000 # v7',
    '        with:',
    "          python-version: '3.14' # the newest line",
    '      - name: Computed',
    '        uses: actions/setup-node@0000000000000000000000000000000000000000 # v7',
    '        with:',
    '          node-version: ${{ inputs.node }}',
  ].join('\n');
  const { pins, problems } = readWorkflow('.github/workflows/x.yml', workflow);

  it('reads matrix rows, the matrix default and literal steps, labelled by job and item', () => {
    expect(pins.map((p) => [p.where, p.version])).toEqual([
      ['.github/workflows/x.yml > verify > functions (azure)', '24'],
      ['.github/workflows/x.yml > verify > Set up Node.js (matrix default)', '26'],
      ['.github/workflows/x.yml > other > uses actions/setup-node', '22'],
      ['.github/workflows/x.yml > other > Python', '3.14'],
    ]);
  });

  it('reports a setup step with no version, and an expression it cannot resolve', () => {
    expect(problems.map((p) => [p.line, p.kind])).toEqual([
      [23, 'python'],
      [31, 'node'],
    ]);
    expect(problems[0].message).toMatch(/runs whatever the runner ships/);
    expect(problems[1].message).toMatch(/not a literal version/);
  });
});

describe('reading a Dockerfile', () => {
  const dockerfile = [
    'FROM python:3.14-slim-trixie@sha256:abc AS fetch',
    'FROM fetch AS vendor',
    'FROM debian:bookworm-slim@sha256:def AS runner',
    'FROM docker.io/library/ubuntu:24.04',
    'FROM node:26.10.0-trixie-slim',
    'FROM docker/sandbox-templates:claude-code@sha256:123',
    'FROM debian:sid',
  ].join('\n');
  const { pins, problems } = readDockerfile('x/Dockerfile', dockerfile, floors);

  it('reads the runtime line and the Debian release under an official runtime image', () => {
    expect(pins.map((p) => [p.kind, p.version])).toEqual([
      ['python', '3.14'],
      ['debian', '13'],
      ['debian', '12'],
      ['ubuntu', '24.04'],
      ['node', '26.10.0'],
      ['debian', '13'],
    ]);
  });

  it('skips build stages and ungoverned images, and names an unknown release', () => {
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/debian:sid is not a release the floors file knows/);
  });
});

/**
 * The lab job images (IMAGES in vps-agent/lib/capabilities.js) are what the
 * agent pulls and runs on the lab host, and until 2026-09-28 nothing read
 * them: shell-echo ran alpine:3.20, past its end of life, and ansible-check a
 * third-party image. Every entry must now be governed by a kind, be built
 * here, or be named in `unsourced`.
 */
describe('reading the lab job images', () => {
  const source = readFileSync(join(ROOT, JOB_IMAGES_FILE), 'utf8');
  const today = readJobImages(JOB_IMAGES_FILE, source, floors);

  /** A capabilities.js holding only the given IMAGES entries. */
  const imagesFile = (entries) =>
    ['// header', 'export const IMAGES = {', ...entries.map(([key, ref]) => `  ${key}:\n    '${ref}',`), '};', 'export const CAPABILITIES = {};'].join('\n');

  /** The IMAGES map main carried until 2026-09-28, digests as they were. */
  const MAIN_BEFORE = [
    ['alpine', 'alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc'],
    ['ansible', 'alpine/ansible:2.17.0@sha256:3cf35fbaecd3dba7c246191be1d46c0b4c051839294eb813677a7482c1fa1ced'],
    ['hcwLabRunner', IMAGES.hcwLabRunner],
  ];

  it("reads today's map: an alpine pin at its exact release, and nothing for the image built here", () => {
    expect(today.problems).toEqual([]);
    expect(today.pins.map((p) => [p.where, p.kind, p.version])).toEqual([
      [`${JOB_IMAGES_FILE} > IMAGES.alpine`, 'alpine', '3.24.2'],
    ]);
    const line = today.pins[0].line;
    expect(source.split('\n')[line - 1]).toContain(IMAGES.alpine);
  });

  /**
   * The gate this issue asked for: an image in IMAGES that no floor covers
   * fails here by name. It imports the map rather than trusting the text
   * scan, so a reformatted entry the scan misses fails too.
   */
  it('covers every image the agent exports, by a kind, by being built here, or by an unsourced entry', () => {
    const unsourced = new Set(Object.values(floors.unsourced).map((entry) => entry?.pin));
    const uncovered = Object.entries(IMAGES).filter(([key, ref]) => {
      const where = `${JOB_IMAGES_FILE} > IMAGES.${key}`;
      const pinned = today.pins.some((p) => p.where === where && p.raw === ref);
      const builtHere = Object.keys(BUILT_HERE).some((image) => ref.startsWith(`${image}:`) || ref.startsWith(`${image}@`));
      return !pinned && !builtHere && !unsourced.has(where);
    });
    expect(uncovered.map(([key, ref]) => `IMAGES.${key} = ${ref}`)).toEqual([]);
  });

  it('fails the map main carried until 2026-09-28: alpine:3.20 behind its floor, alpine/ansible uncovered', () => {
    // Cut to this file: the ceiling selectors match no pin in a one-file read.
    const findings = findViolations(floors, readJobImages(JOB_IMAGES_FILE, imagesFile(MAIN_BEFORE), floors)).filter(
      (f) => f.file === JOB_IMAGES_FILE
    );
    expect(findings.map((f) => [f.where, f.message])).toEqual([
      [`${JOB_IMAGES_FILE} > IMAGES.alpine`, '3.20 is below the floor 3.24.0'],
      [
        `${JOB_IMAGES_FILE} > IMAGES.alpine`,
        'alpine:3.20 is pinned by digest but names only the line 3.20; name the exact release the digest is (MAJOR.MINOR.PATCH), because a digest does not float',
      ],
      [
        `${JOB_IMAGES_FILE} > IMAGES.ansible`,
        `alpine/ansible has no floor: no kind in scripts/version-floors.json governs it, this repository does not build it, and no "unsourced" entry has the pin "${JOB_IMAGES_FILE} > IMAGES.ansible"`,
      ],
    ]);
    // The line of each reference itself, beneath its key.
    expect(findings.map((f) => f.line)).toEqual([4, 4, 6]);
  });

  it('refuses a line-only tag on a digest even when the line is current', () => {
    const { pins, problems } = readJobImages(JOB_IMAGES_FILE, imagesFile([['alpine', `alpine:3.24@sha256:${'0'.repeat(64)}`]]), floors);
    expect(pins.map((p) => p.version)).toEqual(['3.24']);
    expect(problems.map((p) => p.message)).toEqual([expect.stringMatching(/names only the line 3\.24/)]);
  });

  it('accepts a third-party image that an unsourced entry names by its pin', () => {
    const withEntry = structuredClone(floors);
    withEntry.unsourced.ansible = { pin: `${JOB_IMAGES_FILE} > IMAGES.ansible`, source: null };
    const { pins, problems } = readJobImages(JOB_IMAGES_FILE, imagesFile(MAIN_BEFORE.slice(1)), withEntry);
    expect([pins, problems]).toEqual([[], []]);
  });

  it('reports a file with no IMAGES map rather than passing on nothing', () => {
    const { pins, problems } = readJobImages(JOB_IMAGES_FILE, 'export const CAPABILITIES = {};\n', floors);
    expect(pins).toEqual([]);
    expect(problems.map((p) => p.message)).toEqual([expect.stringMatching(/entries found, so the job images cannot be checked/)]);
  });

  it('reads FROM alpine in a Dockerfile by the same rule', () => {
    const dockerfile = [`FROM alpine:3.24.2@sha256:${'0'.repeat(64)}`, 'FROM alpine:3.23', `FROM alpine:3.24@sha256:${'0'.repeat(64)}`].join('\n');
    const { pins, problems } = readDockerfile('x/Dockerfile', dockerfile, floors);
    expect(pins.map((p) => [p.line, p.version, judge(p, floors)])).toEqual([
      [1, '3.24.2', null],
      [2, '3.23', '3.23 is below the floor 3.24.0'],
      [3, '3.24', null],
    ]);
    expect(problems.map((p) => p.line)).toEqual([3]);
  });

  it('judges each image this repository builds where it is built', () => {
    const collected = collectPins(ROOT, floors);
    for (const dockerfile of Object.values(BUILT_HERE)) {
      expect(collected.pins.filter((p) => p.file === dockerfile && p.where.includes('FROM')).length, dockerfile).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('reading version files and Terraform', () => {
  const dir = mkdtempSync(join(tmpdir(), 'version-floors-'));
  writeFileSync(join(dir, '.nvmrc'), 'v24\n');
  writeFileSync(join(dir, '.python-version'), '3.14.7\n');
  writeFileSync(
    join(dir, 'main.tf'),
    [
      'terraform {',
      '  required_version = "~> 1.6"',
      '}',
      'resource "x" "py" {',
      '  runtime_name    = "python"',
      '  runtime_version = "3.12"',
      '}',
      'resource "x" "js" {',
      '  runtime_name    = "node"',
      '  runtime_version = "24"',
      '}',
    ].join('\n')
  );
  const { pins, problems } = collectPins(dir, floors, ['.nvmrc', '.python-version', 'main.tf']);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads .nvmrc and .python-version, with or without a leading v', () => {
    expect(pins.filter((p) => p.file !== 'main.tf').map((p) => [p.kind, p.version])).toEqual([
      ['node', '24'],
      ['python', '3.14.7'],
    ]);
  });

  it('reads runtime_version as a Node.js pin only under runtime_name = "node"', () => {
    expect(pins.filter((p) => p.file === 'main.tf').map((p) => [p.kind, p.raw])).toEqual([
      ['terraform', '~> 1.6'],
      ['node', '24'],
    ]);
    expect(problems).toEqual([]);
  });
});

describe('the rules', () => {
  const at = (extra) => ({ file: 'f', line: 1, where: 'f', raw: '', ...extra });

  it('holds a functions pin exactly at the Flex Consumption ceiling', () => {
    const where = '.github/workflows/deploy-functions.yml > deploy > Setup Node.js';
    expect(judge(at({ kind: 'node', version: '24', where }), floors)).toBe(null);
    expect(judge(at({ kind: 'node', version: '26', where }), floors)).toMatch(/must be Node.js 24/);
    expect(judge(at({ kind: 'node', version: '22', where }), floors)).toMatch(/must be Node.js 24/);
    expect(judge(at({ kind: 'node', version: '24.18.0', where }), floors)).toMatch(/below the floor 24\.19\.0/);
  });

  it('holds the functions engines range to the 24 line and nothing newer', () => {
    const where = 'functions/package.json > engines.node';
    expect(judge(at({ kind: 'node', range: '^24.19.0', where }), floors)).toBe(null);
    expect(judge(at({ kind: 'node', range: '>=24.19.0', where }), floors)).toMatch(/admits Node.js 25\+/);
    expect(judge(at({ kind: 'node', range: '^22.12.0', where }), floors)).toMatch(/holds this component at Node.js 24/);
  });

  it('holds every other Node.js pin to the newest line', () => {
    expect(judge(at({ kind: 'node', version: '26' }), floors)).toBe(null);
    expect(judge(at({ kind: 'node', version: '24' }), floors)).toMatch(/below the floor 26\.8\.0/);
    expect(judge(at({ kind: 'node', range: '>=26.8.0' }), floors)).toBe(null);
    expect(judge(at({ kind: 'node', range: '>=18.0.0' }), floors)).toMatch(/admits 18\.0\.0, below the floor/);
    expect(judge(at({ kind: 'node', range: '^24.21.0' }), floors)).toMatch(/below the floor/);
  });

  it('refuses an interim Ubuntu release even when it is newer', () => {
    expect(judge(at({ kind: 'ubuntu', version: '26.04' }), floors)).toBe(null);
    expect(judge(at({ kind: 'ubuntu', version: '24.04' }), floors)).toMatch(/below the floor 26\.04/);
    expect(judge(at({ kind: 'ubuntu', version: '26.10' }), floors)).toMatch(/interim release/);
  });

  it('checks a required_version by admission and an exact Terraform pin by floor', () => {
    expect(judge(at({ kind: 'terraform', constraint: '~> 1.5' }), floors)).toBe(null);
    expect(judge(at({ kind: 'terraform', constraint: '~> 1.15.0' }), floors)).toMatch(/does not admit 1\.16\.4/);
    expect(judge(at({ kind: 'terraform', version: '1.16.1' }), floors)).toMatch(/below the floor 1\.16\.2/);
  });

  it('holds the PostgreSQL pin to the newest major, at most two minor releases behind', () => {
    expect(judge(at({ kind: 'postgresql', version: '18.6' }), floors)).toBe(null);
    expect(judge(at({ kind: 'postgresql', version: '18.4' }), floors)).toBe(null);
    expect(judge(at({ kind: 'postgresql', version: '18.3' }), floors)).toMatch(/18\.3 is below the floor 18\.4/);
    expect(judge(at({ kind: 'postgresql', version: '17.11' }), floors)).toMatch(/below the floor 18\.4/);
    expect(judge(at({ kind: 'postgresql', version: '16.15' }), floors)).toMatch(/below the floor 18\.4/);
  });

  it('holds the Vault pin to the newest line, at most two patch releases behind', () => {
    expect(judge(at({ kind: 'vault', version: '2.1.1' }), floors)).toBe(null);
    expect(judge(at({ kind: 'vault', version: '2.1.0' }), floors)).toBe(null);
    expect(judge(at({ kind: 'vault', version: '2.0.4' }), floors)).toMatch(/2\.0\.4 is below the floor 2\.1\.0/);
    expect(judge(at({ kind: 'vault', version: '1.17.5' }), floors)).toMatch(/below the floor 2\.1\.0/);
  });

  it('holds an Alpine pin to the newest line, at most two patch releases behind', () => {
    expect(judge(at({ kind: 'alpine', version: '3.24.2' }), floors)).toBe(null);
    expect(judge(at({ kind: 'alpine', version: '3.24.0' }), floors)).toBe(null);
    expect(judge(at({ kind: 'alpine', version: '3.23.6' }), floors)).toMatch(/3\.23\.6 is below the floor 3\.24\.0/);
    expect(judge(at({ kind: 'alpine', version: '3.20' }), floors)).toMatch(/3\.20 is below the floor 3\.24\.0/);
  });

  it('has no floor for Portainer, because it has no source', () => {
    expect(judge(at({ kind: 'portainer', version: '2.45.1' }), floors)).toMatch(/no floor is recorded for kind "portainer"/);
  });
});

describe('scripts/version-floors.json', () => {
  const kinds = floors.kinds;

  it('has one entry per kind, each dated and sourced', () => {
    expect(Object.keys(kinds).sort()).toEqual(['alpine', 'debian', 'node', 'postgresql', 'python', 'terraform', 'ubuntu', 'vault']);
    const entries = [...Object.values(kinds), ...Object.values(kinds.node.platformCeilings)];
    for (const entry of entries) {
      expect(entry.newest, JSON.stringify(entry)).toBeTruthy();
      expect(entry.floor, JSON.stringify(entry)).toBeTruthy();
      expect(entry.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.source).toMatch(/^https:\/\//);
      expect(entry.rule.length).toBeGreaterThan(20);
    }
  });

  it('derives each floor from its newest release by the rule the entry states', () => {
    expect(kinds.python.floor).toBe(patchFloor(kinds.python.newest));
    expect(kinds.python.newest.startsWith(`${kinds.python.line}.`)).toBe(true);
    expect(kinds.terraform.floor).toBe(patchFloor(kinds.terraform.newest));
    expect(kinds.terraform.newest.startsWith(`${kinds.terraform.line}.`)).toBe(true);
    expect(kinds.node.floor).toBe(minorFloor(kinds.node.newest));
    expect(kinds.node.newest.split('.')[0]).toBe(kinds.node.line);
    for (const ceiling of Object.values(kinds.node.platformCeilings)) {
      expect(ceiling.floor).toBe(minorFloor(ceiling.newest));
      expect(ceiling.newest.split('.')[0]).toBe(ceiling.line);
      expect(Number(ceiling.line)).toBeLessThanOrEqual(Number(kinds.node.line));
    }
    expect(kinds.ubuntu.floor).toBe(kinds.ubuntu.newest);
    expect(kinds.debian.floor).toBe(kinds.debian.newest);
    expect(kinds.postgresql.floor).toBe(majorMinorFloor(kinds.postgresql.newest));
    expect(kinds.postgresql.newest.split('.')[0]).toBe(kinds.postgresql.line);
    expect(kinds.vault.floor).toBe(patchFloor(kinds.vault.newest));
    expect(kinds.vault.newest.startsWith(`${kinds.vault.line}.`)).toBe(true);
    expect(kinds.alpine.floor).toBe(patchFloor(kinds.alpine.newest));
    expect(kinds.alpine.newest.startsWith(`${kinds.alpine.line}.`)).toBe(true);
  });

  /**
   * What the task said to do for a pin no endoflife.date product covers: say
   * so, and read nothing else in its place. The pin it names must exist, so a
   * rename cannot leave the entry describing nothing.
   */
  it('records each unsourced pin with no source, the reason, and a pin that exists', () => {
    const { $comment, ...entries } = floors.unsourced;
    expect($comment).toMatch(/endoflife\.date/);
    expect(Object.keys(entries)).toEqual(['portainer']);
    for (const [name, entry] of Object.entries(entries)) {
      expect(Object.hasOwn(kinds, name), `${name} is not also a kind`).toBe(false);
      expect(entry.source).toBe(null);
      expect(entry.why).toMatch(new RegExp(`https://endoflife\\.date/api/v1/products/${name}/ answered HTTP 404`));
      expect(entry.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.rule.length).toBeGreaterThan(20);
      const [file, key] = entry.pin.split(' > ');
      if (file === JOB_IMAGES_FILE) {
        // A third-party lab job image: `IMAGES.<key>` in capabilities.js.
        expect(Object.hasOwn(IMAGES, key.replace(/^IMAGES\./, '')), `${entry.pin} exists`).toBe(true);
        continue;
      }
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(text, `${entry.pin} exists`).toMatch(new RegExp(`^${key}:`, 'm'));
    }
  });

  it('is in the form the weekly updater writes, so its first bump is a diff of values only', () => {
    const text = readFileSync(join(ROOT, 'scripts', 'version-floors.json'), 'utf8');
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  });

  it('knows the codename of the newest Ubuntu and Debian release', () => {
    expect(Object.values(kinds.ubuntu.codenames)).toContain(kinds.ubuntu.newest);
    expect(Object.values(kinds.debian.codenames)).toContain(kinds.debian.newest);
  });
});

describe('every pin in the repository meets its floor', () => {
  const collected = collectPins(ROOT, floors);
  const count = (predicate) => collected.pins.filter(predicate).length;

  /**
   * The gate cannot pass by reading nothing. These are lower bounds on what
   * the readers find in today's tree, one per source the issue names; a
   * reader that silently stops matching drops below its bound here, before
   * the assertion below would read an empty list as a clean bill of health.
   */
  it('finds pins in every place a version is chosen', () => {
    const inWorkflows = (p) => p.file.startsWith('.github/workflows/');
    expect(count((p) => inWorkflows(p) && p.kind === 'node')).toBeGreaterThanOrEqual(15);
    expect(count((p) => inWorkflows(p) && p.kind === 'python')).toBeGreaterThanOrEqual(3);
    expect(count((p) => p.range !== undefined)).toBeGreaterThanOrEqual(6);
    expect(count((p) => p.constraint !== undefined)).toBeGreaterThanOrEqual(5);
    expect(count((p) => p.where === 'infra/functionapp.tf > runtime_version')).toBe(1);
    expect(count((p) => p.file === 'frontend/.nvmrc')).toBe(1);
    expect(count((p) => p.file.startsWith('lab-image/') && p.where.includes('FROM'))).toBeGreaterThanOrEqual(1);
    expect(count((p) => p.file === JOB_IMAGES_FILE && p.kind === 'alpine')).toBe(1);
    const labHost = [...collected.pins, ...collected.problems].filter((p) => p.file.startsWith('lab-host/'));
    expect(labHost.some((p) => p.kind === 'node')).toBe(true);
    expect(labHost.some((p) => p.kind === 'python')).toBe(true);
    expect(labHost.filter((p) => p.kind === 'ubuntu').length).toBeGreaterThanOrEqual(2);
    expect(labHost.filter((p) => p.kind === 'postgresql').map((p) => p.where)).toEqual([
      'lab-host/ansible/group_vars/all.yml > coder_postgres_image_tag',
    ]);
    expect(labHost.filter((p) => p.kind === 'vault').map((p) => p.where)).toEqual(['lab-host/ansible/group_vars/all.yml > vault_version']);
  });

  it('names a reason for every package that has no engines.node', () => {
    const missing = collected.pins.filter((p) => p.missing).map((p) => p.file).sort();
    expect(missing).toEqual(Object.keys(ENGINES_EXEMPT).sort());
  });

  /**
   * One line per finding: `file:line  [kind] where` and, beneath it, the pin
   * and the floor. Compared as text so a failure reads as a list of what to
   * move, not as a diff of objects.
   */
  it('has no pin below its floor, and none it cannot read', () => {
    const findings = findViolations(floors, collected, { enginesExempt: ENGINES_EXEMPT });
    expect(formatFindings(findings)).toBe('');
  });
});
