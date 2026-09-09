/**
 * The export classification and the provisioned container spec must agree
 * (ADR 0028 §2). Read as text from `infra/cosmos-containers.json` so it fails
 * on a checkout with no Azure credentials, exactly like
 * `cosmos-client.test.js` does for partition keys.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPORT_CLASSES,
  AUTHORED,
  CONFIGURATION,
  OPERATIONAL,
  classify,
  classifiedContainers,
  exportPlanFor,
} from './export-classification.js';

const SPEC = join(
  fileURLToPath(new URL('../../../..', import.meta.url)),
  'infra',
  'cosmos-containers.json'
);

function provisioned() {
  const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
  return spec.containers.map((c) => c.name).sort();
}

describe('export classification against infra/cosmos-containers.json', () => {
  it('the spec provisions the 73 containers the ADR counted — a different number means the ADR table is stale', () => {
    // 72 at the ADR's writing; podcast_transcripts (#435) made it 73.
    expect(provisioned()).toHaveLength(73);
  });

  it('every provisioned container is classified exactly once', () => {
    const names = classifiedContainers();
    const seen = new Map();
    for (const name of names) seen.set(name, (seen.get(name) || 0) + 1);
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([name]) => name);
    expect(duplicates, 'named in more than one class').toEqual([]);

    const unclassified = provisioned().filter((name) => classify(name) === null);
    expect(
      unclassified,
      'provisioned in infra/cosmos-containers.json but classified nowhere — decide its class in export-classification.js'
    ).toEqual([]);
  });

  it('nothing unprovisioned is listed', () => {
    const live = new Set(provisioned());
    const phantom = classifiedContainers().filter((name) => !live.has(name));
    expect(phantom, 'classified but not provisioned — remove it or provision it').toEqual([]);
  });

  it('matches the ADR table: 44 authored, 10 configuration, 7 operational, 12 excluded', () => {
    expect(AUTHORED).toHaveLength(44);
    expect(CONFIGURATION).toHaveLength(10);
    expect(OPERATIONAL).toHaveLength(7);
    const excluded = ['regenerable', 'seed', 'transient'].flatMap(
      (k) => EXPORT_CLASSES[k].containers
    );
    expect(excluded).toHaveLength(12);
  });

  it('every class states both run modes, and no excluded class exports on either', () => {
    for (const [name, spec] of Object.entries(EXPORT_CLASSES)) {
      expect(typeof spec.full, `${name}.full`).toBe('boolean');
      expect(typeof spec.delta, `${name}.delta`).toBe('boolean');
      // A delta without a full would restore nothing to apply the delta to.
      if (spec.delta) expect(spec.full, `${name} has deltas but no full`).toBe(true);
    }
    for (const name of ['regenerable', 'seed', 'transient']) {
      expect(EXPORT_CLASSES[name].full).toBe(false);
      expect(EXPORT_CLASSES[name].delta).toBe(false);
    }
  });
});

describe('exportPlanFor', () => {
  it('full is A + B + C (61), delta is A + B (54), both sorted and duplicate-free', () => {
    const full = exportPlanFor('full');
    const delta = exportPlanFor('delta');
    expect(full).toHaveLength(61);
    expect(delta).toHaveLength(54);
    expect(full).toEqual([...full].sort());
    expect(delta).toEqual([...delta].sort());
    expect(new Set(full).size).toBe(61);
    // Class C is exported on full runs only (owner decision, #231).
    for (const name of OPERATIONAL) {
      expect(full).toContain(name);
      expect(delta).not.toContain(name);
    }
    // The delta set is a subset of the full set.
    for (const name of delta) expect(full).toContain(name);
  });

  it('never plans an excluded container', () => {
    const excluded = ['regenerable', 'seed', 'transient'].flatMap(
      (k) => EXPORT_CLASSES[k].containers
    );
    for (const name of excluded) {
      expect(exportPlanFor('full')).not.toContain(name);
      expect(exportPlanFor('delta')).not.toContain(name);
    }
  });

  it('refuses an unknown mode rather than planning nothing', () => {
    expect(() => exportPlanFor('weekly')).toThrow(/mode must be one of full, delta/);
    expect(() => exportPlanFor(undefined)).toThrow(/mode must be one of/);
  });
});
