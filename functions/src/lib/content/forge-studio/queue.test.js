/**
 * The Forge Studio Queue (owner request 2026-10-06), one document per entry:
 * URLs in, entries out, by the hundreds; fields applied to one or many under
 * each entry's ETag; Save starts one forge-from-url job per entry with the
 * brief on the payload; the job's outcome lands back on the entry; the first
 * cut's single document is migrated and emptied on the first read.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  LEGACY_QUEUE_DOC_ID,
  MAX_QUEUE_ITEMS,
  MAX_URLS_PER_ADD,
  QUEUE_DOC_TYPE,
  QUEUE_ID_PREFIX,
  applyFields,
  createForgeQueueHandlers,
  entryBrief,
  migrateLegacyQueue,
  normalizeQueueUrl,
  outcomeFor,
  recordQueueOutcome,
  updateEntry,
} from './queue.js';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const user = { oid: 'u1', email: 'owner@hcw.test' };
const guard = { requireRole: vi.fn(async () => ({ user, role: 'editor', error: null })) };
const denied = { requireRole: vi.fn(async () => ({ error: { status: 403, body: '{}' } })) };

/** An in-memory admin_config + jobs store with real ETags, and a way to make a write lose. */
function memStore(seed = []) {
  const docs = new Map();
  let tick = 1;
  for (const doc of seed) docs.set(`admin_config/${doc.id}`, { ...doc, _etag: `e${++tick}` });
  const store = {
    docs,
    conflictsLeft: 0,
    queryDocs: vi.fn(async (container, query, params) => {
      const type = params.find((p) => p.name === '@type')?.value;
      return [...docs.values()].filter((d) => d.docType === type && !String(d.id).startsWith('jobs/'));
    }),
    readDoc: vi.fn(async (container, id) => {
      const doc = docs.get(`${container}/${id}`);
      return doc ? JSON.parse(JSON.stringify(doc)) : null;
    }),
    createDoc: vi.fn(async (container, doc) => {
      const key = `${container}/${doc.id}`;
      if (docs.has(key)) throw Object.assign(new Error('Conflict'), { code: 409 });
      const written = { ...doc, _etag: `e${++tick}` };
      docs.set(key, written);
      return written;
    }),
    patchDoc: vi.fn(async (container, id, updates, options = {}) => {
      const key = `${container}/${id}`;
      const current = docs.get(key);
      if (!current) throw Object.assign(new Error('Not found'), { code: 404 });
      if (store.conflictsLeft > 0) {
        store.conflictsLeft -= 1;
        throw Object.assign(new Error('Precondition failed'), { code: 412 });
      }
      if (options.ifMatch && options.ifMatch !== current._etag) {
        throw Object.assign(new Error('Precondition failed'), { code: 412 });
      }
      const written = { ...current, ...updates, _etag: `e${++tick}` };
      docs.set(key, written);
      return written;
    }),
    replaceDocIfMatch: vi.fn(async (container, doc) => {
      const key = `${container}/${doc.id}`;
      const written = { ...doc, _etag: `e${++tick}` };
      docs.set(key, written);
      return written;
    }),
    deleteDoc: vi.fn(async (container, id) => {
      docs.delete(`${container}/${id}`);
    }),
    upsertDoc: vi.fn(async (container, doc) => {
      docs.set(`${container}/${doc.id}`, { ...doc });
      return doc;
    }),
  };
  return store;
}

const request = (body, method = 'POST') => ({ method, json: async () => body });
const parse = (res) => JSON.parse(res.body);
const context = { error: vi.fn(), log: vi.fn() };
const entries = (store) =>
  [...store.docs.values()].filter((d) => d.docType === QUEUE_DOC_TYPE);

function handlers(store, over = {}) {
  let n = 0;
  return createForgeQueueHandlers({
    guard,
    store,
    now: () => NOW,
    uuid: () => `id-${++n}`,
    ...over,
  });
}
const idOf = (n) => `${QUEUE_ID_PREFIX}id-${n}`;

