import { describe, it, expect } from 'vitest';

import { sanitizeId, convertValue, transformDocument } from './firestore-transform.mjs';
import {
  flattenManifest,
  provisionedContainers,
  COLLECTIONS,
  DEFAULT_PARTITION_KEY,
} from './migration-manifest.mjs';
import { parseArgs, splitList } from './cli.mjs';

/** Minimal stand-in for a live Firestore Timestamp. */
const timestamp = (iso) => ({
  _seconds: Math.floor(new Date(iso).getTime() / 1000),
  _nanoseconds: 0,
  toDate: () => new Date(iso),
});

describe('sanitizeId', () => {
  it('passes ordinary ids through untouched', () => {
    expect(sanitizeId('abc123')).toEqual({ id: 'abc123', rewritten: false, reason: null });
  });

  it('replaces characters Cosmos DB forbids', () => {
    const result = sanitizeId('aws/well-architected?v=2#intro');
    expect(result.id).toBe('aws_well-architected_v=2_intro');
    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('illegal-characters');
  });

  it('trims trailing whitespace, which Cosmos silently strips', () => {
    const result = sanitizeId('slug ');
    expect(result.id).toBe('slug');
    expect(result.reason).toContain('trailing-whitespace');
  });

  it('truncates ids beyond the 1023-byte limit', () => {
    const result = sanitizeId('x'.repeat(2000));
    expect(Buffer.byteLength(result.id, 'utf8')).toBe(1023);
    expect(result.reason).toContain('too-long');
  });
});

