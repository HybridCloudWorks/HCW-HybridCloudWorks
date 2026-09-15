/**
 * The scenario arithmetic (#613, Phase 2), checked against a fixture whose
 * prices are round enough to redo by hand — every expected figure below is
 * written out as the multiplication it came from, so a wrong constant fails
 * with a number a reviewer can trace, not a diff of two opaque floats.
 */
import { describe, it, expect } from 'vitest';
import {
  ASSUMPTIONS,
  BACKUP_TIER_FACTOR,
  COMMIT_DISCOUNT,
  DEFAULT_SCENARIO_ID,
  EGRESS_PRESETS,
  EXTRAS,
  EXTRA_IDS,
  PROVIDER_IDS,
  SCENARIOS,
  SERVICE_IDS,
  ZONE_FACTOR,
  computeScenario,
  decodeScenario,
  effectiveQuantities,
  encodeScenario,
  formatAssumption,
  formatCost,
  formatDelta,
  groupChoice,
  isScenarioParam,
  normalizeExtras,
  priceTable,
  scenarioQuantities,
  setExtra,
  setGroupChoice,
} from './index';

const row = (provider, pricePerUnit, source = 'live') => ({
  provider,
  sku: `${provider}-sku`,
  pricePerUnit,
  unit: 'x',
  currency: 'USD',
  source,
});

/**
 * Round prices. Note GCP has no NoSQL row (unavailable) and Azure's object
 * storage is a catalogue figure.
 */
const PRICING = {
  region: 'us-east-1',
  services: [
    { serviceId: 'compute-vm', rows: [row('aws', 0.2), row('azure', 0.25), row('gcp', 0.15)] },
    { serviceId: 'compute-serverless', rows: [row('aws', 3), row('azure', 3), row('gcp', 2)] },
    {
      serviceId: 'storage-object',
      rows: [row('aws', 0.02), row('azure', 0.02, 'baseline'), row('gcp', 0.01)],
    },
    {
      serviceId: 'database-relational',
      rows: [row('aws', 0.5), row('azure', 0.4), row('gcp', 0.6)],
    },
    { serviceId: 'database-nosql', rows: [row('aws', 1), row('azure', 1)] },
    {
      serviceId: 'containers-kubernetes',
      rows: [row('aws', 0.4), row('azure', 0.4), row('gcp', 0.4)],
    },
    {
      serviceId: 'integration-messaging',
      rows: [row('aws', 0.8), row('azure', 0.9), row('gcp', 0.7)],
    },
    { serviceId: 'edge-cdn', rows: [row('aws', 0.1), row('azure', 0.08), row('gcp', 0.05)] },
  ],
};

const run = (over = {}) =>
  computeScenario({ pricing: PRICING, scenarioId: 'three-tier-web', extras: [], ...over });
const providerOf = (result, id) => result.providers.find((p) => p.provider === id);
const segmentOf = (result, provider, extraId) =>
  providerOf(result, provider).segments.find((s) => s.extraId === extraId);

