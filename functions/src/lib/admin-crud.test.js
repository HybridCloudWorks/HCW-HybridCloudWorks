/**
 * Admin CRUD (certifications + social posts) — semantics pinned to the pages
 * they replace: CertificationsPage.jsx (partial patchCert toggles, name-only
 * required field, client-side sorting) and SocialHubPage.jsx (status-filtered
 * newest-first list, createdAt stamp on create).
 */
import { describe, it, expect, vi } from 'vitest';
import { createAdminCrudHandlers } from './admin-crud.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = {
  requireRole: vi.fn(async () => ({ user: { oid: 'u1' }, role: 'editor', error: null })),
};
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = ({ query = {}, params = {}, body } = {}) => ({
  query: { get: (k) => query[k] ?? null },
  params,
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

function makeStore(over = {}) {
  return {
    queryDocs: vi.fn(async () => []),
    readDoc: vi.fn(async () => ({ id: 'c1', name: 'AZ-104' })),
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, _id, u) => ({ id: _id, ...u })),
    deleteDoc: vi.fn(async () => {}),
    ...over,
  };
}

const fixed = { now: () => new Date('2026-08-06T12:00:00.000Z'), uuid: () => 'fixed-uuid' };

describe('auth', () => {
  it('every handler passes guard denials through and never touches the store', async () => {
    const store = makeStore();
    const h = createAdminCrudHandlers({ guard: denyGuard, store, ...fixed });
    const calls = [
      h.listCertifications(makeRequest(), context),
      h.createCertification(makeRequest({ body: { name: 'x' } }), context),
      h.patchCertification(makeRequest({ params: { id: 'c1' }, body: { featured: true } }), context),
      h.deleteCertification(makeRequest({ params: { id: 'c1' } }), context),
      h.listSocialPosts(makeRequest(), context),
      h.createSocialPost(makeRequest({ body: { text: 'x' } }), context),
      h.deleteSocialPost(makeRequest({ params: { id: 's1' } }), context),
    ];
    for (const call of calls) expect((await call).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.deleteDoc).not.toHaveBeenCalled();
  });
});

describe('certifications', () => {
  it('create requires a name and stamps id + timestamps', async () => {
    const store = makeStore();
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });

    expect((await h.createCertification(makeRequest({ body: { issuer: 'MS' } }), context)).status).toBe(400);

    const res = await h.createCertification(
      makeRequest({ body: { name: 'AZ-104', id: 'client-chosen' } }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body.id).toBe('fixed-uuid'); // client id never becomes the key
    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc._createdAt).toBe('2026-08-06T12:00:00.000Z');
    expect(doc._updatedAt).toBe('2026-08-06T12:00:00.000Z');
  });

  it('patch is partial — a single-field toggle patches, never replaces', async () => {
    const store = makeStore();
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.patchCertification(
      makeRequest({ params: { id: 'c1' }, body: { featured: true } }),
      context
    );
    expect(res.status).toBe(200);
    expect(store.upsertDoc).not.toHaveBeenCalled(); // the load-bearing assertion
    const [container, id, updates] = store.patchDoc.mock.calls[0];
    expect(container).toBe('certifications');
    expect(id).toBe('c1');
    expect(updates).toEqual({ featured: true, _updatedAt: '2026-08-06T12:00:00.000Z' });
  });

  it('patch 404s a missing doc and strips a client-sent id from updates', async () => {
    const h404 = createAdminCrudHandlers({
      guard: allowGuard,
      store: makeStore({ readDoc: vi.fn(async () => null) }),
      ...fixed,
    });
    expect(
      (await h404.patchCertification(makeRequest({ params: { id: 'x' }, body: { a: 1 } }), context)).status
    ).toBe(404);

    const store = makeStore();
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });
    await h.patchCertification(
      makeRequest({ params: { id: 'c1' }, body: { id: 'evil', name: 'N' } }),
      context
    );
    expect(store.patchDoc.mock.calls[0][2]).not.toHaveProperty('id');
  });

  it('list and delete round-trip through the store', async () => {
    const store = makeStore({ queryDocs: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]) });
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.listCertifications(makeRequest(), context);
    expect(JSON.parse(res.body).total).toBe(2);

    await h.deleteCertification(makeRequest({ params: { id: 'a' } }), context);
    expect(store.deleteDoc).toHaveBeenCalledWith('certifications', 'a');
  });
});

describe('social posts', () => {
  it('lists with the page default statuses, newest first, parameterized', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [
        { id: 'old', status: 'published', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'new', status: 'scheduled', createdAt: '2026-06-01T00:00:00Z' },
      ]),
    });
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.listSocialPosts(makeRequest(), context);
    expect(JSON.parse(res.body).items.map((i) => i.id)).toEqual(['new', 'old']);

    const [container, query, params] = store.queryDocs.mock.calls[0];
    expect(container).toBe('social_posts');
    expect(query).toContain('ARRAY_CONTAINS(@statuses, c.status)');
    expect(params[0].value).toEqual(['scheduled', 'published']);
  });

  it('honors an explicit status filter and the limit clamp', async () => {
    const store = makeStore();
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });
    await h.listSocialPosts(makeRequest({ query: { status: 'draft,failed', limit: '5000' } }), context);
    expect(store.queryDocs.mock.calls[0][2][0].value).toEqual(['draft', 'failed']);
  });

  it('status=all lists without a status clause (CalendarPage)', async () => {
    const store = makeStore();
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });
    await h.listSocialPosts(makeRequest({ query: { status: 'all' } }), context);
    const [, query, params] = store.queryDocs.mock.calls[0];
    expect(query).not.toContain('WHERE');
    expect(params).toEqual([]);
  });

  it('create stamps createdAt and a fresh id; delete targets the container', async () => {
    const store = makeStore();
    const h = createAdminCrudHandlers({ guard: allowGuard, store, ...fixed });
    await h.createSocialPost(makeRequest({ body: { text: 'Post', status: 'scheduled' } }), context);
    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc.id).toBe('fixed-uuid');
    expect(doc.createdAt).toBe('2026-08-06T12:00:00.000Z');

    await h.deleteSocialPost(makeRequest({ params: { id: 's1' } }), context);
    expect(store.deleteDoc).toHaveBeenCalledWith('social_posts', 's1');
  });

  it('rejects malformed bodies', async () => {
    const h = createAdminCrudHandlers({ guard: allowGuard, store: makeStore(), ...fixed });
    expect((await h.createSocialPost(makeRequest({ body: [1, 2] }), context)).status).toBe(400);
    expect((await h.createSocialPost(makeRequest(), context)).status).toBe(400);
  });
});
