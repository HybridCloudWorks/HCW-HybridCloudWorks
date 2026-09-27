/**
 * The lab image mirror (#672). What must hold: `LAB_IMAGE_AVM` is exactly
 * what lab-image/ vendors, read from its Dockerfile and versions.env, so the
 * two cannot drift; the constraint evaluator is tf_constraints.py's, case for
 * case; the module scan is tf_rewrite.py's (top-level blocks, depth-1
 * `source` and `version` only, registry AVM sources only, `.tf` files only);
 * and against the builder's own output it says what the image will do: the
 * three pattern modules resolve, and the spoke module the image does not
 * vendor does not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STATE,
  LAB_IMAGE_AVM,
  chooseVendored,
  decodeLz,
  emitFiles,
  labModuleReport,
  labResolution,
  parseVersion,
  satisfies,
  vendoredModules,
} from './index';

const LAB_IMAGE = join(process.cwd(), '..', 'lab-image');

/** `KEY=value` and `KEY='multi-line'` assignments from versions.env, which /bin/sh sources. */
function readVersionsEnv() {
  const text = readFileSync(join(LAB_IMAGE, 'versions.env'), 'utf8');
  const values = {};
  const assignment = /^([A-Z0-9_]+)=(?:'([^']*)'|(\S*))/gm;
  for (const m of text.matchAll(assignment)) values[m[1]] = m[2] ?? m[3];
  return values;
}

/** What the image vendors: each `vendor <name> "${VAR}"` in the Dockerfile, plus every AVM_CHILD_MODULES line. */
function vendoredByImage() {
  const env = readVersionsEnv();
  const dockerfile = readFileSync(join(LAB_IMAGE, 'Dockerfile'), 'utf8');
  const top = [...dockerfile.matchAll(/vendor ([a-z0-9-]+) "\$\{([A-Z0-9_]+)\}"/g)].map(
    ([, name, variable]) => `${name}@${env[variable]}`
  );
  const children = env.AVM_CHILD_MODULES.split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
  return { top, children };
}

const state = (query) => decodeLz(new URLSearchParams(query));

describe('LAB_IMAGE_AVM is what lab-image/ vendors', () => {
  it('lists the three pattern modules and every child, and nothing else', () => {
    const { top, children } = vendoredByImage();
    expect(top).toEqual([
      'avm-ptn-alz@0.21.0',
      'avm-ptn-alz-management@0.9.0',
      'avm-ptn-alz-connectivity-hub-and-spoke-vnet@0.17.5',
    ]);
    expect(children.length).toBeGreaterThan(0);
    expect([...LAB_IMAGE_AVM].sort()).toEqual([...top, ...children].sort());
  });

  it('holds only name@version entries the image’s own parser accepts', () => {
    const parsed = vendoredModules();
    const count = Object.values(parsed).reduce((n, list) => n + list.length, 0);
    expect(count).toBe(LAB_IMAGE_AVM.length);
  });
});

describe('Terraform constraints, as tf_constraints.py reads them', () => {
  const v = (text) => parseVersion(text);

  it.each([
    ['0.21.0', '0.21.0', true],
    ['0.21.0', '0.21.1', false],
    ['0.21.0', '= 0.21.0', true],
    ['0.21.0', 'v0.21.0', true],
    ['0.22.0', '~> 0.21', true],
    ['1.0.0', '~> 0.21', false],
    ['0.21.5', '~> 0.21.0', true],
    ['0.22.0', '~> 0.21.0', false],
    ['0.9.0', '>= 0.9, < 1.0', true],
    ['1.0.0', '>= 0.9, < 1.0', false],
    ['0.5.0', '!= 0.5.0', false],
    ['0.5.1', '!= 0.5.0', true],
    ['0.3.1', '> 0.3.0', true],
    ['0.3.0', '<= 0.3.0', true],
    ['0.21.0', '', true],
    ['0.21.0', '   ', true],
    ['0.21.0', 'latest', false],
    ['0.21.0', '>= 0.21, banana', false],
  ])('%s against %j is %s', (version, constraint, expected) => {
    expect(satisfies(v(version), constraint)).toBe(expected);
  });

  it('parses only three-part versions', () => {
    expect(parseVersion('0.21.0')).toEqual([0, 21, 0]);
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('0.21')).toBeNull();
    expect(parseVersion('0.21.0-beta')).toBeNull();
  });

  it('picks the highest vendored version that satisfies, as the registry would', () => {
    const vendored = vendoredModules();
    expect(chooseVendored(vendored, 'avm-res-network-routetable', '>= 0.3')).toBe('0.5.0');
    expect(chooseVendored(vendored, 'avm-res-network-routetable', '~> 0.3.0')).toBe('0.3.1');
    expect(chooseVendored(vendored, 'avm-utl-interfaces', '')).toBe('0.5.0');
    expect(chooseVendored(vendored, 'avm-res-network-virtualnetwork', '0.22.2')).toBeNull();
    expect(chooseVendored(vendored, 'avm-not-vendored', '')).toBeNull();
  });
});

