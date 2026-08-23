/**
 * Admin integrations — semantics pinned to the browser call sites they
 * replace (RecordingsPage, SpeakingEventsPage, adminSettings.js,
 * imageGallery.js, aiEngine.js). The load-bearing assertions: oauthToken
 * never leaves the server on any mcp_servers read, settings saves merge
 * rather than replace, and the config collection segment is allowlisted.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAdminIntegrationHandlers } from './admin-integrations.js';

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
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    deleteDoc: vi.fn(async () => {}),
    ...over,
  };
}

const fixed = { now: () => new Date('2026-08-06T12:00:00.000Z'), uuid: () => 'fixed-uuid' };

describe('auth', () => {
  it('all handlers pass guard denials through with zero store calls', async () => {
    const store = makeStore();
    const h = createAdminIntegrationHandlers({ guard: denyGuard, store, ...fixed });
    const calls = [
      h.listRecordings(makeRequest(), context),
      h.createRecording(makeRequest({ body: { title: 't', transcript: 'x' } }), context),
      h.patchRecording(makeRequest({ params: { id: 'r1' }, body: { status: 'routed' } }), context),
      h.listSpeakerEvents(makeRequest(), context),
      h.getSettings(makeRequest(), context),
      h.putSettings(makeRequest({ body: { a: 1 } }), context),
      h.listImages(makeRequest(), context),
      h.listConfig(makeRequest({ params: { collection: 'ai-providers' } }), context),
      h.putConfig(makeRequest({ params: { collection: 'ai-providers', id: 'v' }, body: {} }), context),
      h.patchConfig(makeRequest({ params: { collection: 'mcp-servers', id: 'v' }, body: { a: 1 } }), context),
      h.deleteConfig(makeRequest({ params: { collection: 'mcp-servers', id: 'v' } }), context),
      h.listUsage(makeRequest(), context),
    ];
    for (const call of calls) expect((await call).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.deleteDoc).not.toHaveBeenCalled();
  });
});

describe('recordings', () => {
  it('create requires title and transcript, stamps id/createdAt/status', async () => {
    const store = makeStore();
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });

    expect((await h.createRecording(makeRequest({ body: { title: 'T' } }), context)).status).toBe(400);

    await h.createRecording(makeRequest({ body: { title: 'T', transcript: 'Tx' } }), context);
    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc).toMatchObject({
      id: 'fixed-uuid',
      status: 'new',
      createdAt: '2026-08-06T12:00:00.000Z',
    });
  });

  it('lists newest first and patch is partial with a 404 on missing', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [
        { id: 'old', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'new', createdAt: '2026-05-01T00:00:00Z' },
      ]),
      readDoc: vi.fn(async () => ({ id: 'r1', status: 'new' })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.listRecordings(makeRequest(), context);
    expect(JSON.parse(res.body).items.map((i) => i.id)).toEqual(['new', 'old']);

    await h.patchRecording(
      makeRequest({ params: { id: 'r1' }, body: { status: 'routed', contentId: 'c9' } }),
      context
    );
    expect(store.patchDoc).toHaveBeenCalledWith('recordings', 'r1', {
      status: 'routed',
      contentId: 'c9',
    });

    const h404 = createAdminIntegrationHandlers({ guard: allowGuard, store: makeStore(), ...fixed });
    expect(
      (await h404.patchRecording(makeRequest({ params: { id: 'x' }, body: { a: 1 } }), context)).status
    ).toBe(404);
  });
});

describe('settings', () => {
  it('GET returns {} when the doc is missing', async () => {
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store: makeStore(), ...fixed });
    const res = await h.getSettings(makeRequest(), context);
    expect(JSON.parse(res.body).settings).toEqual({});
  });

  it('PUT merges into an existing doc (patch, never replace)', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'integrations', sessionizeSpeakerId: 'abc', other: 'kept' })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.putSettings(makeRequest({ body: { sessionizeSpeakerId: 'xyz' } }), context);
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).toHaveBeenCalledWith('admin_settings', 'integrations', {
      sessionizeSpeakerId: 'xyz',
      updatedAt: '2026-08-06T12:00:00.000Z',
    });
  });

  it('PUT creates the doc when absent', async () => {
    const store = makeStore();
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.putSettings(makeRequest({ body: { sessionizeSpeakerId: 'xyz' } }), context);
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc.mock.calls[0][1]).toMatchObject({
      id: 'integrations',
      sessionizeSpeakerId: 'xyz',
    });
  });
});

describe('images', () => {
  it('returns both galleries newest first', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async (container) => [
        { id: `${container}-old`, createdAt: '2026-01-01T00:00:00Z' },
        { id: `${container}-new`, createdAt: '2026-04-01T00:00:00Z' },
      ]),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.listImages(makeRequest(), context);
    const body = JSON.parse(res.body);
    expect(body.curated[0].id).toBe('curated_article_images-new');
    expect(body.generated[0].id).toBe('generated_content_images-new');
  });

  it('single curated lookup answers 200 with item:null when missing', async () => {
    const store = makeStore({
      readDoc: vi.fn(async (_c, id) => (id === 'hit' ? { id: 'hit', imageUrl: 'u' } : null)),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });

    const hit = await h.getCuratedImage(makeRequest({ params: { id: 'hit' } }), context);
    expect(JSON.parse(hit.body).item.imageUrl).toBe('u');
    expect(store.readDoc.mock.calls[0][0]).toBe('curated_article_images');

    const miss = await h.getCuratedImage(makeRequest({ params: { id: 'miss' } }), context);
    expect(miss.status).toBe(200);
    expect(JSON.parse(miss.body).item).toBeNull();
  });
});

describe('config collections (ai-providers / mcp-servers)', () => {
  it('404s any collection outside the allowlist before touching Cosmos', async () => {
    const store = makeStore();
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.listConfig(makeRequest({ params: { collection: 'admins' } }), context);
    expect(res.status).toBe(404);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });

  it('lists sorted by order and NEVER returns oauthToken for mcp-servers', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [
        { id: 'b', order: 2, oauthToken: 'SECRET' },
        { id: 'a', order: 1, oauthToken: 'SECRET2' },
      ]),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.listConfig(makeRequest({ params: { collection: 'mcp-servers' } }), context);
    const body = JSON.parse(res.body);
    expect(body.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(res.body).not.toContain('SECRET');
    // Presence indicator instead of the value — RecordingsPage renders
    // connection state from it.
    expect(body.items.every((i) => i.hasOauthToken === true)).toBe(true);
  });

  it('PUT upserts at the client-chosen route id, preserving createdAt', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'vertex', createdAt: '2025-01-01T00:00:00Z' })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.putConfig(
      makeRequest({ params: { collection: 'ai-providers', id: 'vertex' }, body: { enabled: true } }),
      context
    );
    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc.id).toBe('vertex');
    expect(doc.createdAt).toBe('2025-01-01T00:00:00Z'); // kept from the existing doc
    expect(doc.updatedAt).toBe('2026-08-06T12:00:00.000Z');
  });

  it('PUT carries a stored oauthToken through a read-modify-write round trip', async () => {
    // putConfig is a full replace and reads never return oauthToken, so an
    // edit form that reads then writes would silently delete the token
    // (TODO.md T-314).
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'plaud', oauthToken: 'stored-tok', createdAt: 'x' })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.putConfig(
      makeRequest({
        params: { collection: 'mcp-servers', id: 'plaud' },
        body: { enabled: true, hasOauthToken: true },
      }),
      context
    );

    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc.oauthToken).toBe('stored-tok');
    // The read-side boolean must not persist into the document, where it would
    // shadow the real value on the next read.
    expect(doc).not.toHaveProperty('hasOauthToken');
  });

  it('PUT lets an explicit oauthToken overwrite the stored one', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'plaud', oauthToken: 'old-tok' })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.putConfig(
      makeRequest({
        params: { collection: 'mcp-servers', id: 'plaud' },
        body: { oauthToken: 'new-tok' },
      }),
      context
    );
    expect(store.upsertDoc.mock.calls[0][1].oauthToken).toBe('new-tok');
  });

  it('PUT lets an explicit empty oauthToken revoke it', async () => {
    // Clearing must stay possible — carrying forward unconditionally would
    // make a token impossible to remove through this route.
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'plaud', oauthToken: 'old-tok' })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.putConfig(
      makeRequest({ params: { collection: 'mcp-servers', id: 'plaud' }, body: { oauthToken: '' } }),
      context
    );
    expect(store.upsertDoc.mock.calls[0][1].oauthToken).toBe('');
  });

  it('PUT does not invent an oauthToken for a non-mcp collection', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'vertex', oauthToken: 'should-not-carry' })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.putConfig(
      makeRequest({ params: { collection: 'ai-providers', id: 'vertex' }, body: { enabled: true } }),
      context
    );
    expect(store.upsertDoc.mock.calls[0][1]).not.toHaveProperty('oauthToken');
  });

  it('PATCH accepts an oauthToken write but strips it from the response', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'plaud' })),
      patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.patchConfig(
      makeRequest({ params: { collection: 'mcp-servers', id: 'plaud' }, body: { oauthToken: 'tok-123' } }),
      context
    );
    expect(store.patchDoc.mock.calls[0][2].oauthToken).toBe('tok-123'); // write goes through
    expect(res.body).not.toContain('tok-123'); // read never returns it
  });

  it('DELETE targets the mapped container', async () => {
    const store = makeStore();
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    await h.deleteConfig(makeRequest({ params: { collection: 'mcp-servers', id: 's1' } }), context);
    expect(store.deleteDoc).toHaveBeenCalledWith('mcp_servers', 's1');
  });
});

describe('usage records', () => {
  it('sorts timestamp desc, honors since as a parameterized filter', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [
        { id: 'a', timestamp: '2026-01-01T00:00:00Z' },
        { id: 'b', timestamp: '2026-03-01T00:00:00Z' },
      ]),
    });
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.listUsage(makeRequest({ query: { since: '2026-01-01' } }), context);
    expect(JSON.parse(res.body).items.map((i) => i.id)).toEqual(['b', 'a']);
    const [, query, params] = store.queryDocs.mock.calls[0];
    expect(query).toContain('c.timestamp >= @since');
    expect(params).toContainEqual({ name: '@since', value: '2026-01-01' });
  });

  it('400s an unparseable since', async () => {
    const h = createAdminIntegrationHandlers({ guard: allowGuard, store: makeStore(), ...fixed });
    expect((await h.listUsage(makeRequest({ query: { since: 'junk' } }), context)).status).toBe(400);
  });
});

describe('AI feature switches', () => {
  const handlers = (store) =>
    createAdminIntegrationHandlers({ guard: allowGuard, store, ...fixed });

  it('GET resolves absent-means-on, so the portal shows real state not an empty object', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => null) });
    const response = await handlers(store).getAiFeatures(makeRequest(), context);
    const body = JSON.parse(response.body);

    expect(response.status).toBe(200);
    expect(Object.values(body.features).every((v) => v === true)).toBe(true);
    expect(Object.keys(body.features)).toContain('inspector');
  });

  it('GET returns the catalogue, so the UI does not keep a second copy of the list', async () => {
    // A second copy is precisely how the AI Engine page came to advertise
    // Vertex as enabled while the router had removed it.
    const store = makeStore();
    const body = JSON.parse((await handlers(store).getAiFeatures(makeRequest(), context)).body);
    expect(body.catalogue.inspector.label).toBeTruthy();
    expect(Object.keys(body.catalogue).sort()).toEqual(Object.keys(body.features).sort());
  });

  it('GET reports a stored false as false', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ features: { critique: false } })) });
    const body = JSON.parse((await handlers(store).getAiFeatures(makeRequest(), context)).body);
    expect(body.features.critique).toBe(false);
    expect(body.features.inspector).toBe(true);
  });

  it('PUT merges rather than replaces, so one toggle does not clear the rest', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ features: { critique: false } })) });
    const response = await handlers(store).putAiFeatures(
      makeRequest({ body: { features: { telegram: false } } }),
      context
    );
    expect(response.status).toBe(200);
    expect(store.patchDoc).toHaveBeenCalledWith('admin_settings', 'ai-features', {
      features: { critique: false, telegram: false },
      updatedAt: '2026-08-06T12:00:00.000Z',
    });
  });

  it('PUT stores strict booleans — a stray 0 must not read as OFF later', async () => {
    // The router disables on an explicit false only, so a 0 stored here would
    // silently mean ON. Coercing at the door means the document cannot hold
    // that ambiguity at all.
    const store = makeStore();
    await handlers(store).putAiFeatures(
      makeRequest({ body: { features: { inspector: 0, altText: false } } }),
      context
    );
    expect(store.upsertDoc.mock.calls[0][1].features).toEqual({
      inspector: true,
      altText: false,
    });
  });

  it('PUT 400s an unknown feature name instead of storing a switch that governs nothing', async () => {
    const store = makeStore();
    const response = await handlers(store).putAiFeatures(
      makeRequest({ body: { features: { inspectr: false } } }),
      context
    );
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/inspectr/);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('PUT 400s a body that is not { features: {...} }', async () => {
    const store = makeStore();
    for (const body of [{}, { features: [] }, { features: null }]) {
      expect((await handlers(store).putAiFeatures(makeRequest({ body }), context)).status).toBe(400);
    }
  });

  it('both verbs require a role', async () => {
    const store = makeStore();
    const denied = createAdminIntegrationHandlers({ guard: denyGuard, store, ...fixed });
    expect((await denied.getAiFeatures(makeRequest(), context)).status).toBe(403);
    expect(
      (await denied.putAiFeatures(makeRequest({ body: { features: {} } }), context)).status
    ).toBe(403);
  });
});