describe('normalizeQueueUrl', () => {
  it('keeps http(s) only, drops the fragment, keeps the query, trims', () => {
    expect(normalizeQueueUrl(' https://a.test/p?utm_source=x#top ')).toBe(
      'https://a.test/p?utm_source=x'
    );
    expect(normalizeQueueUrl('http://a.test')).toBe('http://a.test/');
    expect(normalizeQueueUrl('ftp://a.test/x')).toBe('');
    expect(normalizeQueueUrl('javascript:alert(1)')).toBe('');
    expect(normalizeQueueUrl('not a url')).toBe('');
    expect(normalizeQueueUrl('')).toBe('');
  });
});

describe('adding URLs', () => {
  it('creates one entry document per distinct URL, with an empty URL-mode brief, and skips repeats', async () => {
    const store = memStore();
    const h = handlers(store);
    const res = await h.add(
      request({ urls: ['https://a.test/1', 'https://a.test/1#x', 'https://b.test/2', 'nope'] }),
      context
    );
    expect(res.status).toBe(200);
    const body = parse(res);
    expect(body.added).toEqual([idOf(1), idOf(2)]);
    expect(body.total).toBe(2);
    expect(body.max).toBe(MAX_QUEUE_ITEMS);
    const entry = body.items.find((i) => i.url === 'https://a.test/1');
    expect(entry).toMatchObject({
      id: idOf(1),
      docType: QUEUE_DOC_TYPE,
      configScope: 'admin_config',
      status: 'queued',
      kind: '',
      ideaOrigin: 'imported-source',
      addedBy: 'owner@hcw.test',
      jobId: null,
      contentId: null,
    });
    expect(entry.brief).toMatchObject({ mode: 'url', sourceUrl: 'https://a.test/1', objective: '' });
    expect(store.createDoc).toHaveBeenCalledTimes(2);

    const again = parse(
      await h.add(request({ urls: ['https://a.test/1', 'https://c.test/3'] }), context)
    );
    expect(again.added).toEqual([idOf(3)]);
    expect(again.skipped).toEqual(['https://a.test/1']);
    expect(again.total).toBe(3);
  });

  it('takes a favourites export of hundreds in one add', async () => {
    const h = handlers(memStore());
    const urls = Array.from({ length: 600 }, (_, i) => `https://fav.test/${i}`);
    const body = parse(await h.add(request({ urls }), context));
    expect(body.added).toHaveLength(600);
    expect(body.total).toBe(600);
    expect(body.items[0].url).toBe('https://fav.test/0'); // same stamp, stable order within it
  });

  it('refuses a body with no usable URL, and answers the per-call cap', async () => {
    const h = handlers(memStore());
    expect((await h.add(request({ urls: ['nope', 'mailto:x@y'] }), context)).status).toBe(400);
    expect((await h.add(request({}), context)).status).toBe(400);
    const tooMany = Array.from({ length: MAX_URLS_PER_ADD + 1 }, (_, i) => `https://a.test/${i}`);
    expect(parse(await h.add(request({ urls: tooMany }), context)).error).toMatch(
      new RegExp(`At most ${MAX_URLS_PER_ADD}`)
    );
  });

  it('stops at MAX_QUEUE_ITEMS and says how many did not fit', async () => {
    const seed = Array.from({ length: MAX_QUEUE_ITEMS }, (_, i) => ({
      id: `${QUEUE_ID_PREFIX}old-${i}`,
      configScope: 'admin_config',
      docType: QUEUE_DOC_TYPE,
      url: `https://old.test/${i}`,
      status: 'queued',
      addedAt: '2026-10-01T00:00:00.000Z',
    }));
    const h = handlers(memStore(seed));
    const body = parse(await h.add(request({ urls: ['https://new.test/1'] }), context));
    expect(body.added).toEqual([]);
    expect(body.full).toBe(1);
    expect(body.total).toBe(MAX_QUEUE_ITEMS);
  });

  it('is editor-gated', async () => {
    const h = createForgeQueueHandlers({ guard: denied, store: memStore(), now: () => NOW });
    expect((await h.add(request({ urls: ['https://a.test'] }), context)).status).toBe(403);
    expect((await h.list(request(null, 'GET'), context)).status).toBe(403);
  });
});