describe('convertValue', () => {
  it('converts a top-level Timestamp to an ISO string', () => {
    expect(convertValue(timestamp('2026-07-30T10:00:00.000Z'))).toBe('2026-07-30T10:00:00.000Z');
  });

  it('converts Timestamps nested inside objects', () => {
    const result = convertValue({ meta: { audit: { updatedAt: timestamp('2026-01-02T03:04:05.000Z') } } });
    expect(result.meta.audit.updatedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('converts Timestamps nested inside arrays', () => {
    const result = convertValue({ revisions: [{ at: timestamp('2026-05-05T00:00:00.000Z') }] });
    expect(result.revisions[0].at).toBe('2026-05-05T00:00:00.000Z');
  });

  it('converts a serialized Timestamp with no toDate method', () => {
    expect(convertValue({ _seconds: 1767225600, _nanoseconds: 0 })).toBe(new Date(1767225600000).toISOString());
  });

  it('leaves ISO strings and epoch milliseconds alone', () => {
    const input = { iso: '2026-07-30T10:00:00.000Z', epoch: 1767225600000 };
    expect(convertValue(input)).toEqual(input);
  });

  it('encodes Buffers as base64 rather than an object of numeric keys', () => {
    const result = convertValue({ blob: Buffer.from('hello') });
    expect(result.blob).toEqual({ _type: 'bytes', base64: Buffer.from('hello').toString('base64') });
  });

  it('preserves a GeoPoint as latitude/longitude', () => {
    expect(convertValue({ latitude: 51.5, longitude: -0.12 })).toEqual({
      _type: 'geopoint',
      latitude: 51.5,
      longitude: -0.12,
    });
  });

  it('normalises undefined to null so the JSON round-trips', () => {
    expect(convertValue({ a: undefined })).toEqual({ a: null });
  });

  it('preserves field names containing spaces', () => {
    // Site-Main content documents carry both 'Cloud Provider' and cloudProvider.
    const result = convertValue({ 'Cloud Provider': 'Azure', cloudProvider: undefined });
    expect(result['Cloud Provider']).toBe('Azure');
  });
});

describe('transformDocument', () => {
  it('uses the Firestore document id and records it as firestoreId', () => {
    const { doc } = transformDocument({ id: 'doc-1', data: { Title: 'Hello' } });
    expect(doc.id).toBe('doc-1');
    expect(doc.firestoreId).toBe('doc-1');
  });

  it('does not let a data field named id override the document id', () => {
    const { doc, warnings } = transformDocument({ id: 'doc-1', data: { id: 'something-else', Title: 'Hello' } });
    expect(doc.id).toBe('doc-1');
    expect(doc.dataId).toBe('something-else');
    expect(warnings.map((w) => w.code)).toContain('id-field-conflict');
  });

  it('does not warn when the data id agrees with the document id', () => {
    const { doc, warnings } = transformDocument({ id: 'doc-1', data: { id: 'doc-1' } });
    expect(doc.id).toBe('doc-1');
    expect(warnings).toHaveLength(0);
  });

  it('reports a rewritten id but still preserves the original', () => {
    const { doc, warnings } = transformDocument({ id: 'a/b', data: {} });
    expect(doc.id).toBe('a_b');
    expect(doc.firestoreId).toBe('a/b');
    expect(warnings.map((w) => w.code)).toContain('id-rewritten');
  });

  it('renames Cosmos reserved properties instead of failing the write', () => {
    const { doc, warnings } = transformDocument({ id: 'doc-1', data: { _ts: 12345 } });
    expect(doc._ts).toBeUndefined();
    expect(doc.source_ts).toBe(12345);
    expect(warnings.map((w) => w.code)).toContain('reserved-property');
  });

  it('records the parent path for subcollection documents', () => {
    const { doc } = transformDocument({ id: 'v1', data: {}, parentPath: 'content/abc' });
    expect(doc.firestoreParentPath).toBe('content/abc');
  });

  it('is idempotent — re-transforming its own output is stable', () => {
    const first = transformDocument({ id: 'doc-1', data: { at: timestamp('2026-07-30T10:00:00.000Z') } }).doc;
    const second = transformDocument({ id: first.firestoreId, data: first }).doc;
    expect(second.at).toBe(first.at);
    expect(second.id).toBe(first.id);
  });
});

describe('migration manifest', () => {
  it('has no duplicate top-level collection names', () => {
    const names = COLLECTIONS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('produces unique container names, including for subcollections', () => {
    const containers = flattenManifest({ includeNonMigrated: true }).map((t) => t.container);
    const duplicates = containers.filter((c, i) => containers.indexOf(c) !== i);
    expect(duplicates).toEqual([]);
  });

  it('does not collide image_prompts/sets with the top-level image_prompt_sets', () => {
    const names = provisionedContainers();
    expect(names).toContain('image_prompts_sets');
    expect(names).toContain('image_prompt_sets');
    expect(names).toContain('image_prompt_sets_prompts');
  });

  it('provisions the authorisation-critical collections', () => {
    const names = provisionedContainers();
    for (const required of ['admins', 'admin_config', 'site_settings']) {
      expect(names).toContain(required);
    }
  });

  it('provisions containers for caches and transient state without migrating them', () => {
    // labs-http.js writes lab_jobs on every request, and the scheduled refresh
    // writes rss_cache — the containers must exist even though no documents
    // are copied into them.
    const provisioned = provisionedContainers();
    const migrated = flattenManifest().map((t) => t.container);

    for (const name of ['rss_cache', 'tool_service_cache', 'lab_jobs', 'lab_public_quota', 'tool_service_catalog']) {
      expect(provisioned).toContain(name);
      expect(migrated).not.toContain(name);
    }
  });

  it('does not provision containers for collections still under investigation', () => {
    const provisioned = provisionedContainers();
    for (const name of ['users', 'dashboard_stats', 'articles']) {
      expect(provisioned).not.toContain(name);
    }
  });

  it('reaches config data through its subcollections, not the empty parent', () => {
    const targets = flattenManifest();
    const configTargets = targets.filter((t) => t.parent === 'config');
    expect(configTargets.map((t) => t.sourcePath).sort()).toEqual([
      'config/providers/providers',
      'config/settings/settings',
      'config/tags/tags',
    ]);
  });

  it('only migrates collections with the migrate disposition', () => {
    const dispositions = new Set(flattenManifest().map((t) => t.disposition));
    expect([...dispositions]).toEqual(['migrate']);
  });

  // Flattening a subcollection into its own container makes document ids
  // globally scoped, but these four collections assign ids that are unique only
  // within their parent — a set name, a prompt name, an exam-area slug. Under
  // /id they would silently overwrite each other on upsert.
  it.each([
    ['content_versions', '/contentId', 'contentId'],
    ['image_prompts_sets', '/pageId', 'pageId'],
    ['image_prompt_sets_prompts', '/setName', 'setName'],
    ['listen_and_learn_episodes', '/setId', 'setId'],
  ])('partitions %s by its parent', (container, partitionKey, field) => {
    const target = flattenManifest().find((t) => t.container === container);
    expect(target.partitionKey).toBe(partitionKey);
    expect(target.partitionKeyFromParent).toBe(field);
  });

  it('keeps the config_* subcollections on /id — one parent means no collision', () => {
    // Each config_* container has a single fixed parentDoc, so no two documents
    // can share an id across parents. /id is correct there.
    for (const container of ['config_providers', 'config_tags', 'config_settings']) {
      const target = flattenManifest().find((t) => t.container === container);
      expect(target.partitionKey).toBe(DEFAULT_PARTITION_KEY);
      expect(target.partitionKeyFromParent).toBeNull();
    }
  });

  it('partitions everything else on /id', () => {
    const parentKeyed = new Set([
      'content_versions',
      'image_prompts_sets',
      'image_prompt_sets_prompts',
      'listen_and_learn_episodes',
    ]);
    const others = flattenManifest().filter((t) => !parentKeyed.has(t.container));
    expect([...new Set(others.map((t) => t.partitionKey))]).toEqual([DEFAULT_PARTITION_KEY]);
    expect(others.every((t) => t.partitionKeyFromParent === null)).toBe(true);
  });

  it('does not migrate the social_* collections that have no writer', () => {
    // firestore.rules matches them, but Site-Main has zero collection() call
    // sites for any of them. social_posts, which has five, stays.
    const migrated = flattenManifest().map((t) => t.container);
    for (const dead of [
      'social_workspaces',
      'social_libraries',
      'social_library_items',
      'social_schedule_slots',
      'social_analytics',
    ]) {
      expect(migrated).not.toContain(dead);
      expect(provisionedContainers()).not.toContain(dead);
    }
    expect(migrated).toContain('social_posts');
  });
});

describe('parseArgs', () => {
  const spec = { flags: ['dry-run', 'export'], options: ['collections', 'out'] };

  it('accepts --option value', () => {
    const { options } = parseArgs(['--collections', 'content,blogs'], spec);
    expect(options.collections).toBe('content,blogs');
  });

  it('accepts --option=value, which the previous parser silently dropped', () => {
    const { options } = parseArgs(['--collections=content,blogs'], spec);
    expect(options.collections).toBe('content,blogs');
  });

  it('rejects an option with a missing value rather than falling back to "all"', () => {
    expect(() => parseArgs(['--collections'], spec)).toThrow(/requires a value/);
    expect(() => parseArgs(['--collections', '--dry-run'], spec)).toThrow(/requires a value/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--collection', 'content'], spec)).toThrow(/Unknown argument/);
  });

  it('parses flags', () => {
    const { flags } = parseArgs(['--dry-run', '--export'], spec);
    expect(flags['dry-run']).toBe(true);
    expect(flags.export).toBe(true);
  });

  it('rejects a value attached to a flag', () => {
    expect(() => parseArgs(['--dry-run=true'], spec)).toThrow(/takes no value/);
  });
});

describe('splitList', () => {
  it('trims and drops empty entries', () => {
    expect(splitList(' content , blogs ,')).toEqual(['content', 'blogs']);
  });

  it('returns null for an empty selection so callers fall back to the manifest', () => {
    expect(splitList('')).toBeNull();
    expect(splitList(undefined)).toBeNull();
    expect(splitList(' , ')).toBeNull();
  });
});
