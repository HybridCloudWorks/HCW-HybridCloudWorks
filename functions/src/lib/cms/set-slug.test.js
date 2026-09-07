/**
 * cms/content/slug (#400): the route is thin on purpose — the probe, the write
 * and the URL derivation belong to the publish pipeline's SET_SLUG_REASON
 * branch (pinned in publish.test.js), and what is pinned here is the HTTP
 * contract over it: publisher only, a refusal carries the branch's own status
 * and says nothing was written, a skip is a truthful 200, and the audit row
 * records what happened either way.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSetSlugHandlers, toSetSlugResponse } from './set-slug.js';
import { createPublishHandlers, SET_SLUG_REASON } from './publish.js';

const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const USER = { oid: 'u1', email: 'pub@hcw.dev' };
const guardAs = (role) => ({ requireRole: vi.fn(async () => ({ user: USER, role, error: null })) });
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};
const makeRequest = (body) => ({ headers: { get: () => 'vitest' }, json: async () => body ?? {} });
const parse = (res) => ({ status: res.status, body: JSON.parse(res.body) });

/** The article currently serving the contested URL, as the live manifest reads it. */
const COLLIDED = Object.freeze({
  id: '1k5ayjbEdYdo7NzvXIWW',
  _etag: '"etag-1"',
  Title:
    'Enable AI-Powered Discovery of Azure Updates with Microsoft Release Communications MCP Server',
  contentStatus: 'published',
  Live: true,
  publishTarget: 'blog',
  cloudProvider: 'Azure',
  slug: 'enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio',
  Slug: 'in-preview-public-preview-code-first-observability-for-foundry-agents-in-vs-code',
  curatedSubpagePath:
    '/azure/blog/enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio',
});

describe('toSetSlugResponse', () => {
  const meta = { contentId: 'c1', requested: ' Raw Input ' };

  it("carries a refusal's own status and its heldBy list", () => {
    expect(
      parse(toSetSlugResponse({ status: 409, error: 'held', heldBy: ['other'] }, meta))
    ).toEqual({ status: 409, body: { error: 'held', heldBy: ['other'] } });
    expect(parse(toSetSlugResponse({ status: 400, error: 'empty' }, meta)).status).toBe(400);
  });

  it('defaults an error with no status to 500 rather than reporting success', () => {
    expect(parse(toSetSlugResponse({ error: 'store exploded' }, meta)).status).toBe(500);
  });

  it('reports a skip as a truthful 200 with changed:false', () => {
    const { status, body } = parse(
      toSetSlugResponse(
        { skipped: true, reason: 'Already on that slug', slug: 's', expectedPublicUrl: 'U' },
        meta
      )
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ changed: false, reason: 'Already on that slug', publicUrl: 'U' });
  });

  it('reports a success with the previous slug, the new slug and the URL', () => {
    const { body } = parse(
      toSetSlugResponse(
        {
          slugChanged: true,
          previousSlug: 'old',
          slug: 'new',
          curatedSubpagePath: '/azure/blog/new',
          expectedPublicUrl: 'https://hybridcloudworks.com/azure/blog/new',
        },
        meta
      )
    );
    expect(body).toEqual({
      contentId: 'c1',
      requested: ' Raw Input ',
      changed: true,
      previousSlug: 'old',
      slug: 'new',
      curatedSubpagePath: '/azure/blog/new',
      publicUrl: 'https://hybridcloudworks.com/azure/blog/new',
    });
  });
});

/** A store over an in-memory map of content documents. */
function makeStore(docs) {
  const byId = new Map(docs.map((d) => [d.id, { ...d }]));
  const upserts = [];
  return {
    byId,
    upserts,
    queryDocs: vi.fn(async (_container, _query, params) => {
      const slug = params[0].value;
      return [...byId.values()]
        .filter((d) => d.slug === slug || d.Slug === slug)
        .slice(0, 2)
        .map((d) => ({ id: d.id }));
    }),
    readDoc: vi.fn(async (_container, id) => (byId.has(id) ? { ...byId.get(id) } : null)),
    patchDoc: vi.fn(async (_container, id, updates) => {
      byId.set(id, { ...byId.get(id), ...updates });
      return byId.get(id);
    }),
    upsertDoc: vi.fn(async (container, doc) => {
      upserts.push([container, doc]);
      return doc;
    }),
  };
}

/**
 * The route wired to the REAL pipeline over the same fake store, so the
 * end-to-end assertions are about resolveCuratedSubpagePath rather than about
 * a stub that agrees with the test.
 */
function makeHandlers(docs) {
  const store = makeStore(docs);
  const { processPublishContent } = createPublishHandlers({
    guard: guardAs('publisher'),
    store,
    now: () => new Date('2026-09-07T10:00:00.000Z'),
    uuid: () => 'uuid-1',
    log: context,
  });
  const handlers = createSetSlugHandlers({
    guard: guardAs('publisher'),
    store,
    processPublishContent,
    now: () => new Date('2026-09-07T10:00:00.000Z'),
    uuid: () => 'uuid-1',
    log: context,
  });
  return { store, handlers };
}

