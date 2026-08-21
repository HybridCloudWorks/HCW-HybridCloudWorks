/**
 * The computed-property definition, pinned. The query string IS the behavior —
 * it runs inside Cosmos, out of reach of every other test — so what can be
 * checked here is that it expresses exactly the five-alias fallback the server
 * and frontend resolve in JS, in the same priority order, and that the
 * ISO gate the --inspect step applies matches what lexicographic order needs.
 *
 * The ARM body tests below pin the control-plane write that --apply performs
 * since 2026-08-21: the GET's `properties.resource` minus ARM's read-only
 * keys, with cp_sortDate merged in exactly once.
 */
import { describe, it, expect } from 'vitest';
import {
  sortDateQuery,
  COMPUTED_PROPERTY,
  isSortableIso,
  buildArmBody,
  hasProperty,
} from './apply-computed-sortdate.mjs';

describe('sortDateQuery', () => {
  it('falls through the five aliases in resolvePublishedDateValue order', () => {
    const q = sortDateQuery();
    const order = [
      'c.publishedDate',
      'c.datePublished',
      'c["Published At"]',
      'c.blogPublishedAt',
      'c.publishedAt',
    ].map((a) => q.indexOf(`IS_STRING(${a})`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('is total: the final fallback is the empty string, not undefined', () => {
    // Presence on every document is the entire point — an undefined fallback
    // would recreate the drops-missing-documents behavior this fixes.
    expect(sortDateQuery()).toMatch(/: ""\)+ FROM c$/);
  });

  it('names the property the endpoint orders by', () => {
    expect(COMPUTED_PROPERTY.name).toBe('cp_sortDate');
  });
});

describe('isSortableIso — the --inspect gate', () => {
  it('admits ISO-8601 date prefixes', () => {
    expect(isSortableIso('2026-08-14T17:00:00Z')).toBe(true);
    expect(isSortableIso('2026-08-14')).toBe(true);
  });

  it('rejects the formats that would silently mis-sort', () => {
    for (const bad of ['April 20, 2026', '08/14/2026', '', 1734567890, null]) {
      expect(isSortableIso(bad)).toBe(false);
    }
  });
});

// The ARM GET body of a container, as observed on cosmos-site-prod-cus on
// 2026-08-21 (shape only — read-only keys and all).
const armResource = {
  id: 'content',
  indexingPolicy: { indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [] },
  partitionKey: { paths: ['/id'], kind: 'Hash' },
  uniqueKeyPolicy: { uniqueKeys: [] },
  conflictResolutionPolicy: { mode: 'LastWriterWins', conflictResolutionPath: '/_ts' },
  backupPolicy: { type: 'Continuous' },
  geospatialConfig: { type: 'Geography' },
  _rid: 'x', _ts: 1, _self: 'dbs/x/colls/y', _etag: '"e"', _docs: 'docs/', _sprocs: 'sprocs/', _triggers: 't/', _udfs: 'u/', _conflicts: 'c/',
  computedProperties: [],
  statistics: [],
};

describe('buildArmBody — the --apply control-plane write', () => {
  it('strips every read-only key and keeps the rest of the resource intact', () => {
    const { properties } = buildArmBody(armResource);
    for (const k of ['_rid', '_ts', '_self', '_etag', '_docs', '_sprocs', '_triggers', '_udfs', '_conflicts', 'statistics']) {
      expect(properties.resource).not.toHaveProperty(k);
    }
    expect(properties.resource.id).toBe('content');
    expect(properties.resource.partitionKey).toEqual(armResource.partitionKey);
    expect(properties.resource.indexingPolicy).toEqual(armResource.indexingPolicy);
    expect(properties.options).toEqual({});
  });

  it('adds cp_sortDate once and replaces a stale definition rather than duplicating it', () => {
    const stale = {
      ...armResource,
      computedProperties: [
        { name: 'cp_sortDate', query: 'SELECT VALUE 1 FROM c' },
        { name: 'other', query: 'SELECT VALUE 2 FROM c' },
      ],
    };
    const { properties } = buildArmBody(stale);
    expect(properties.resource.computedProperties.map((p) => p.name)).toEqual(['other', 'cp_sortDate']);
    expect(properties.resource.computedProperties.at(-1).query).toBe(sortDateQuery());
  });

  it('hasProperty is exact on name AND query', () => {
    expect(hasProperty(armResource)).toBe(false);
    expect(hasProperty({ computedProperties: [{ name: 'cp_sortDate', query: 'SELECT VALUE 1 FROM c' }] })).toBe(false);
    expect(hasProperty({ computedProperties: [COMPUTED_PROPERTY] })).toBe(true);
  });

  it('does not mutate the input', () => {
    const copy = structuredClone(armResource);
    buildArmBody(armResource);
    expect(armResource).toEqual(copy);
  });
});