describe('the catalogue of scenarios, extras and assumptions', () => {
  it('names five scenarios, each quantity a known service with a note', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'static-site-api',
      'three-tier-web',
      'event-driven',
      'data-platform',
      'kubernetes-platform',
    ]);
    for (const scenario of SCENARIOS) {
      expect(scenario.label).toBeTruthy();
      expect(scenario.blurb).toBeTruthy();
      for (const [id, quantity] of Object.entries(scenario.quantities)) {
        expect(SERVICE_IDS).toContain(id);
        expect(quantity).toBeGreaterThan(0);
        expect(scenario.notes[id], `${scenario.id} has no note for ${id}`).toBeTruthy();
      }
    }
    expect(SCENARIOS.some((s) => s.id === DEFAULT_SCENARIO_ID)).toBe(true);
  });

  it('fills every service in, zeros for the ones a scenario does not use', () => {
    const q = scenarioQuantities('three-tier-web');
    expect(Object.keys(q)).toEqual([...SERVICE_IDS]);
    expect(q['compute-vm']).toBe(1460);
    expect(q['database-relational']).toBe(730);
    expect(q['containers-kubernetes']).toBe(0);
    // Unknown scenario: the default, never a throw.
    expect(scenarioQuantities('nope')).toEqual(scenarioQuantities(DEFAULT_SCENARIO_ID));
  });

  it('applies only finite non-negative overrides, and the egress override last', () => {
    const q = effectiveQuantities('three-tier-web', {
      'compute-vm': 2190,
      'edge-cdn': 100,
      'storage-object': -5,
      'database-relational': 'lots',
      bogus: 9,
    });
    expect(q['compute-vm']).toBe(2190);
    expect(q['edge-cdn']).toBe(100);
    expect(q['storage-object']).toBe(200);
    expect(q['database-relational']).toBe(730);
    expect(q.bogus).toBeUndefined();
    expect(effectiveQuantities('three-tier-web', { 'edge-cdn': 100 }, 5000)['edge-cdn']).toBe(5000);
  });

  it('gives every extra a rule, a sentence, and a place in the assumptions table', () => {
    expect(EXTRA_IDS).toEqual([
      'backup',
      'dr-pilot-light',
      'dr-warm-standby',
      'dr-active-active',
      'zone-redundancy',
      'commit-1y',
      'commit-3y',
    ]);
    const assumptionIds = new Set(ASSUMPTIONS.map((a) => a.id));
    for (const extra of EXTRAS) {
      expect(typeof extra.rule).toBe('function');
      expect(extra.ruleText.length).toBeGreaterThan(40);
    }
    for (const id of [
      'backup-tier-factor',
      'zone-storage-uplift',
      'zone-db-uplift',
      'commit-1y',
      'commit-3y',
    ]) {
      expect(assumptionIds.has(id), id).toBe(true);
    }
    for (const assumption of ASSUMPTIONS) {
      expect(Object.keys(assumption.values).sort()).toEqual(['aws', 'azure', 'gcp']);
      expect(assumption.sources.length).toBeGreaterThan(0);
      for (const source of assumption.sources) {
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.label).toBeTruthy();
      }
    }
  });

  it('prices every extra on every scenario off the eight meters only', () => {
    const prices = priceTable(PRICING);
    for (const scenario of SCENARIOS) {
      for (const provider of PROVIDER_IDS) {
        const quantities = scenarioQuantities(scenario.id);
        for (const extra of EXTRAS) {
          for (const item of extra.rule({ quantities, prices, provider })) {
            expect(SERVICE_IDS).toContain(item.serviceId);
            expect(Number.isFinite(item.quantity)).toBe(true);
            expect(Number.isFinite(item.factor)).toBe(true);
            expect(item.label).toBeTruthy();
          }
        }
      }
    }
    expect(EGRESS_PRESETS).toEqual([100, 500, 1000, 5000, 20000]);
  });
});