describe('fields on one or many entries', () => {
  const seeded = async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(
      request({ urls: ['https://a.test/1', 'https://b.test/2', 'https://c.test/3'] }),
      context
    );
    return { store, h };
  };

  it('applies the shared fields to every selected entry under its ETag, normalised, and leaves the rest alone', async () => {
    const { h, store } = await seeded();
    const res = await h.update(
      request({
        ids: [idOf(1), idOf(2)],
        fields: {
          objective: '  Teach the thing  ',
          tone: 'Direct and practical',
          requiredTopics: 'a, b\nb',
          targetChannel: 'coder_corner',
          kind: 'tutorial',
        },
      }),
      context
    );
    expect(res.status).toBe(200);
    const body = parse(res);
    expect(body.applied).toEqual([idOf(1), idOf(2)]);
    const one = body.items.find((i) => i.id === idOf(1));
    expect(one.kind).toBe('tutorial');
    expect(one.brief).toMatchObject({
      objective: 'Teach the thing',
      tone: 'Direct and practical',
      requiredTopics: ['a', 'b'],
      targetChannel: 'coder_corner',
      mode: 'url',
      sourceUrl: 'https://a.test/1',
    });
    expect(body.items.find((i) => i.id === idOf(3)).brief.objective).toBe('');
    // Each write carried the entry's own ETag.
    for (const call of store.patchDoc.mock.calls) expect(call[3].ifMatch).toMatch(/^e\d+$/);
  });

  it('a later single-entry save keeps the other fields and can clear one', async () => {
    const { h } = await seeded();
    await h.update(request({ ids: [idOf(1)], fields: { objective: 'First', audience: 'Ops' } }), context);
    const body = parse(await h.update(request({ ids: [idOf(1)], fields: { audience: '' } }), context));
    const one = body.items.find((i) => i.id === idOf(1));
    expect(one.brief.objective).toBe('First');
    expect(one.brief.audience).toBe('');
  });

  it('refuses an update with no ids or no known field; removes entries, keeping forging ones', async () => {
    const { h, store } = await seeded();
    expect((await h.update(request({ fields: { objective: 'x' } }), context)).status).toBe(400);
    expect((await h.update(request({ ids: [idOf(1)], fields: { bogus: 1 } }), context)).status).toBe(400);
    store.docs.get(`admin_config/${idOf(1)}`).status = 'forging';
    const body = parse(
      await h.update(request({ ids: [idOf(1), idOf(2), idOf(3), 'nope:x'], remove: true }), context)
    );
    expect(body.removed).toEqual([idOf(2), idOf(3)]);
    expect(body.items.map((i) => i.id)).toEqual([idOf(1)]);
    expect(store.deleteDoc).toHaveBeenCalledTimes(2);
  });

  it('applyFields re-queues a failed entry, and the handler never touches one that is forging', async () => {
    const stamp = NOW.toISOString();
    const failed = { id: 'x', url: 'https://a.test', status: 'failed', error: 'boom', brief: {} };
    expect(applyFields(failed, { fields: { objective: 'again' }, kind: undefined }, stamp)).toMatchObject({
      status: 'queued',
      error: null,
      brief: { objective: 'again' },
    });
    const { h, store } = await seeded();
    store.docs.get(`admin_config/${idOf(1)}`).status = 'forging';
    const body = parse(
      await h.update(request({ ids: [idOf(1), idOf(2)], fields: { objective: 'o' } }), context)
    );
    expect(body.applied).toEqual([idOf(2)]);
    expect(body.items.find((i) => i.id === idOf(1)).brief.objective).toBe('');
  });
});

