/**
 * Listen & Learn admin reads and the approval decision.
 *
 * The load-bearing assertions: every route is editor-gated, the review view
 * shows what the public read hides, and a reviewer cannot set `failed` — that
 * status belongs to the generator, and letting a reviewer write it would hide
 * a working episode from the site with no record of why.
 */
import { describe, it, expect, vi } from 'vitest';
import { createListenAndLearnHandlers } from './handlers.js';
import { EPISODE_CONTAINER, SET_CONTAINER, STATUS } from './publish.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = {
  requireRole: vi.fn(async () => ({ user: { oid: 'oid-1' }, role: 'editor', error: null })),
};
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = ({ params = {}, query = {}, body } = {}) => ({
  params,
  query: { get: (k) => query[k] ?? null },
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

const makeStore = (over = {}) => ({
  queryDocs: vi.fn(async () => []),
  readDoc: vi.fn(async () => null),
  patchDoc: vi.fn(async (_c, id, updates) => ({ id, ...updates })),
  ...over,
});

const handlers = (store, guard = allowGuard) =>
  createListenAndLearnHandlers({
    guard,
    store,
    now: () => new Date('2026-08-24T12:00:00.000Z'),
  });

describe('auth', () => {
  it('every handler passes a guard denial through with zero store reads', async () => {
    const store = makeStore();
    const h = handlers(store, denyGuard);

    const responses = await Promise.all([
      h.listSets(makeRequest(), context),
      h.getSet(makeRequest({ params: { platform: 'azure', examCode: 'AZ-104' } }), context),
      h.reviewEpisode(makeRequest({ body: { status: 'published' } }), context),
    ]);

    expect(responses.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
  });
});

describe('listSets', () => {
  it('returns sets newest generation first', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [
        { id: 'azure_az-104', generatedAt: '2026-01-01T00:00:00Z' },
        { id: 'aws_saa-c03', generatedAt: '2026-06-01T00:00:00Z' },
      ]),
    });

    const body = JSON.parse((await handlers(store).listSets(makeRequest(), context)).body);
    expect(body.items.map((s) => s.id)).toEqual(['aws_saa-c03', 'azure_az-104']);
    expect(body.total).toBe(2);
  });

  it('bounds the query rather than reading the whole container', async () => {
    const store = makeStore();
    await handlers(store).listSets(makeRequest(), context);
    expect(store.queryDocs.mock.calls[0][1]).toMatch(/SELECT TOP \d+ \* FROM c/);
  });

  it('does not fall over on a set with no generatedAt', async () => {
    const store = makeStore({ queryDocs: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]) });
    const res = await handlers(store).listSets(makeRequest(), context);
    expect(res.status).toBe(200);
  });
});

describe('getSet', () => {
  const episodes = [
    { id: 'b', order: 1, status: STATUS.draft },
    { id: 'a', order: 0, status: STATUS.published },
    { id: 'c', order: 2, status: STATUS.failed, error: 'model refused' },
  ];

  it('returns the set with every episode in study-guide order', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'azure_az-104', examCode: 'AZ-104' })),
      queryDocs: vi.fn(async () => episodes),
    });

    const res = await handlers(store).getSet(
      makeRequest({ params: { platform: 'azure', examCode: 'AZ-104' } }),
      context
    );
    const body = JSON.parse(res.body);

    expect(body.episodes.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('shows drafts and failures, which is what the public read hides', async () => {
    // This is the review view. Hiding unapproved episodes here would leave
    // nothing to approve.
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'azure_az-104' })),
      queryDocs: vi.fn(async () => episodes),
    });

    const body = JSON.parse(
      (
        await handlers(store).getSet(
          makeRequest({ params: { platform: 'azure', examCode: 'AZ-104' } }),
          context
        )
      ).body
    );

    expect(body.episodes.map((e) => e.status)).toEqual([
      STATUS.published,
      STATUS.draft,
      STATUS.failed,
    ]);
    expect(body.episodes.find((e) => e.status === STATUS.failed).error).toBe('model refused');
  });

  it('queries episodes by their set partition', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'x' })) });
    await handlers(store).getSet(
      makeRequest({ params: { platform: 'AZURE', examCode: 'AZ-104' } }),
      context
    );

    const [container, query, params] = store.queryDocs.mock.calls[0];
    expect(container).toBe(EPISODE_CONTAINER);
    expect(query).toContain('c.setId = @setId');
    expect(params).toEqual([{ name: '@setId', value: 'azure_az-104' }]);
    expect(store.readDoc).toHaveBeenCalledWith(SET_CONTAINER, 'azure_az-104', 'azure_az-104');
  });

  it('404s a certification that has never been generated', async () => {
    const res = await handlers(makeStore()).getSet(
      makeRequest({ params: { platform: 'azure', examCode: 'AZ-900' } }),
      context
    );
    expect(res.status).toBe(404);
  });

  it('still serves episodes when the parent set document is missing', async () => {
    // A run that timed out after the first episode but before the set write
    // would otherwise strand real episodes behind a 404.
    const store = makeStore({ queryDocs: vi.fn(async () => [{ id: 'a', order: 0 }]) });
    const res = await handlers(store).getSet(
      makeRequest({ params: { platform: 'azure', examCode: 'AZ-104' } }),
      context
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).set).toBeNull();
    expect(JSON.parse(res.body).episodes).toHaveLength(1);
  });

  it('400s a missing platform or exam code', async () => {
    const h = handlers(makeStore());
    expect((await h.getSet(makeRequest({ params: { platform: 'azure' } }), context)).status).toBe(
      400
    );
    expect((await h.getSet(makeRequest({ params: { examCode: 'AZ-104' } }), context)).status).toBe(
      400
    );
  });
});