describe('the base bill', () => {
  it('sums quantity × unit price per provider and finds the cheapest', () => {
    const result = run();
    // AWS: 1460×0.2 + 730×0.5 + 200×0.02 + 500×0.1 = 292 + 365 + 4 + 50
    expect(providerOf(result, 'aws').base.total).toBeCloseTo(711, 6);
    // Azure: 1460×0.25 + 730×0.4 + 200×0.02 + 500×0.08 = 365 + 292 + 4 + 40
    expect(providerOf(result, 'azure').base.total).toBeCloseTo(701, 6);
    // GCP: 1460×0.15 + 730×0.6 + 200×0.01 + 500×0.05 = 219 + 438 + 2 + 25
    expect(providerOf(result, 'gcp').base.total).toBeCloseTo(684, 6);
    expect(result.cheapest).toEqual(['gcp']);
    expect(providerOf(result, 'gcp').deltaFromCheapest).toBe(0);
    expect(providerOf(result, 'aws').deltaFromCheapest).toBeCloseTo(27 / 684, 9);
    expect(providerOf(result, 'azure').deltaFromCheapest).toBeCloseTo(17 / 684, 9);
    expect(providerOf(result, 'aws').monthly).toBeCloseTo(711, 6);
    expect(providerOf(result, 'aws').yearly).toBeCloseTo(711 * 12, 6);
    // Four lines, one per service the scenario uses, each with its source.
    const { lines } = providerOf(result, 'aws').base;
    expect(lines.map((l) => l.serviceId)).toEqual([
      'compute-vm',
      'storage-object',
      'database-relational',
      'edge-cdn',
    ]);
    expect(lines.every((l) => l.source === 'live')).toBe(true);
  });

  it('names the services priced from the catalogue', () => {
    const result = run();
    expect(providerOf(result, 'azure').catalogue).toEqual(['storage-object']);
    expect(providerOf(result, 'aws').catalogue).toEqual([]);
  });

  it('takes the egress override over the scenario quantity', () => {
    const result = run({ egressGb: 1000 });
    expect(result.quantities['edge-cdn']).toBe(1000);
    // AWS: 711 − 50 + 1000×0.1
    expect(providerOf(result, 'aws').total).toBeCloseTo(761, 6);
  });

  it('makes a provider with no price for a used service unavailable, never zero', () => {
    const result = run({ scenarioId: 'static-site-api' });
    const gcp = providerOf(result, 'gcp');
    expect(gcp.total).toBeNull();
    expect(gcp.monthly).toBeNull();
    expect(gcp.yearly).toBeNull();
    expect(gcp.base.total).toBeNull();
    expect(gcp.unavailable).toEqual(['database-nosql']);
    expect(gcp.deltaFromCheapest).toBeNull();
    expect(result.cheapest).not.toContain('gcp');
    // AWS: 5×3 + 50×0.02 + 10×1 + 500×0.1 = 15 + 1 + 10 + 50
    expect(providerOf(result, 'aws').total).toBeCloseTo(76, 6);
    // Azure: 15 + 1 + 10 + 500×0.08 = 66 — the cheapest of the two priced.
    expect(result.cheapest).toEqual(['azure']);
  });

  it('propagates unavailability from an extra, too, and nulls every segment', () => {
    // Three-tier has no NoSQL, so GCP is priced — until an override adds some.
    const result = run({ quantities: { 'database-nosql': 5 }, extras: ['backup'] });
    const gcp = providerOf(result, 'gcp');
    expect(gcp.total).toBeNull();
    expect(gcp.unavailable).toEqual(['database-nosql']);
    expect(gcp.segments[0].cost).toBeNull();
    expect(providerOf(result, 'aws').total).not.toBeNull();
  });

  it('does not need a price for a line whose quantity × factor is zero', () => {
    // AWS zone redundancy on storage is ×0, so a missing S3 price must not
    // make AWS unavailable when nothing is being multiplied by it.
    const pricing = {
      services: PRICING.services.map((s) =>
        s.serviceId === 'storage-object'
          ? { ...s, rows: s.rows.filter((r) => r.provider !== 'aws') }
          : s
      ),
    };
    const result = computeScenario({
      pricing,
      scenarioId: 'kubernetes-platform',
      quantities: { 'storage-object': 0 },
      extras: ['zone-redundancy'],
    });
    expect(providerOf(result, 'aws').total).not.toBeNull();
    expect(providerOf(result, 'aws').unavailable).toEqual([]);
  });

  it('has no cheapest and no deltas when nothing is priced', () => {
    const result = computeScenario({ pricing: null, scenarioId: 'three-tier-web', extras: [] });
    expect(result.cheapest).toEqual([]);
    expect(result.providers.every((p) => p.total === null)).toBe(true);
    expect(result.providers.every((p) => p.deltaFromCheapest === null)).toBe(true);
    expect(providerOf(result, 'aws').unavailable).toEqual([
      'compute-vm',
      'storage-object',
      'database-relational',
      'edge-cdn',
    ]);
  });
});