describe('setContentSlug', () => {
  it('requires the publisher role', async () => {
    const denied = createSetSlugHandlers({
      guard: denyGuard,
      store: makeStore([COLLIDED]),
      processPublishContent: vi.fn(),
    });
    expect(await denied.setContentSlug(makeRequest({}), context)).toEqual({
      status: 403,
      body: '{}',
    });
  });

  it('validates the body before it reaches the pipeline', async () => {
    const processPublishContent = vi.fn();
    const handlers = createSetSlugHandlers({
      guard: guardAs('publisher'),
      store: makeStore([COLLIDED]),
      processPublishContent,
      uuid: () => 'uuid-1',
    });
    expect(parse(await handlers.setContentSlug(makeRequest({ slug: 'x' }), context)).status).toBe(
      400
    );
    expect(
      parse(await handlers.setContentSlug(makeRequest({ contentId: 'a', slug: 7 }), context)).status
    ).toBe(400);
    expect(processPublishContent).not.toHaveBeenCalled();
  });

  it('runs the NARROW republish, not a full one', async () => {
    // A full republish of these articles fails their quality and image gates —
    // see SET_SLUG_REASON. Passing the reason is what keeps this working.
    const processPublishContent = vi.fn(async () => ({ skipped: true, reason: 'x' }));
    const handlers = createSetSlugHandlers({
      guard: guardAs('publisher'),
      store: makeStore([COLLIDED]),
      processPublishContent,
      uuid: () => 'uuid-1',
    });
    await handlers.setContentSlug(makeRequest({ contentId: COLLIDED.id, slug: 's' }), context);
    expect(processPublishContent).toHaveBeenCalledWith(COLLIDED.id, {
      user: USER,
      reason: SET_SLUG_REASON,
      slug: 's',
    });
  });

  it('sets the slug end to end, and the URLs follow', async () => {
    const { handlers, store } = makeHandlers([COLLIDED]);

    const { status, body } = parse(
      await handlers.setContentSlug(
        makeRequest({ contentId: COLLIDED.id, slug: COLLIDED.Slug }),
        context
      )
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      changed: true,
      previousSlug: COLLIDED.slug,
      slug: COLLIDED.Slug,
      curatedSubpagePath: `/azure/blog/${COLLIDED.Slug}`,
      publicUrl: `https://hybridcloudworks.com/azure/blog/${COLLIDED.Slug}`,
    });

    const after = store.byId.get(COLLIDED.id);
    expect(after.slug).toBe(COLLIDED.Slug);
    expect(after.Slug).toBe(COLLIDED.Slug);
    expect(after.curatedSubpagePath).toBe(`/azure/blog/${COLLIDED.Slug}`);
    expect(after.slugPageUrl).toBe(body.publicUrl);
    expect(after.publishedUrl).toBe(body.publicUrl);
    expect(after.publicUrl).toBe(body.publicUrl);
  });

  it('refuses a slug another document holds, names it, and writes nothing', async () => {
    const other = { id: '7MCkl1cSf7GGCgJxlCwZ', Slug: 'wanted-slug', contentStatus: 'published' };
    const { handlers, store } = makeHandlers([COLLIDED, other]);

    const { status, body } = parse(
      await handlers.setContentSlug(
        makeRequest({ contentId: COLLIDED.id, slug: 'Wanted Slug!' }),
        context
      )
    );
    expect(status).toBe(409);
    expect(body.heldBy).toEqual([other.id]);
    expect(body.error).toMatch(/Nothing was changed/);
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.byId.get(COLLIDED.id).slug).toBe(COLLIDED.slug);
  });

  it('refuses when the probe cannot answer, rather than assuming the slug is free', async () => {
    const { handlers, store } = makeHandlers([COLLIDED]);
    store.queryDocs.mockRejectedValueOnce(new Error('Cosmos unavailable'));

    const { status, body } = parse(
      await handlers.setContentSlug(
        makeRequest({ contentId: COLLIDED.id, slug: 'some-new-slug' }),
        context
      )
    );
    expect(status).toBe(503);
    expect(body.error).toMatch(/Nothing was changed/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing document, not 500', async () => {
    // A stale id in the operator's hand is a 404, and a caller has to be able
    // to tell it from a server fault. It answered 500 until the pipeline's
    // not-found carried a status, because toSetSlugResponse's default caught
    // it — the default is for error paths that do not exist yet, not this one.
    const { handlers, store } = makeHandlers([COLLIDED]);
    expect(
      parse(await handlers.setContentSlug(makeRequest({ contentId: 'nope', slug: 'x' }), context))
    ).toEqual({ status: 404, body: { error: 'Content not found' } });
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('answers 409, not 404, for a document that exists but is not published', async () => {
    // Distinct from the case above on purpose: the document is there, and what
    // is wrong is its state, so "not found" would send the operator looking
    // for the wrong problem.
    const staged = { ...COLLIDED, id: 'staged-doc', contentStatus: 'approved' };
    const { handlers, store } = makeHandlers([staged]);

    const refused = parse(
      await handlers.setContentSlug(makeRequest({ contentId: staged.id, slug: 'x' }), context)
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Only a published article/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('every status the branch can answer is one it chose, never the 500 default', async () => {
    // The rule the 500 default depends on: a refusal that forgets its status
    // silently becomes "the server is broken". Enumerated here so adding one
    // without a status fails rather than degrading quietly.
    const other = { id: 'holder', Slug: 'taken-slug', contentStatus: 'published' };
    const { handlers } = makeHandlers([
      COLLIDED,
      other,
      { ...COLLIDED, id: 'staged', contentStatus: 'approved' },
    ]);
    const statusFor = async (body) =>
      parse(await handlers.setContentSlug(makeRequest(body), context)).status;

    expect(await statusFor({ contentId: COLLIDED.id, slug: '  !!!  ' })).toBe(400);
    expect(await statusFor({ contentId: 'nope', slug: 'x' })).toBe(404);
    expect(await statusFor({ contentId: COLLIDED.id, slug: 'taken-slug' })).toBe(409);
    expect(await statusFor({ contentId: 'staged', slug: 'x' })).toBe(409);
  });

  it('answers a no-op truthfully instead of reporting a change', async () => {
    const settled = {
      ...COLLIDED,
      id: 'settled-doc',
      slug: 'settled-slug',
      Slug: 'settled-slug',
      curatedSubpagePath: '/azure/blog/settled-slug',
      slugPageUrl: 'https://hybridcloudworks.com/azure/blog/settled-slug',
      publishedUrl: 'https://hybridcloudworks.com/azure/blog/settled-slug',
      publicUrl: 'https://hybridcloudworks.com/azure/blog/settled-slug',
    };
    const { handlers, store } = makeHandlers([settled]);

    const { status, body } = parse(
      await handlers.setContentSlug(
        makeRequest({ contentId: settled.id, slug: 'Settled Slug' }),
        context
      )
    );
    expect(status).toBe(200);
    expect(body.changed).toBe(false);
    expect(body.reason).toMatch(/Already on that slug/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('reports what was requested beside what was stored, since normalisation is server-side', async () => {
    const { handlers } = makeHandlers([COLLIDED]);
    const { body } = parse(
      await handlers.setContentSlug(
        makeRequest({ contentId: COLLIDED.id, slug: '  Agent Kit for Azure Cosmos DB!  ' }),
        context
      )
    );
    expect(body.requested).toBe('  Agent Kit for Azure Cosmos DB!  ');
    expect(body.slug).toBe('agent-kit-for-azure-cosmos-db');
  });

  it('audits the outcome, including a refusal, and never fails the request over the row', async () => {
    const { handlers, store } = makeHandlers([COLLIDED]);
    await handlers.setContentSlug(
      makeRequest({ contentId: COLLIDED.id, slug: COLLIDED.Slug }),
      context
    );
    const audit = store.upserts.find(([container]) => container === 'admin_audit_logs');
    expect(audit[1]).toMatchObject({
      action: 'content_slug_set',
      contentId: COLLIDED.id,
      details: { status: 200, previousSlug: COLLIDED.slug, slug: COLLIDED.Slug, changed: true },
    });

    // A refusal is audited too — an operator's failed attempt on a URL is
    // exactly what a later reader of the log wants to see.
    const refused = makeHandlers([
      COLLIDED,
      { id: 'holder', Slug: 'taken-slug', contentStatus: 'published' },
    ]);
    await refused.handlers.setContentSlug(
      makeRequest({ contentId: COLLIDED.id, slug: 'taken-slug' }),
      context
    );
    const refusedRow = refused.store.upserts.find(
      ([container]) => container === 'admin_audit_logs'
    );
    expect(refusedRow[1].details).toMatchObject({ status: 409, changed: false });
    expect(refusedRow[1].details.error).toMatch(/taken-slug/);

    // And a store that cannot take the row does not cost the operator the answer.
    const flaky = makeHandlers([COLLIDED]);
    flaky.store.upsertDoc.mockImplementation(async (container) => {
      if (container === 'admin_audit_logs') throw new Error('audit container unavailable');
      return {};
    });
    expect(
      parse(
        await flaky.handlers.setContentSlug(
          makeRequest({ contentId: COLLIDED.id, slug: COLLIDED.Slug }),
          context
        )
      ).status
    ).toBe(200);
  });
});
