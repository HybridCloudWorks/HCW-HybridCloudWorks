import { describe, it, expect, vi } from 'vitest';
import {
  createCmsContentHandlers,
  ADMIN_CONTENT_SNAPSHOT_FIELDS,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
} from './cms-content.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = { requireRole: vi.fn(async () => ({ user: { oid: 'u1' }, role: 'editor', error: null })) };
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{"ok":false}' } })),
};

const makeRequest = ({ method = 'GET', query = {}, params = {}, body } = {}) => ({
  method,
  query: { get: (k) => query[k] ?? null },
  params,
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

function makeStore(over = {}) {
  return {
    queryDocs: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]),
    readDoc: vi.fn(async () => ({ id: 'a', Title: 'T' })),
    upsertDoc: vi.fn(async (_c, d) => d),
    deleteDoc: vi.fn(async () => {}),
    ...over,
  };
}

describe('cms content list', () => {
  it('passes guard denials through untouched on every handler', async () => {
    const store = makeStore();
    const h = createCmsContentHandlers({ guard: denyGuard, store });
    for (const call of [
      h.list(makeRequest(), context),
      h.get(makeRequest({ query: { contentId: 'a' } }), context),
      h.save(makeRequest({ method: 'POST', body: {} }), context),
      h.remove(makeRequest({ method: 'DELETE', params: { id: 'a' } }), context),
    ]) {
      expect((await call).status).toBe(403);
    }
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('projects the admin snapshot fields, never SELECT *', async () => {
    const store = makeStore();
    const h = createCmsContentHandlers({ guard: allowGuard, store });
    await h.list(makeRequest(), context);
    const [container, query] = store.queryDocs.mock.calls[0];
    expect(container).toBe('content');
    expect(query).not.toContain('SELECT *');
    expect(query).toContain('c.id');
    // spot-check the awkward real field names survive quoting
    for (const f of ['CD Url', 'Cover Image', 'Published At', 'contentStatus']) {
      expect(query).toContain(`c["${f}"]`);
    }
  });

  it('defaults the limit and clamps it at the source maximum', async () => {
    const store = makeStore();
    const h = createCmsContentHandlers({ guard: allowGuard, store });

    await h.list(makeRequest(), context);
    expect(store.queryDocs.mock.calls[0][2]).toContainEqual({ name: '@limit', value: LIST_DEFAULT_LIMIT });

    await h.list(makeRequest({ query: { limit: '5000' } }), context);
    expect(store.queryDocs.mock.calls[1][2]).toContainEqual({ name: '@limit', value: LIST_MAX_LIMIT });
  });

  it('filters by contentStatus only when asked, via parameter not interpolation', async () => {
    const store = makeStore();
    const h = createCmsContentHandlers({ guard: allowGuard, store });

    await h.list(makeRequest(), context);
    expect(store.queryDocs.mock.calls[0][1]).not.toContain('WHERE');

    await h.list(makeRequest({ query: { status: "x' OR 1=1" } }), context);
    const [, query, params] = store.queryDocs.mock.calls[1];
    expect(query).toContain('c.contentStatus = @status');
    expect(query).not.toContain('OR 1=1');
    expect(params).toContainEqual({ name: '@status', value: "x' OR 1=1" });
  });
});

describe('cms content get', () => {
  it('reads contentId from GET query and from POST body, like the source', async () => {
    const store = makeStore();
    const h = createCmsContentHandlers({ guard: allowGuard, store });

    await h.get(makeRequest({ query: { contentId: 'q1' } }), context);
    expect(store.readDoc).toHaveBeenCalledWith('content', 'q1', 'q1');

    await h.get(makeRequest({ method: 'POST', body: { contentId: 'b1' } }), context);
    expect(store.readDoc).toHaveBeenCalledWith('content', 'b1', 'b1');
  });

  it('400s without contentId and 404s when absent', async () => {
    const h = createCmsContentHandlers({ guard: allowGuard, store: makeStore({ readDoc: async () => null }) });
    expect((await h.get(makeRequest(), context)).status).toBe(400);
    const res = await h.get(makeRequest({ query: { contentId: 'missing' } }), context);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toContain('missing');
  });
});

describe('cms content save/remove', () => {
  it('rejects a non-object save body', async () => {
    const h = createCmsContentHandlers({ guard: allowGuard, store: makeStore() });
    expect((await h.save(makeRequest({ method: 'POST' }), context)).status).toBe(400);
  });

  it('saves and deletes through the store', async () => {
    const store = makeStore();
    const h = createCmsContentHandlers({ guard: allowGuard, store });
    const saved = await h.save(makeRequest({ method: 'POST', body: { id: 'n1', Title: 'X' } }), context);
    expect(saved.status).toBe(200);
    expect(store.upsertDoc).toHaveBeenCalledWith('content', { id: 'n1', Title: 'X' });

    const removed = await h.remove(makeRequest({ method: 'DELETE', params: { id: 'n1' } }), context);
    expect(removed.status).toBe(200);
    expect(store.deleteDoc).toHaveBeenCalledWith('content', 'n1');
  });
});

describe('field list provenance', () => {
  it('carries all the awkward names that different ingestion paths wrote', () => {
    for (const f of ['CD Url', 'Created At', 'Published At', 'Cover Image', 'Title', 'title']) {
      expect(ADMIN_CONTENT_SNAPSHOT_FIELDS).toContain(f);
    }
  });
});