describe('each extra', () => {
  it('backup: snapshot GB at the provider’s backup-tier share of the hot rate', () => {
    const result = run({ extras: ['backup'] });
    // 200 GB storage + 20% of a 100 GB database = 220 GB, 30 days = ×1.
    // AWS: 220 × 0.6 × 0.02 = 2.64; Azure: 220 × 0.5 × 0.02 = 2.2; GCP: 220 × 0.5 × 0.01 = 1.1
    expect(segmentOf(result, 'aws', 'backup').cost).toBeCloseTo(2.64, 9);
    expect(segmentOf(result, 'azure', 'backup').cost).toBeCloseTo(2.2, 9);
    expect(segmentOf(result, 'gcp', 'backup').cost).toBeCloseTo(1.1, 9);
    expect(providerOf(result, 'aws').total).toBeCloseTo(711 + 2.64, 9);
    const [item] = segmentOf(result, 'aws', 'backup').lines;
    expect(item.serviceId).toBe('storage-object');
    expect(item.quantity).toBe(220);
    expect(item.factor).toBe(BACKUP_TIER_FACTOR.aws);
    expect(item.label).toMatch(/200 GB of object storage \+ 20 GB \(20% of a 100 GB database\)/);
    expect(item.label).toMatch(/30-day retention/);
  });

  it('backup: nothing to snapshot costs nothing', () => {
    const result = computeScenario({
      pricing: PRICING,
      scenarioId: 'three-tier-web',
      quantities: { 'storage-object': 0, 'database-relational': 0 },
      extras: ['backup'],
    });
    expect(segmentOf(result, 'aws', 'backup').cost).toBe(0);
    expect(segmentOf(result, 'aws', 'backup').lines).toEqual([]);
  });

  it('pilot light: a storage copy, a database replica and 10% replication egress', () => {
    const result = run({ extras: ['dr-pilot-light'] });
    // AWS: 200×0.02 + 20×0.1 + 730×0.5 = 4 + 2 + 365
    expect(segmentOf(result, 'aws', 'dr-pilot-light').cost).toBeCloseTo(371, 9);
    // Azure: 4 + 20×0.08 + 730×0.4 = 4 + 1.6 + 292
    expect(segmentOf(result, 'azure', 'dr-pilot-light').cost).toBeCloseTo(297.6, 9);
    // GCP: 200×0.01 + 20×0.05 + 730×0.6 = 2 + 1 + 438
    expect(segmentOf(result, 'gcp', 'dr-pilot-light').cost).toBeCloseTo(441, 9);
    const { lines } = segmentOf(result, 'aws', 'dr-pilot-light');
    expect(lines.map((l) => [l.serviceId, l.quantity, l.factor])).toEqual([
      ['storage-object', 200, 1],
      ['edge-cdn', 20, 1],
      ['database-relational', 730, 1],
    ]);
  });

  it('warm standby: pilot light plus compute and Kubernetes at half the hours', () => {
    const result = run({ extras: ['dr-warm-standby'] });
    // AWS: 371 + 1460 × 0.5 × 0.2 = 371 + 146; no Kubernetes in the scenario, so no line.
    expect(segmentOf(result, 'aws', 'dr-warm-standby').cost).toBeCloseTo(517, 9);
    const { lines } = segmentOf(result, 'aws', 'dr-warm-standby');
    expect(lines.map((l) => l.serviceId)).toEqual([
      'storage-object',
      'edge-cdn',
      'database-relational',
      'compute-vm',
    ]);
    const k8s = computeScenario({
      pricing: PRICING,
      scenarioId: 'kubernetes-platform',
      extras: ['dr-warm-standby'],
    });
    const k8sLine = segmentOf(k8s, 'aws', 'dr-warm-standby').lines.find(
      (l) => l.serviceId === 'containers-kubernetes'
    );
    expect(k8sLine.quantity).toBe(730);
    expect(k8sLine.factor).toBe(0.5);
  });

  it('active-active: every service again plus 25% cross-region egress', () => {
    const result = run({ extras: ['dr-active-active'] });
    // AWS: the whole base again (711) + 125 GB × 0.1
    expect(segmentOf(result, 'aws', 'dr-active-active').cost).toBeCloseTo(723.5, 9);
    expect(providerOf(result, 'aws').total).toBeCloseTo(711 + 723.5, 9);
    const { lines } = segmentOf(result, 'aws', 'dr-active-active');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toMatchObject({ serviceId: 'edge-cdn', quantity: 125, factor: 1 });
  });

  it('zone redundancy: the provider’s storage and database uplifts', () => {
    const result = run({ extras: ['zone-redundancy'] });
    // AWS: 200×0×0.02 + 730×1×0.5 = 365; Azure: 200×0.25×0.02 + 730×1×0.4 = 1 + 292; GCP: 0 + 438
    expect(segmentOf(result, 'aws', 'zone-redundancy').cost).toBeCloseTo(365, 9);
    expect(segmentOf(result, 'azure', 'zone-redundancy').cost).toBeCloseTo(293, 9);
    expect(segmentOf(result, 'gcp', 'zone-redundancy').cost).toBeCloseTo(438, 9);
    const [awsStorage] = segmentOf(result, 'aws', 'zone-redundancy').lines;
    expect(awsStorage.factor).toBe(ZONE_FACTOR.aws.storage);
    expect(awsStorage.cost).toBe(0);
    expect(awsStorage.label).toMatch(/already zone-redundant/);
  });

  it('commitment: a negative segment on compute, Kubernetes and the database', () => {
    const oneYear = run({ extras: ['commit-1y'] });
    // AWS: −0.28 × (292 + 365) = −183.96; Azure: −0.35 × (365 + 292) = −229.95; GCP: −0.37 × (219 + 438) = −243.09
    expect(segmentOf(oneYear, 'aws', 'commit-1y').cost).toBeCloseTo(-183.96, 9);
    expect(segmentOf(oneYear, 'azure', 'commit-1y').cost).toBeCloseTo(-229.95, 9);
    expect(segmentOf(oneYear, 'gcp', 'commit-1y').cost).toBeCloseTo(-243.09, 9);
    expect(providerOf(oneYear, 'aws').total).toBeCloseTo(711 - 183.96, 9);
    expect(segmentOf(oneYear, 'aws', 'commit-1y').lines.map((l) => l.factor)).toEqual([
      -COMMIT_DISCOUNT.aws['1y'],
      -COMMIT_DISCOUNT.aws['1y'],
    ]);

    const threeYear = run({ extras: ['commit-3y'] });
    // AWS: −0.5 × 657
    expect(segmentOf(threeYear, 'aws', 'commit-3y').cost).toBeCloseTo(-328.5, 9);
    // A commitment can move the ranking: with 3 years Azure (701 − 394.2) beats GCP (684 − 361.35).
    expect(threeYear.cheapest).toEqual(['azure']);
  });

  it('stacks: total is base plus every segment, in EXTRAS order', () => {
    const result = run({ extras: ['commit-1y', 'backup', 'dr-pilot-light', 'zone-redundancy'] });
    const aws = providerOf(result, 'aws');
    expect(aws.segments.map((s) => s.extraId)).toEqual([
      'backup',
      'dr-pilot-light',
      'zone-redundancy',
      'commit-1y',
    ]);
    expect(aws.total).toBeCloseTo(711 + 2.64 + 371 + 365 - 183.96, 9);
  });
});

