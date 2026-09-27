/**
 * The lab image vendors every module the Landing Zone Builder can emit, at
 * every version it can emit (ADR 0032 decision 5).
 *
 * Found 2026-09-27 (#737): the builder's spokes call
 * avm-res-network-virtualnetwork 0.22.2 and the image carried only 0.15.0,
 * as a child of the connectivity module, so the full default build could not
 * `terraform init` under `--network none`. Nothing compared the builder's
 * pins with what the image vendors; this does, in the `scripts (operations)`
 * CI job, whose filter already covers avmVersions.js and lab-image/. The
 * image-side half is smoke.sh (every builder module and recorded child is on
 * disk and inits offline) and sandbox-check.mjs (the builder's real default
 * build validates offline under the job sandbox).
 *
 * The check itself is scripts/lib/avm-vendoring.mjs. The last group below
 * feeds it a bumped pin and a lost child and expects it to go red, so the
 * gate is shown to fire rather than assumed to.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AVM_MODULES } from '../frontend/src/lib/landingZone/avmVersions.js';
import {
  builderModules,
  childCalls,
  childPins,
  choose,
  satisfies,
  vendoredVersions,
  vendoringProblems,
} from './lib/avm-vendoring.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(repo, ...parts), 'utf8');

const ENV = read('lab-image', 'versions.env');
const FIXTURE = read('lab-image', 'smoke', 'terraform-validate-payload', 'main.tf');
const MODULES = Object.values(AVM_MODULES);

describe('the lab image vendors what the Landing Zone Builder emits', () => {
  it('has no gap between avmVersions.js and lab-image/versions.env', () => {
    expect(vendoringProblems({ modules: MODULES, env: ENV, fixture: FIXTURE })).toEqual([]);
  });

  it('vendors each pinned module as a builder module at the pinned version, with a tarball sum', () => {
    const vendored = builderModules(ENV);
    expect(vendored.map((m) => `${m.name}@${m.version}`).sort()).toEqual(
      MODULES.map((m) => `${m.name}@${m.version}`).sort()
    );
    for (const m of vendored) expect(m.sha256, m.name).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records what every pinned version calls, and pins every child it records', () => {
    const calls = childCalls(ENV);
    const pins = childPins(ENV);
    for (const m of MODULES) {
      const children = calls.get(`${m.name}@${m.version}`);
      expect(children, `${m.name}@${m.version} in AVM_CHILD_CALLS`).toBeDefined();
      for (const child of children) expect(pins.has(child), `${child} in AVM_CHILD_MODULES`).toBe(true);
    }
  });

  // The case #737 found, named so a reader can find it: the spokes' version
  // and the connectivity module's child are two directories, and a spoke's
  // exact pin resolves to its own.
  it("carries the spokes' virtual network module beside the connectivity module's older copy", () => {
    const { name, version } = AVM_MODULES['avm-res-network-virtualnetwork'];
    const versions = vendoredVersions(ENV, name);
    expect(versions).toContain(version);
    expect(versions.length).toBeGreaterThan(1);
    expect(choose(versions, version)).toBe(version);
  });
});

describe('the constraint reader agrees with lab-image/lib/tf_constraints.py', () => {
  it.each([
    ['0.22.2', '0.22.2', true],
    ['0.22.2', '= 0.22.2', true],
    ['0.15.0', '0.22.2', false],
    ['0.9.0', '~> 0.9', true],
    ['1.0.0', '~> 0.9', false],
    ['0.17.5', '>= 0.17.0, < 0.18.0', true],
    ['0.18.0', '>= 0.17.0, < 0.18.0', false],
    ['0.17.9', '~> 0.17.5', true],
    ['0.18.0', '~> 0.17.5', false],
    ['0.21.0', '!= 0.21.0', false],
    ['0.21.0', '', true],
  ])('%s satisfies "%s": %s', (version, constraint, expected) => {
    expect(satisfies(version, constraint)).toBe(expected);
  });

  it('chooses the highest satisfying version, as the rewrite does', () => {
    expect(choose(['0.15.0', '0.22.2'], '>= 0.15.0')).toBe('0.22.2');
    expect(choose(['0.15.0', '0.22.2'], '~> 0.15.0')).toBe('0.15.0');
    expect(choose(['0.15.0'], '0.22.2')).toBeNull();
  });
});

describe('the check goes red when the image is left behind', () => {
  const bumped = (name, version) =>
    MODULES.map((m) => (m.name === name ? { ...m, version } : m));

  it('fails a builder pin bump that versions.env did not follow (the state #737 found)', () => {
    const problems = vendoringProblems({
      modules: bumped('avm-res-network-virtualnetwork', '0.23.0'),
      env: ENV,
      fixture: FIXTURE,
    });
    expect(problems.join('\n')).toContain(
      'the builder emits avm-res-network-virtualnetwork 0.23.0, and lab-image/versions.env vendors 0.22.2'
    );
    expect(problems.join('\n')).toContain(
      'records nothing for avm-res-network-virtualnetwork@0.23.0 in AVM_CHILD_CALLS'
    );
  });

  it('fails a bump that moved the version line but not the record of its children', () => {
    const env = ENV.replace(
      /^AVM_RES_NETWORK_VIRTUALNETWORK_VERSION=.*$/m,
      'AVM_RES_NETWORK_VIRTUALNETWORK_VERSION=0.23.0'
    );
    const problems = vendoringProblems({
      modules: bumped('avm-res-network-virtualnetwork', '0.23.0'),
      env,
      fixture: FIXTURE,
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('records nothing for avm-res-network-virtualnetwork@0.23.0');
    expect(problems[1]).toContain('AVM_CHILD_CALLS records avm-res-network-virtualnetwork@0.22.2');
  });

  it('fails a builder module the image does not vendor at all', () => {
    const env = ENV.replace(/^AVM_RES_NETWORK_VIRTUALNETWORK_(VERSION|SHA256)=.*\n/gm, '');
    const problems = vendoringProblems({ modules: MODULES, env, fixture: FIXTURE });
    expect(problems[0]).toBe(
      'the builder emits avm-res-network-virtualnetwork 0.22.2, and lab-image/versions.env has no AVM_RES_NETWORK_VIRTUALNETWORK_VERSION line, so the image does not vendor it'
    );
  });

  it('fails a recorded child that is not pinned, and a pin nothing calls', () => {
    const lost = ENV.replace(/^avm-utl-interfaces@0\.6\.0 [0-9a-f]{64}\n/m, '');
    expect(vendoringProblems({ modules: MODULES, env: lost, fixture: FIXTURE })).toEqual([
      'avm-res-network-virtualnetwork@0.22.2 calls avm-utl-interfaces@0.6.0, and AVM_CHILD_MODULES does not pin it, so the image does not vendor it',
    ]);
    const stale = ENV.replace(/^avm-res-network-virtualnetwork@0\.22\.2 avm-utl-interfaces@0\.6\.0\n/m, 'avm-res-network-virtualnetwork@0.22.2\n');
    expect(vendoringProblems({ modules: MODULES, env: stale, fixture: FIXTURE })).toEqual([
      'AVM_CHILD_MODULES pins avm-utl-interfaces@0.6.0, which no AVM_CHILD_CALLS line calls',
    ]);
  });

  it('fails a smoke payload that stops calling a builder module', () => {
    const fixture = FIXTURE.replace(/^module "spoke" \{[\s\S]*?^\}\n?/m, '');
    const problems = vendoringProblems({ modules: MODULES, env: ENV, fixture });
    expect(problems).toEqual([
      'lab-image/smoke/terraform-validate-payload/main.tf calls Azure/avm-res-network-virtualnetwork/azurerm 0 times, not once; smoke.sh expects one rewrite per builder module',
    ]);
  });
});
