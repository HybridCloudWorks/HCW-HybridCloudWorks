/**
 * The hard reaper (cleanupSoftDeletedContent): dry-run until armed, refuses
 * a mark with no recorded origin in both modes, and when armed deletes the
 * document with its blogs and versions, moves the counters, and writes one
 * audit row naming what it refused.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createContentCleanup,
  deletionOrigin,
  getRejectionReferenceDate,
  partitionByOrigin,
} from './content-cleanup.js';

const NOW = new Date('2026-10-03T12:00:00.000Z');

/** An in-memory store whose content query answers by which reaper query asked. */
function memStore({ known = [], unknown = [], blogs = [], versions = [] } = {}) {
  const deleted = [];
  const upserts = [];
  return {
    deleted,
    upserts,
    queryDocs: vi.fn(async (container, query) => {
      if (container === 'content') return query.includes('AND NOT') ? unknown : known;
      if (container === 'blogs') return blogs;
      if (container === 'content_versions') return versions;
      return [];
    }),
    readDoc: vi.fn(async (container, id) =>
      container === 'blogs' && id === 'blog-published' ? { id } : null
    ),
    deleteDoc: vi.fn(async (container, id) => {
      deleted.push(`${container}/${id}`);
    }),
    upsertDoc: vi.fn(async (container, doc) => {
      upserts.push([container, doc]);
      return doc;
    }),
    patchDoc: vi.fn(),
  };
}

describe('deletion origin', () => {
  it('trusts only the admin route and the agers', () => {
    expect(deletionOrigin({ deletionRequestedBy: 'owner' })).toBe('user');
    expect(deletionOrigin({ softDeletedReason: 'rejected_aged_out' })).toBe('policy');
    expect(deletionOrigin({ softDeletedAt: '2026-01-01' })).toBe('unknown');
  });

  it('partitions candidates by origin and keeps every refused id', () => {
    const out = partitionByOrigin(
      [
        { id: 'a', deletionRequestedBy: 'x' },
        { id: 'b', softDeletedReason: 'rejected_aged_out' },
        { id: 'c' },
      ],
      [{ id: 'd' }]
    );
    expect(out.eligible.map((d) => d.id)).toEqual(['a', 'b']);
    expect(out.refusedIds).toEqual(['d', 'c']);
    expect(out).toMatchObject({ userRequestedCount: 1, policyCount: 1 });
  });

  it('dates a rejection from the first stamp it finds', () => {
    expect(getRejectionReferenceDate({ reviewedAt: '2026-01-02T00:00:00Z' })).toEqual(
      new Date('2026-01-02T00:00:00Z')
    );
    expect(getRejectionReferenceDate({})).toBeNull();
  });
});

describe('hardDeleteSoftDeleted', () => {
  const known = [
    { id: 'c1', deletionRequestedBy: 'owner', publishedBlogId: 'blog-published' },
    { id: 'c2', softDeletedReason: 'rejected_aged_out' },
  ];

  it('dry-run: counts what it would do, deletes nothing, writes no audit', async () => {
    const store = memStore({ known, unknown: [{ id: 'u1' }] });
    const log = { log: vi.fn(), warn: vi.fn() };
    const cleanup = createContentCleanup({ store, now: () => NOW, log, env: {} });
    const summary = await cleanup.hardDeleteSoftDeleted({ olderThanHours: 24, limit: 200 });
    expect(summary).toMatchObject({
      dryRun: true,
      examinedCount: 3,
      eligibleCount: 2,
      userRequestedCount: 1,
      policyCount: 1,
      refusedCount: 1,
      deletedContentCount: 0,
      hasMore: false,
    });
    expect(store.deleteDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('armed: deletes the document, its blogs and versions, moves the counters, audits once', async () => {
    const store = memStore({
      known,
      unknown: [{ id: 'u1' }],
      blogs: [{ id: 'blog-related' }],
      versions: [{ id: 'v1' }, { id: 'v2' }],
    });
    const onContentDeleted = vi.fn(async () => {});
    const cleanup = createContentCleanup({
      store,
      now: () => NOW,
      uuid: () => 'audit-1',
      log: {},
      env: { CONTENT_HARD_DELETE: 'true' },
      onContentDeleted,
    });
    const summary = await cleanup.hardDeleteSoftDeleted({ olderThanHours: 24 });
    expect(summary).toMatchObject({
      dryRun: false,
      deletedContentCount: 2,
      deletedBlogCount: 3,
      deletedVersionCount: 4,
      refusedCount: 1,
    });
    expect(store.deleted).toEqual([
      'blogs/blog-published',
      'blogs/blog-related',
      'content/c1',
      'content_versions/v1',
      'content_versions/v2',
      'blogs/blog-related',
      'content/c2',
      'content_versions/v1',
      'content_versions/v2',
    ]);
    expect(onContentDeleted.mock.calls.map(([id]) => id)).toEqual(['c1', 'c2']);
    expect(store.upserts).toEqual([
      [
        'admin_audit_logs',
        expect.objectContaining({
          id: 'audit-1',
          action: 'cron_hard_deleted_soft_deleted_content',
          details: expect.objectContaining({
            deletedContentCount: 2,
            refusedIds: ['u1'],
            affectedIds: ['c1', 'c2'],
          }),
        }),
      ],
    ]);
  });

  it('armed with nothing examined: one idle log line and no audit row', async () => {
    const store = memStore();
    const log = { log: vi.fn() };
    const cleanup = createContentCleanup({
      store,
      now: () => NOW,
      log,
      env: { CONTENT_HARD_DELETE: 'true' },
      onContentDeleted: vi.fn(),
    });
    const summary = await cleanup.hardDeleteSoftDeleted();
    expect(summary).toMatchObject({ dryRun: false, examinedCount: 0, deletedContentCount: 0 });
    expect(log.log).toHaveBeenCalledWith(
      '[cleanupSoftDeletedContent] content=0 blogs=0 versions=0 refused=0 examined=0'
    );
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });
});