describe('mutual exclusion', () => {
  it('keeps one DR level and one commitment term, the last named', () => {
    expect(normalizeExtras(['dr-pilot-light', 'dr-warm-standby'])).toEqual(['dr-warm-standby']);
    expect(normalizeExtras(['commit-3y', 'backup', 'commit-1y'])).toEqual(['backup', 'commit-1y']);
    expect(normalizeExtras(['backup', 'backup', 'nope', 'zone-redundancy'])).toEqual([
      'backup',
      'zone-redundancy',
    ]);
    expect(normalizeExtras(null)).toEqual([]);
  });

  it('setExtra replaces within a group and toggles outside one', () => {
    expect(setExtra(['dr-pilot-light', 'backup'], 'dr-active-active', true)).toEqual([
      'backup',
      'dr-active-active',
    ]);
    expect(setExtra(['backup', 'dr-active-active'], 'dr-active-active', false)).toEqual(['backup']);
    expect(setExtra([], 'zone-redundancy', true)).toEqual(['zone-redundancy']);
    expect(setExtra(['zone-redundancy'], 'zone-redundancy', false)).toEqual([]);
  });

  it('setGroupChoice and groupChoice drive a radio group', () => {
    expect(setGroupChoice(['backup', 'dr-pilot-light'], 'dr', 'dr-active-active')).toEqual([
      'backup',
      'dr-active-active',
    ]);
    expect(setGroupChoice(['backup', 'dr-pilot-light'], 'dr', null)).toEqual(['backup']);
    expect(setGroupChoice(['backup'], 'commit', 'commit-3y')).toEqual(['backup', 'commit-3y']);
    expect(groupChoice(['backup', 'commit-3y'], 'commit')).toBe('commit-3y');
    expect(groupChoice(['backup'], 'dr')).toBeNull();
  });

  it('computeScenario applies the same rule', () => {
    const result = run({
      extras: ['dr-pilot-light', 'dr-active-active', 'commit-1y', 'commit-3y'],
    });
    expect(result.extras).toEqual(['dr-active-active', 'commit-3y']);
    expect(providerOf(result, 'aws').segments.map((s) => s.extraId)).toEqual([
      'dr-active-active',
      'commit-3y',
    ]);
  });
});