describe('Save: one forge-from-url job per entry, the brief on the payload', () => {
  const seeded = async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://a.test/1', 'https://b.test/2', 'https://c.test/3'] }), context);
    return { store, h };
  };

  it('writes a job document and emits a message per selected entry and marks them forging', async () => {
    const { h, store } = await seeded();
    await h.update(request({ ids: [idOf(1), idOf(2)], fields: { objective: 'Explain', kind: 'guide' } }), context);
    const enqueue = vi.fn();
    const res = await h.forge(request({ ids: [idOf(1), idOf(2), `${QUEUE_ID_PREFIX}nope`] }), context, { enqueue });
    expect(res.status).toBe(200);
    const body = parse(res);
    expect(body.started).toEqual([
      { id: idOf(1), jobId: 'id-4' },
      { id: idOf(2), jobId: 'id-5' },
    ]);
    expect(body.items.filter((i) => i.status === 'forging').map((i) => i.id).sort()).toEqual([idOf(1), idOf(2)]);
    expect(body.items.find((i) => i.id === idOf(1)).jobId).toBe('id-4');

    const jobs = store.upsertDoc.mock.calls.filter(([c]) => c === 'jobs').map(([, d]) => d);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: 'id-4',
      type: 'forge-from-url',
      status: 'queued',
      requestedBy: { oid: 'u1', email: 'owner@hcw.test' },
      payload: {
        url: 'https://a.test/1',
        kind: 'guide',
        ideaOrigin: 'imported-source',
        queueItemId: idOf(1),
        brief: expect.objectContaining({ objective: 'Explain', mode: 'url', sourceUrl: 'https://a.test/1' }),
      },
    });
    expect(enqueue.mock.calls.map(([m]) => m)).toEqual([
      { jobId: 'id-4', type: 'forge-from-url' },
      { jobId: 'id-5', type: 'forge-from-url' },
    ]);
    expect(Buffer.byteLength(JSON.stringify(jobs[0].payload))).toBeLessThan(16384);
  });

  it('skips entries already forging or forged, and refuses to run without a queue output', async () => {
    const { h, store } = await seeded();
    Object.assign(store.docs.get(`admin_config/${idOf(1)}`), { status: 'forged', contentId: 'c-1' });
    const enqueue = vi.fn();
    const body = parse(await h.forge(request({ ids: [idOf(1), idOf(2)] }), context, { enqueue }));
    expect(body.started).toEqual([{ id: idOf(2), jobId: 'id-4' }]);
    expect(body.items.find((i) => i.id === idOf(1))).toMatchObject({ status: 'forged', contentId: 'c-1' });
    expect((await h.forge(request({ ids: [idOf(2)] }), context, {})).status).toBe(500);
  });

  it('writes each job before marking its entry, and a failed job write leaves that entry and the later ones queued and named', async () => {
    const { h, store } = await seeded();
    const order = [];
    store.upsertDoc.mockImplementation(async (container, doc) => {
      order.push(`job:${doc.payload.queueItemId}`);
      if (doc.payload.queueItemId === idOf(2)) throw new Error('jobs container unavailable');
      store.docs.set(`${container}/${doc.id}`, { ...doc });
      return doc;
    });
    const original = store.patchDoc.getMockImplementation();
    store.patchDoc.mockImplementation(async (...args) => {
      order.push(`mark:${args[1]}`);
      return original(...args);
    });
    const enqueue = vi.fn();
    const body = parse(await h.forge(request({ ids: [idOf(1), idOf(2), idOf(3)] }), context, { enqueue }));
    expect(order).toEqual([`job:${idOf(1)}`, `mark:${idOf(1)}`, `job:${idOf(2)}`]);
    expect(body.started).toEqual([{ id: idOf(1), jobId: 'id-4' }]);
    expect(body.notStarted).toEqual([
      { id: idOf(2), error: 'jobs container unavailable' },
      { id: idOf(3), error: 'not attempted after an earlier job write failed' },
    ]);
    expect(body.items.map((i) => i.status).sort()).toEqual(['forging', 'queued', 'queued']);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('the job outcome lands on the entry', () => {
  it('outcomeFor: success → forged with the document; a duplicate → forged on the duplicate; a failure → failed with the error', () => {
    expect(outcomeFor({ status: 'succeeded', result: { success: true, contentId: 'c1' } })).toEqual({
      status: 'forged',
      contentId: 'c1',
      error: null,
    });
    expect(
      outcomeFor({
        status: 'succeeded',
        result: { success: false, skipped: true, contentId: 'src', duplicateOf: 'c9', error: 'dup' },
      })
    ).toEqual({ status: 'forged', contentId: 'c9', error: 'dup' });
    expect(outcomeFor({ status: 'failed', result: null, error: 'scrape 403' })).toEqual({
      status: 'failed',
      contentId: null,
      error: 'scrape 403',
    });
    expect(outcomeFor({ status: 'timeout', result: null, error: null }).error).toMatch(/timeout/);
  });

  it('recordQueueOutcome patches the named entry under its ETag, outlasts races, and ignores one that is gone', async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://a.test/1'] }), context);
    await h.forge(request({ ids: [idOf(1)] }), context, { enqueue: vi.fn() });
    store.conflictsLeft = 6;
    const sleep = vi.fn(async () => {});
    await recordQueueOutcome(
      store,
      { queueItemId: idOf(1), status: 'succeeded', result: { success: true, contentId: 'c-7' }, error: null },
      { now: () => NOW, sleep }
    );
    expect(sleep).toHaveBeenCalledTimes(6);
    const body = parse(await h.list(request(null, 'GET'), context));
    expect(body.items[0]).toMatchObject({ status: 'forged', contentId: 'c-7', error: null });
    expect(
      await recordQueueOutcome(store, { queueItemId: `${QUEUE_ID_PREFIX}gone`, status: 'failed', error: 'x' }, { now: () => NOW, sleep })
    ).toBeNull();
    expect(await recordQueueOutcome(store, { queueItemId: '../x', status: 'failed' }, { now: () => NOW, sleep })).toBeNull();
  });

  it('the list reconciles a forging entry whose job document has finished', async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://a.test/1', 'https://b.test/2'] }), context);
    await h.forge(request({ ids: [idOf(1), idOf(2)] }), context, { enqueue: vi.fn() });
    const jobOf = (id) => store.docs.get(`admin_config/${id}`).jobId;
    store.docs.set(`jobs/${jobOf(idOf(1))}`, {
      id: jobOf(idOf(1)),
      status: 'succeeded',
      result: { success: true, contentId: 'c-1' },
    });
    store.docs.set(`jobs/${jobOf(idOf(2))}`, { id: jobOf(idOf(2)), status: 'running' });
    const body = parse(await h.list(request(null, 'GET'), context));
    expect(body.items.find((i) => i.id === idOf(1))).toMatchObject({ status: 'forged', contentId: 'c-1' });
    expect(body.items.find((i) => i.id === idOf(2)).status).toBe('forging');
  });
});

