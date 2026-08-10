/**
 * Legacy-blogs read counter.
 *
 * Two things carry the weight: the route is guarded (the source's was not,
 * and its only caller is an admin page), and the arithmetic is right — the
 * whole reason this endpoint exists is to produce a number someone will use to
 * decide whether to delete a container (TODO.md T-316).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  applyLegacyBlogsRead,
  createLegacyBlogsTelemetryHandlers,
  LEGACY_BLOGS_READS_ID,
  LEGACY_BLOGS_READ_SOURCES,
  normalizeSource,
  sanitizeDetails,
  TELEMETRY_CONTAINER,
} from './legacy-blogs-telemetry.js';

const context = { log: vi.fn(), error: vi.fn() };
const NOW = new Date('2026-06-01T12:00:00.000Z');

const allowGuard = () => ({
  requireRole: vi.fn(async () => ({ user: { oid: 'u1' } })),
});
const denyGuard = () => ({
  requireRole: vi.fn(async () => ({
    error: { status: 401, body: JSON.stringify({ error: 'Unauthorized' }) },
  })),
});

const makeStore = (existing = null) => ({
  readDoc: vi.fn(async () => existing),
  upsertDoc: vi.fn(async (_c, doc) => doc),
});

const makeRequest = (body = { source: 'SocialHubPage' }) => ({
  method: 'POST',
  json: async () => body,
});

const run = (store, guard = allowGuard(), body) =>
  createLegacyBlogsTelemetryHandlers({
    guard,
    store,
    now: () => NOW,
  }).recordLegacyBlogsRead(makeRequest(body), context);

describe('normalizeSource', () => {
  it('lowercases and collapses to the allowlist spelling', () => {
    expect(normalizeSource('SocialHubPage')).toBe('socialhubpage');
    expect(normalizeSource('  Social Hub Page ')).toBe('social_hub_page');
    expect(normalizeSource(undefined)).toBe('unknown');
  });
});

describe('sanitizeDetails', () => {
  it('accepts primitives and truncates long values', () => {
    const out = sanitizeDetails({
      collectionPath: 'blogs',
      limit: 250,
      ok: true,
      none: null,
    });
    expect(out).toEqual({
      collectionPath: 'blogs',
      limit: 250,
      ok: true,
      none: null,
    });
    expect(sanitizeDetails({ long: 'x'.repeat(900) }).long).toHaveLength(500);
  });

  it('rejects nesting, too many keys, and oversized payloads', () => {
    expect(sanitizeDetails({ nested: { a: 1 } })).toBeNull();
    expect(sanitizeDetails({ arr: [1, 2] })).toBeNull();
    expect(
      sanitizeDetails(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])))
    ).toBeNull();
    expect(
      sanitizeDetails(
        Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 'y'.repeat(400)]))
      )
    ).toBeNull();
  });
});

describe('applyLegacyBlogsRead', () => {
  const event = {
    source: 'socialhubpage',
    count: 2,
    details: {},
    nowIso: NOW.toISOString(),
  };

  it('starts a counter from nothing', () => {
    expect(applyLegacyBlogsRead(null, event)).toMatchObject({
      id: LEGACY_BLOGS_READS_ID,
      totalReads: 2,
      sources: { socialhubpage: 2 },
      updatedAt: NOW.toISOString(),
    });
  });

  it('adds to an existing counter rather than replacing it', () => {
    // Cosmos has no server-side increment, so this is a read-modify-write —
    // getting it wrong resets the evidence instead of accumulating it.
    const existing = {
      totalReads: 5,
      sources: { socialhubpage: 3, unknown: 2 },
    };
    expect(applyLegacyBlogsRead(existing, event)).toMatchObject({
      totalReads: 7,
      sources: { socialhubpage: 5, unknown: 2 },
    });
  });

  it('omits lastDetails when there are none, rather than writing an empty object', () => {
    expect(applyLegacyBlogsRead(null, event)).not.toHaveProperty('lastDetails');
    expect(
      applyLegacyBlogsRead(null, {
        ...event,
        details: { collectionPath: 'blogs' },
      }).lastDetails
    ).toEqual({ collectionPath: 'blogs' });
  });
});

describe('recordLegacyBlogsRead', () => {
  it('records a read from an allowlisted source', async () => {
    const store = makeStore();
    const res = await run(store, allowGuard(), {
      source: 'SocialHubPage',
      details: { collectionPath: 'blogs', limit: 250 },
    });

    expect(res.status).toBe(200);
    const [container, doc] = store.upsertDoc.mock.calls[0];
    expect(container).toBe(TELEMETRY_CONTAINER);
    expect(doc.sources).toEqual({ socialhubpage: 1 });
    expect(doc.lastDetails).toEqual({ collectionPath: 'blogs', limit: 250 });
  });

  it('denial makes zero store calls', async () => {
    // The route is guarded, unlike the Firebase original. An anonymous counter
    // is a free write-amplification target and lets anyone poison the number.
    const store = makeStore();
    const res = await run(store, denyGuard());

    expect(res.status).toBe(401);
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('refuses a source outside the allowlist', async () => {
    // Free-text sources would let a caller grow `sources.<key>` without bound.
    const store = makeStore();
    const res = await run(store, allowGuard(), { source: 'attacker-chosen' });

    expect(res.status).toBe(400);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('lists only callers that exist', () => {
    // The source repo's allowlist named five useFirestore* hooks that went away
    // with the migration. A stale allowlist reads as a record of live callers.
    expect([...LEGACY_BLOGS_READ_SOURCES].sort()).toEqual(['socialhubpage', 'unknown']);
  });

  it('refuses malformed details', async () => {
    const store = makeStore();
    expect((await run(store, allowGuard(), { source: 'unknown', details: [1, 2] })).status).toBe(
      400
    );
    expect(
      (
        await run(store, allowGuard(), {
          source: 'unknown',
          details: { a: { b: 1 } },
        })
      ).status
    ).toBe(400);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('clamps count to at least one', async () => {
    const store = makeStore();
    await run(store, allowGuard(), { source: 'unknown', count: -5 });
    expect(store.upsertDoc.mock.calls[0][1].totalReads).toBe(1);

    const store2 = makeStore();
    await run(store2, allowGuard(), { source: 'unknown', count: 'abc' });
    expect(store2.upsertDoc.mock.calls[0][1].totalReads).toBe(1);
  });

  it('returns 500 without leaking the store error', async () => {
    const store = makeStore();
    store.readDoc = vi.fn(async () => {
      throw new Error('cosmos endpoint unreachable');
    });
    const res = await run(store, allowGuard());

    expect(res.status).toBe(500);
    expect(res.body).not.toContain('cosmos endpoint unreachable');
  });
});
