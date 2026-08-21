import { describe, it, expect } from 'vitest';
import { buildArmBody, hasProperty, COMPUTED_PROPERTY, sortDateQuery } from './apply-computed-sortdate.mjs';

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

describe('apply-computed-sortdate ARM body', () => {
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
    const stale = { ...armResource, computedProperties: [{ name: 'cp_sortDate', query: 'SELECT VALUE 1 FROM c' }, { name: 'other', query: 'SELECT VALUE 2 FROM c' }] };
    const { properties } = buildArmBody(stale);
    const names = properties.resource.computedProperties.map((p) => p.name);
    expect(names).toEqual(['other', 'cp_sortDate']);
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