describe('updateEntry and entryBrief', () => {
  it('retries a 412 and writes on the next read; gives up after the attempts with a plain sentence', async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://n.test'] }), context);
    store.conflictsLeft = 2;
    const after = await updateEntry(store, idOf(1), () => ({ title: 'named' }), { sleep: async () => {} });
    expect(after.title).toBe('named');
    expect(store.patchDoc).toHaveBeenCalledTimes(3);
    store.conflictsLeft = 99;
    await expect(updateEntry(store, idOf(1), () => ({ title: 'x' }), { sleep: async () => {} })).rejects.toThrow(
      /kept changing/
    );
  });

  it('a change that returns null writes nothing; an unknown id answers null', async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://n.test'] }), context);
    store.patchDoc.mockClear();
    expect((await updateEntry(store, idOf(1), () => null)).url).toBe('https://n.test/');
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(await updateEntry(store, `${QUEUE_ID_PREFIX}missing`, () => ({}))).toBeNull();
    expect(await updateEntry(store, 'forge_profile', () => ({}))).toBeNull();
  });

  it('entryBrief always carries the entry URL in URL mode, whatever the fields say', () => {
    const brief = entryBrief(
      { url: 'https://a.test/1', brief: { objective: 'o' } },
      { mode: 'idea', sourceUrl: 'https://evil.test', audience: 'devs' }
    );
    expect(brief).toMatchObject({ mode: 'url', sourceUrl: 'https://a.test/1', objective: 'o', audience: 'devs' });
  });
});

