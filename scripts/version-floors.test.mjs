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
import {
  ENGINES_EXEMPT,
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
});

describe('scripts/version-floors.json', () => {
  const kinds = floors.kinds;

  it('has one entry per kind, each dated and sourced', () => {
    expect(Object.keys(kinds).sort()).toEqual(['debian', 'node', 'postgresql', 'python', 'terraform', 'ubuntu']);
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
    const labHost = [...collected.pins, ...collected.problems].filter((p) => p.file.startsWith('lab-host/'));
    expect(labHost.some((p) => p.kind === 'node')).toBe(true);
    expect(labHost.some((p) => p.kind === 'python')).toBe(true);
    expect(labHost.filter((p) => p.kind === 'ubuntu').length).toBeGreaterThanOrEqual(2);
    expect(labHost.filter((p) => p.kind === 'postgresql').map((p) => p.where)).toEqual([
      'lab-host/ansible/group_vars/all.yml > coder_postgres_image_tag',
    ]);
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