describe('the module scan, as tf_rewrite.py does it', () => {
  const file = (path, content) => ({ path, content });

  it('takes depth-1 source and version lines only', () => {
    const [row] = labModuleReport([
      file(
        'main.tf',
        [
          'module "alz" {',
          '  source  = "Azure/avm-ptn-alz/azurerm"',
          '  version = "0.21.0"',
          '  nested = {',
          '    source  = "Azure/avm-res-network-virtualnetwork/azurerm"',
          '    version = "9.9.9"',
          '  }',
          '}',
        ].join('\n')
      ),
    ]);
    expect(row).toMatchObject({
      block: 'alz',
      module: 'avm-ptn-alz',
      constraint: '0.21.0',
      vendored: 'avm-ptn-alz@0.21.0',
    });
  });

  it('reads registry-prefixed and sub-module sources, and leaves every other source out', () => {
    const report = labModuleReport([
      file(
        'main.tf',
        [
          'module "prefixed" {',
          '  source = "registry.terraform.io/Azure/avm-ptn-alz-management/azurerm"',
          '  version = "~> 0.9"',
          '}',
          'module "sub" {',
          '  source = "Azure/avm-ptn-alz/azurerm//modules/x"',
          '}',
          'module "local" {',
          '  source = "./modules/local"',
          '}',
          'module "other" {',
          '  source  = "hashicorp/consul/aws"',
          '  version = "0.1.0"',
          '}',
        ].join('\n')
      ),
    ]);
    expect(report.map((r) => [r.block, r.vendored])).toEqual([
      ['prefixed', 'avm-ptn-alz-management@0.9.0'],
      ['sub', 'avm-ptn-alz@0.21.0'],
    ]);
  });

  it('scans .tf files only, skipping .terraform and .git, in path order', () => {
    const block = 'module "m" {\n  source = "Azure/avm-ptn-alz/azurerm"\n}\n';
    const report = labModuleReport([
      file('z.tf', block),
      file('README.md', block),
      file('terraform.tfvars.example', block),
      file('.terraform/modules/x.tf', block),
      file('a.tf', block),
    ]);
    expect(report.map((r) => r.path)).toEqual(['a.tf', 'z.tf']);
  });
});

describe('against the builder’s own output', () => {
  it('resolves the three pattern modules and names the spoke module it cannot', () => {
    const files = emitFiles(DEFAULT_STATE);
    const report = labModuleReport(files);
    const byModule = Object.fromEntries(report.map((r) => [r.module, r.vendored]));
    expect(byModule).toEqual({
      'avm-ptn-alz': 'avm-ptn-alz@0.21.0',
      'avm-ptn-alz-management': 'avm-ptn-alz-management@0.9.0',
      'avm-ptn-alz-connectivity-hub-and-spoke-vnet':
        'avm-ptn-alz-connectivity-hub-and-spoke-vnet@0.17.5',
      'avm-res-network-virtualnetwork': null,
    });

    const { ok, unresolved } = labResolution(files);
    expect(ok).toBe(false);
    // One row per distinct module and constraint, however many spokes call it.
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({
      module: 'avm-res-network-virtualnetwork',
      constraint: '0.22.2',
      have: ['0.15.0'],
    });
  });

  it('can validate a build with no spoke', () => {
    const files = emitFiles(state('lz=mg,policy,mgmt,hub,fw&corp=0&online=0'));
    expect(labResolution(files)).toEqual({ ok: true, unresolved: [] });
  });

  it('has nothing to resolve in an empty build', () => {
    const files = emitFiles({ selected: [] });
    expect(files.map((f) => f.path)).toEqual(['README.md']);
    expect(labModuleReport(files)).toEqual([]);
  });
});