describe('the first cut’s single document', () => {
  const legacy = {
    id: LEGACY_QUEUE_DOC_ID,
    configScope: 'admin_config',
    items: [
      {
        id: 'old-1',
        url: 'https://a.test/1',
        status: 'queued',
        kind: 'guide',
        brief: { objective: 'Keep me' },
        addedAt: '2026-10-06T01:00:00.000Z',
        addedBy: 'owner@hcw.test',
        updatedAt: '2026-10-06T01:00:00.000Z',
      },
      {
        id: 'old-2',
        url: 'https://b.test/2',
        status: 'forged',
        contentId: 'c-2',
        jobId: 'j-2',
        addedAt: '2026-10-06T01:01:00.000Z',
      },
      { id: 'old-3', url: 'nope', status: 'queued', addedAt: '2026-10-06T01:02:00.000Z' },
    ],
  };

  it('is migrated into entry documents on the first list, keeping fields and statuses, then emptied', async () => {
    const store = memStore([legacy]);
    const h = handlers(store);
    const body = parse(await h.list(request(null, 'GET'), context));
    expect(body.items.map((i) => i.url)).toEqual(['https://b.test/2', 'https://a.test/1']);
    const a = body.items.find((i) => i.url === 'https://a.test/1');
    expect(a).toMatchObject({
      id: idOf(1),
      docType: QUEUE_DOC_TYPE,
      kind: 'guide',
      status: 'queued',
      addedAt: '2026-10-06T01:00:00.000Z',
      addedBy: 'owner@hcw.test',
    });
    expect(a.brief).toMatchObject({ objective: 'Keep me', mode: 'url', sourceUrl: 'https://a.test/1' });
    expect(body.items.find((i) => i.url === 'https://b.test/2')).toMatchObject({
      status: 'forged',
      contentId: 'c-2',
      jobId: 'j-2',
    });
    const emptied = store.docs.get(`admin_config/${LEGACY_QUEUE_DOC_ID}`);
    expect(emptied.items).toEqual([]);
    expect(emptied.migratedCount).toBe(2);
    // A second list migrates nothing more.
    store.createDoc.mockClear();
    await h.list(request(null, 'GET'), context);
    expect(store.createDoc).not.toHaveBeenCalled();
    expect(entries(store)).toHaveLength(2);
  });

  it('skips URLs the queue already has, and does nothing without a legacy document', async () => {
    const store = memStore([legacy]);
    const h = handlers(store);
    await h.add(request({ urls: ['https://a.test/1'] }), context);
    const moved = await migrateLegacyQueue({ store, now: () => NOW, uuid: () => 'm-1' });
    expect(moved).toBe(1);
    expect(entries(store).map((e) => e.url).sort()).toEqual(['https://a.test/1', 'https://b.test/2']);
    expect(await migrateLegacyQueue({ store: memStore(), now: () => NOW, uuid: () => 'm' })).toBe(0);
  });
});
