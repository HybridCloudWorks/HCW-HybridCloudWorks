/**
 * updateContentItem / transitionContentStatus handlers — behavior pinned to
 * Site-Main cms-functions.js :3564 and :6813, adapted per the module header
 * (patchDoc partial writes, sequential version/audit writes, publisher gate
 * from the guard's resolved role).
 */
import { describe, it, expect, vi } from 'vitest';
import { createContentUpdateHandler, createContentTransitionHandler } from './content-update.js';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

const guardAs = (role) => ({
  requireRole: vi.fn(async () => ({
    user: { oid: 'oid-1', preferred_username: 'editor@hcw.dev', email: null },
    role,
    error: null,
  })),
});
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = (body) => ({
  method: 'POST',
  headers: { get: (k) => (k === 'user-agent' ? 'vitest' : null) },
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

function makeStore(over = {}) {
  return {
    readDoc: vi.fn(async () => ({ id: 'c1', Title: 'Existing', contentStatus: 'inspected' })),
    patchDoc: vi.fn(async () => ({})),
    upsertDoc: vi.fn(async (_c, d) => d),
    queryDocs: vi.fn(async () => []),
    ...over,
  };
}

const fixed = { now: () => new Date('2026-08-06T12:00:00.000Z'), uuid: () => 'fixed-uuid' };

describe('updateContentItem', () => {
  it('passes guard denials through untouched', async () => {
    const store = makeStore();
    const h = createContentUpdateHandler({ guard: denyGuard, store, ...fixed });
    expect((await h(makeRequest({ contentId: 'c1', updates: { Title: 'x' } }), context)).status).toBe(403);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('400s without contentId/updates and on protected fields', async () => {
    const store = makeStore();
    const h = createContentUpdateHandler({ guard: guardAs('editor'), store, ...fixed });
    expect((await h(makeRequest({}), context)).status).toBe(400);
    const res = await h(makeRequest({ contentId: 'c1', updates: { contentStatus: 'published' } }), context);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/protected field: contentStatus/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('404s when the document does not exist', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => null) });
    const h = createContentUpdateHandler({ guard: guardAs('editor'), store, ...fixed });
    const res = await h(makeRequest({ contentId: 'nope', updates: { Title: 'x' } }), context);
    expect(res.status).toBe(404);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('patches the content doc, then writes a version and an audit row', async () => {
    const store = makeStore();
    const h = createContentUpdateHandler({ guard: guardAs('editor'), store, ...fixed });
    const res = await h(
      makeRequest({ contentId: 'c1', updates: { Title: 'New Title', blogDraft: 'Draft body' } }),
      context
    );
    expect(JSON.parse(res.body)).toEqual({ success: true, contentId: 'c1' });

    const [container, id, patch] = store.patchDoc.mock.calls[0];
    expect(container).toBe('content');
    expect(id).toBe('c1');
    expect(patch.Title).toBe('New Title');
    expect(patch.title).toBe('New Title'); // dual-cased by validation
    expect(patch.updatedAt).toBe('2026-08-06T12:00:00.000Z');
    expect(patch.updatedBy).toBe('editor@hcw.dev');

    const versionCall = store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions');
    expect(versionCall[1]).toMatchObject({
      id: 'fixed-uuid',
      contentId: 'c1', // the partition key — every version scoped to its parent
      title: 'New Title',
      draft: 'Draft body',
      versionReason: 'review_updated',
      versionCreatedAt: '2026-08-06T12:00:00.000Z',
    });

    const auditCall = store.upsertDoc.mock.calls.find(([c]) => c === 'admin_audit_logs');
    expect(auditCall[1]).toMatchObject({
      action: 'content_item_updated',
      contentId: 'c1',
      contentTitle: 'Existing',
      userId: 'oid-1',
    });
    expect(auditCall[1].details.updatedFields).toContain('Title');
  });

  it('writes content BEFORE the version snapshot — the accepted sequential contract', async () => {
    // Owner decision 2026-08-18 (option (a), Site-Main TODO §2): no
    // cross-container batch exists, so the writes are sequential and the
    // ordering IS the durability contract — a crash between them loses one
    // snapshot, while the reverse order could record history for an edit
    // that never happened. See the migration manifest's EXCEPTION ONE notes.
    const store = makeStore();
    const h = createContentUpdateHandler({ guard: guardAs('editor'), store, ...fixed });
    await h(makeRequest({ contentId: 'c1', updates: { Title: 'T' } }), context);

    const patchOrder = store.patchDoc.mock.invocationCallOrder[0];
    const versionIdx = store.upsertDoc.mock.calls.findIndex(([c]) => c === 'content_versions');
    const versionOrder = store.upsertDoc.mock.invocationCallOrder[versionIdx];
    expect(patchOrder).toBeLessThan(versionOrder);
  });

  it('version doc falls back to current data for fields not in the update', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', Title: 'Old', summary: 'Old summary', blogDraft: 'Old draft' })),
    });
    const h = createContentUpdateHandler({ guard: guardAs('editor'), store, ...fixed });
    await h(makeRequest({ contentId: 'c1', updates: { category: 'Migration' } }), context);
    const versionDoc = store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions')[1];
    expect(versionDoc.title).toBe('Old');
    expect(versionDoc.summary).toBe('Old summary');
    expect(versionDoc.draft).toBe('Old draft');
  });
});

describe('transitionContentStatus', () => {
  it('reserves the live transition for publishers — editors get 403', async () => {
    const store = makeStore();
    const h = createContentTransitionHandler({ guard: guardAs('editor'), store, ...fixed });
    const res = await h(makeRequest({ contentId: 'c1', newStatus: 'published' }), context);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/publisher access required/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('lets a publisher publish from an eligible status, stamping Live and publishedAt', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', contentStatus: 'forge_ready', type: 'blog' })),
    });
    const h = createContentTransitionHandler({ guard: guardAs('publisher'), store, ...fixed });
    const res = await h(makeRequest({ contentId: 'c1', newStatus: 'published' }), context);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      contentId: 'c1',
      legacyBlogId: null,
      collectionName: 'content',
      from: 'forge_ready',
      to: 'published',
    });
    const patch = store.patchDoc.mock.calls[0][2];
    expect(patch.contentStatus).toBe('published');
    expect(patch.Live).toBe(true);
    expect(patch.publishedAt).toBe('2026-08-06T12:00:00.000Z');
  });

  it('400s an illegal transition with the allowed list', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', contentStatus: 'archived' })),
    });
    const h = createContentTransitionHandler({ guard: guardAs('publisher'), store, ...fixed });
    const res = await h(makeRequest({ contentId: 'c1', newStatus: 'published' }), context);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Invalid transition: archived → published/);
    expect(body.allowedTransitions).toEqual(['in_review', 'rejected']);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('normalizes legacy statuses on both sides of the transition', async () => {
    const store = makeStore({
      // Stored current status is a news-era value; normalizes to published.
      readDoc: vi.fn(async () => ({ id: 'c1', contentStatus: 'published_news' })),
    });
    const h = createContentTransitionHandler({ guard: guardAs('editor'), store, ...fixed });
    const res = await h(makeRequest({ contentId: 'c1', newStatus: 'archived' }), context);
    const body = JSON.parse(res.body);
    expect(body.from).toBe('published');
    expect(body.to).toBe('archived');
    const patch = store.patchDoc.mock.calls[0][2];
    expect(patch.archivedAt).toBe('2026-08-06T12:00:00.000Z');
  });

  it('resolves legacy blogId callers through the publishedBlogId query', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [{ id: 'resolved-1' }]),
      readDoc: vi.fn(async () => ({ id: 'resolved-1', contentStatus: 'inspected' })),
    });
    const h = createContentTransitionHandler({ guard: guardAs('editor'), store, ...fixed });
    const res = await h(makeRequest({ blogId: 'blog-9', newStatus: 'in_review' }), context);
    const body = JSON.parse(res.body);
    expect(body.contentId).toBe('resolved-1');
    expect(body.legacyBlogId).toBe('blog-9');
    const [, query, params] = store.queryDocs.mock.calls[0];
    expect(query).toContain('c.publishedBlogId = @blogId');
    expect(params).toEqual([{ name: '@blogId', value: 'blog-9' }]);
  });

  it('404s an unknown blogId and an unknown contentId', async () => {
    const h1 = createContentTransitionHandler({ guard: guardAs('editor'), store: makeStore(), ...fixed });
    expect((await h1(makeRequest({ blogId: 'nope', newStatus: 'in_review' }), context)).status).toBe(404);

    const h2 = createContentTransitionHandler({
      guard: guardAs('editor'),
      store: makeStore({ readDoc: vi.fn(async () => null) }),
      ...fixed,
    });
    expect((await h2(makeRequest({ contentId: 'nope', newStatus: 'in_review' }), context)).status).toBe(404);
  });

  it('restore from rejected clears the rejection marker with an explicit null', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', contentStatus: 'rejected', rejectedAt: '2026-01-01' })),
    });
    const h = createContentTransitionHandler({ guard: guardAs('editor'), store, ...fixed });
    await h(makeRequest({ contentId: 'c1', newStatus: 'inspected' }), context);
    const patch = store.patchDoc.mock.calls[0][2];
    expect(patch.rejectedAt).toBeNull();
  });

  it('writes the audit row to the audits container with the transition diff', async () => {
    const store = makeStore();
    const h = createContentTransitionHandler({ guard: guardAs('editor'), store, ...fixed });
    await h(makeRequest({ contentId: 'c1', newStatus: 'in_review', reviewNotes: 'looks ok' }), context);
    const auditCall = store.upsertDoc.mock.calls.find(([c]) => c === 'audits');
    expect(auditCall[1]).toMatchObject({
      id: 'fixed-uuid',
      action: 'status_transition',
      resourceId: 'c1',
      changes: {
        before: { contentStatus: 'inspected' },
        after: { contentStatus: 'in_review' },
        notes: 'looks ok',
      },
      metadata: { authMethod: 'entra_bearer_token' },
    });
  });

  it('400s malformed requests before touching the store', async () => {
    const store = makeStore();
    const h = createContentTransitionHandler({ guard: guardAs('editor'), store, ...fixed });
    expect((await h(makeRequest({ newStatus: 'approved' }), context)).status).toBe(400);
    expect((await h(makeRequest({ contentId: 'c1', newStatus: 'bogus' }), context)).status).toBe(400);
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
  });
});