describe('reviewEpisode', () => {
  const review = (body) =>
    handlers(makeStore()).reviewEpisode(makeRequest({ body }), context);

  it('publishes an episode and stamps the approver', async () => {
    const store = makeStore();
    const res = await handlers(store).reviewEpisode(
      makeRequest({
        body: { platform: 'azure', examCode: 'AZ-104', areaSlug: 'area-1', status: 'published' },
      }),
      context
    );

    expect(res.status).toBe(200);
    const [container, id, updates, options] = store.patchDoc.mock.calls[0];
    expect(container).toBe(EPISODE_CONTAINER);
    expect(id).toBe('area-1');
    expect(updates).toEqual({
      status: 'published',
      approvedAt: '2026-08-24T12:00:00.000Z',
      approvedBy: 'oid-1',
    });
    expect(options).toEqual({ partitionKey: 'azure_az-104' });
  });

  it('unpublishes by returning an episode to draft, clearing the stamp', async () => {
    const store = makeStore();
    await handlers(store).reviewEpisode(
      makeRequest({
        body: { platform: 'azure', examCode: 'AZ-104', areaSlug: 'area-1', status: 'draft' },
      }),
      context
    );

    expect(store.patchDoc.mock.calls[0][2]).toEqual({
      status: 'draft',
      approvedAt: null,
      approvedBy: null,
    });
  });

  it('refuses "failed", which belongs to the generator', async () => {
    // A reviewer marking a working episode failed would hide it from the site
    // with no record of why; `draft` is the reviewer's way to withdraw one.
    const store = makeStore();
    const res = await handlers(store).reviewEpisode(
      makeRequest({
        body: { platform: 'azure', examCode: 'AZ-104', areaSlug: 'area-1', status: 'failed' },
      }),
      context
    );

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/status must be "published" or "draft"/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('refuses an unknown status and an incomplete target', async () => {
    expect((await review({ status: 'archived' })).status).toBe(400);
    expect((await review({ status: 'published', examCode: 'AZ-104' })).status).toBe(400);
    expect((await review({ status: 'published', platform: 'azure' })).status).toBe(400);
    expect(
      (await review({ status: 'published', platform: 'azure', examCode: 'AZ-104' })).status
    ).toBe(400);
  });

  it('400s a body that is not a JSON object', async () => {
    const res = await handlers(makeStore()).reviewEpisode(makeRequest(), context);
    expect(res.status).toBe(400);
  });

  it('500s a store failure rather than reporting a change that did not happen', async () => {
    const store = makeStore({
      patchDoc: vi.fn(async () => {
        throw new Error('cosmos down');
      }),
    });
    const res = await handlers(store).reviewEpisode(
      makeRequest({
        body: { platform: 'azure', examCode: 'AZ-104', areaSlug: 'area-1', status: 'published' },
      }),
      context
    );

    expect(res.status).toBe(500);
    expect(res.body).not.toContain('cosmos down'); // no internals to the browser
  });
});