describe('the shareable URL', () => {
  it('encodes only what differs from the defaults', () => {
    expect(encodeScenario({ scenarioId: DEFAULT_SCENARIO_ID, extras: [], quantities: {} })).toEqual(
      {}
    );
    expect(
      encodeScenario({
        scenarioId: 'three-tier-web',
        extras: ['commit-1y', 'backup', 'dr-warm-standby'],
        quantities: { 'compute-vm': 2190, 'edge-cdn': 1000, 'storage-object': 200 },
      })
    ).toEqual({
      extras: 'backup,dr-warm-standby,commit-1y',
      egress: '1000',
      'q.compute-vm': '2190',
    });
    expect(encodeScenario({ scenarioId: 'kubernetes-platform' })).toEqual({
      scenario: 'kubernetes-platform',
    });
  });

  it('round-trips through URLSearchParams', () => {
    const state = {
      scenarioId: 'data-platform',
      extras: ['backup', 'dr-active-active', 'zone-redundancy', 'commit-3y'],
      quantities: { 'compute-vm': 3650, 'edge-cdn': 5000, 'integration-messaging': 0 },
    };
    const params = new URLSearchParams(encodeScenario(state));
    expect(params.toString()).toBe(
      'scenario=data-platform&extras=backup%2Cdr-active-active%2Czone-redundancy%2Ccommit-3y&q.compute-vm=3650&q.integration-messaging=0&egress=5000'
    );
    expect(decodeScenario(params)).toEqual(state);
    expect(decodeScenario(new URLSearchParams(encodeScenario(decodeScenario(params))))).toEqual(
      state
    );
  });

  it('falls back to defaults for unknown ids and rejects bad numbers', () => {
    const decoded = decodeScenario(
      new URLSearchParams(
        'scenario=mainframe&extras=backup,teleport,dr-pilot-light,dr-warm-standby&egress=Infinity&q.compute-vm=-4&q.storage-object=abc&q.database-relational=1e3&q.warp-drive=7&region=westeurope'
      )
    );
    expect(decoded).toEqual({
      scenarioId: DEFAULT_SCENARIO_ID,
      extras: ['backup', 'dr-warm-standby'],
      quantities: { 'database-relational': 1000 },
    });
    expect(decodeScenario(null)).toEqual({
      scenarioId: DEFAULT_SCENARIO_ID,
      extras: [],
      quantities: {},
    });
    expect(decodeScenario(new URLSearchParams('q.compute-vm=1460'))).toEqual({
      scenarioId: DEFAULT_SCENARIO_ID,
      extras: [],
      quantities: {},
    });
  });

  it('knows which keys are its own, leaving ?region= to the page', () => {
    expect(isScenarioParam('scenario')).toBe(true);
    expect(isScenarioParam('extras')).toBe(true);
    expect(isScenarioParam('egress')).toBe(true);
    expect(isScenarioParam('q.compute-vm')).toBe(true);
    expect(isScenarioParam('region')).toBe(false);
  });
});

describe('formatting', () => {
  it('formats costs to two decimals with a real minus sign', () => {
    expect(formatCost(1234.5)).toBe('$1,234.50');
    expect(formatCost(-183.96)).toBe('−$183.96');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(null)).toBeNull();
    expect(formatCost('x')).toBeNull();
  });

  it('formats a delta as a rounded percentage, blank for the cheapest', () => {
    expect(formatDelta(27 / 684)).toBe('+4%');
    expect(formatDelta(0)).toBe('');
    expect(formatDelta(null)).toBe('');
  });

  it('formats an assumption in its declared shape', () => {
    expect(formatAssumption(0.28, 'percent')).toBe('28%');
    expect(formatAssumption(0.6, 'factor')).toBe('×0.6');
    expect(formatAssumption(730, 'number')).toBe('730');
    expect(formatAssumption(undefined, 'number')).toBe('—');
  });
});
