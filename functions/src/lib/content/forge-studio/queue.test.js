/**
 * The Forge Studio Queue (owner request 2026-10-06): URLs in, entries out;
 * fields applied to one or many; Save starts one forge-from-url job per
 * entry with the brief on the payload; the job's outcome lands back on the
 * entry; every write goes through the ETag and retries when it loses.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_QUEUE_ITEMS,
  QUEUE_DOC_ID,
  applyFields,
  createForgeQueueHandlers,
  entryBrief,
  normalizeQueueUrl,
  outcomeFor,
  recordQueueOutcome,
  updateQueue,
} from './queue.js';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const user = { oid: 'u1', email: 'owner@hcw.test' };
const guard = { requireRole: vi.fn(async () => ({ user, role: 'editor', error: null })) };
const denied = { requireRole: vi.fn(async () => ({ error: { status: 403, body: '{}' } })) };

/** An in-memory admin_config + jobs store with real ETags, and a way to make a write lose. */
function memStore(initial = null) {
  const docs = new Map();
  if (initial) docs.set(`admin_config/${QUEUE_DOC_ID}`, { ...initial, _etag: 'e1' });
  let tick = 1;
  const store = {
    docs,
    conflictsLeft: 0,
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
    replaceDocIfMatch: vi.fn(async (container, doc) => {
      const key = `${container}/${doc.id}`;
      const current = docs.get(key);
      if (store.conflictsLeft > 0) {
        store.conflictsLeft -= 1;
        throw Object.assign(new Error('Precondition failed'), { code: 412 });
      }
      if (!current || current._etag !== doc._etag) {
        throw Object.assign(new Error('Precondition failed'), { code: 412 });
      }
      const written = { ...doc, _etag: `e${++tick}` };
      docs.set(key, written);
      return written;
    }),
    upsertDoc: vi.fn(async (container, doc) => {
      docs.set(`${container}/${doc.id}`, { ...doc });
      return doc;
    }),
  };
  return store;
}

const request = (body, method = 'POST') => ({
  method,
  json: async () => body,
});
const parse = (res) => JSON.parse(res.body);
const context = { error: vi.fn(), log: vi.fn() };

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

describe('normalizeQueueUrl', () => {
  it('keeps http(s) only, drops the fragment, keeps the query, trims', () => {
    expect(normalizeQueueUrl(' https://a.test/p?utm_source=x#top ')).toBe('https://a.test/p?utm_source=x');
    expect(normalizeQueueUrl('http://a.test')).toBe('http://a.test/');
    expect(normalizeQueueUrl('ftp://a.test/x')).toBe('');
    expect(normalizeQueueUrl('javascript:alert(1)')).toBe('');
    expect(normalizeQueueUrl('not a url')).toBe('');
    expect(normalizeQueueUrl('')).toBe('');
  });
});

describe('adding URLs', () => {
  it('creates one queued entry per distinct URL, with an empty URL-mode brief, and skips repeats', async () => {
    const store = memStore();
    const h = handlers(store);
    const res = await h.add(
      request({ urls: ['https://a.test/1', 'https://a.test/1#x', 'https://b.test/2', 'nope'] }),
      context
    );
    expect(res.status).toBe(200);
    const body = parse(res);
    expect(body.added).toEqual(['id-1', 'id-2']);
    expect(body.items.map((i) => i.url).sort()).toEqual(['https://a.test/1', 'https://b.test/2']);
    const entry = body.items.find((i) => i.url === 'https://a.test/1');
    expect(entry).toMatchObject({
      status: 'queued',
      kind: '',
      ideaOrigin: 'imported-source',
      addedBy: 'owner@hcw.test',
      jobId: null,
      contentId: null,
    });
    expect(entry.brief).toMatchObject({ mode: 'url', sourceUrl: 'https://a.test/1', objective: '' });
    // The document was created, under the admin_config partition.
    expect(store.createDoc).toHaveBeenCalledWith(
      'admin_config',
      expect.objectContaining({ id: QUEUE_DOC_ID, configScope: 'admin_config' })
    );

    const again = parse(await h.add(request({ urls: ['https://a.test/1', 'https://c.test/3'] }), context));
    expect(again.added).toEqual(['id-3']);
    expect(again.skipped).toEqual(['https://a.test/1']);
    expect(again.total).toBe(3);
  });

  it('refuses a body with no usable URL, and answers the cap', async () => {
    const h = handlers(memStore());
    expect((await h.add(request({ urls: ['nope', 'mailto:x@y'] }), context)).status).toBe(400);
    expect((await h.add(request({}), context)).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) => `https://a.test/${i}`);
    expect(parse(await h.add(request({ urls: tooMany }), context)).error).toMatch(/At most 100/);
  });

  it('stops at MAX_QUEUE_ITEMS and says how many did not fit', async () => {
    const items = Array.from({ length: MAX_QUEUE_ITEMS }, (_, i) => ({
      id: `old-${i}`,
      url: `https://old.test/${i}`,
      status: 'queued',
      addedAt: '2026-10-01T00:00:00.000Z',
    }));
    const h = handlers(memStore({ id: QUEUE_DOC_ID, configScope: 'admin_config', items }));
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
    await h.add(request({ urls: ['https://a.test/1', 'https://b.test/2', 'https://c.test/3'] }), context);
    return { store, h };
  };

  it('applies the shared fields to every selected entry, normalised, and leaves the rest alone', async () => {
    const { h } = await seeded();
    const res = await h.update(
      request({
        ids: ['id-1', 'id-2'],
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
    expect(body.applied).toEqual(['id-1', 'id-2']);
    const one = body.items.find((i) => i.id === 'id-1');
    expect(one.kind).toBe('tutorial');
    expect(one.brief).toMatchObject({
      objective: 'Teach the thing',
      tone: 'Direct and practical',
      requiredTopics: ['a', 'b'],
      targetChannel: 'coder_corner',
      mode: 'url',
      sourceUrl: 'https://a.test/1',
    });
    const three = body.items.find((i) => i.id === 'id-3');
    expect(three.brief.objective).toBe('');
    expect(three.kind).toBe('');
  });

  it('a later single-entry save keeps the other fields and can clear one', async () => {
    const { h } = await seeded();
    await h.update(request({ ids: ['id-1'], fields: { objective: 'First', audience: 'Ops' } }), context);
    const body = parse(await h.update(request({ ids: ['id-1'], fields: { audience: '' } }), context));
    const one = body.items.find((i) => i.id === 'id-1');
    expect(one.brief.objective).toBe('First');
    expect(one.brief.audience).toBe('');
  });

  it('refuses an update with no ids or no known field, and removes entries when asked', async () => {
    const { h } = await seeded();
    expect((await h.update(request({ fields: { objective: 'x' } }), context)).status).toBe(400);
    expect((await h.update(request({ ids: ['id-1'], fields: { bogus: 1 } }), context)).status).toBe(400);
    const body = parse(await h.update(request({ ids: ['id-2', 'id-3'], remove: true }), context));
    expect(body.removed).toEqual(['id-2', 'id-3']);
    expect(body.items.map((i) => i.id)).toEqual(['id-1']);
  });

  it('applyFields re-queues a failed entry, and never touches one that is forging (handler)', async () => {
    const stamp = NOW.toISOString();
    const failed = { id: 'x', url: 'https://a.test', status: 'failed', error: 'boom', brief: {} };
    expect(applyFields(failed, { fields: { objective: 'again' }, kind: undefined }, stamp)).toMatchObject({
      status: 'queued',
      error: null,
      brief: { objective: 'again' },
    });
    const { h, store } = await seeded();
    const key = `admin_config/${QUEUE_DOC_ID}`;
    const doc = store.docs.get(key);
    doc.items[0].status = 'forging';
    const body = parse(await h.update(request({ ids: ['id-1', 'id-2'], fields: { objective: 'o' } }), context));
    expect(body.applied).toEqual(['id-2']);
    expect(body.items.find((i) => i.id === 'id-1').brief.objective).toBe('');
  });
});

describe('Save: one forge-from-url job per entry, the brief on the payload', () => {
  it('writes a job document and a queue message per selected entry and marks them forging', async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://a.test/1', 'https://b.test/2'] }), context);
    await h.update(request({ ids: ['id-1', 'id-2'], fields: { objective: 'Explain', kind: 'guide' } }), context);
    const enqueue = vi.fn();
    const res = await h.forge(request({ ids: ['id-1', 'id-2', 'id-nope'] }), context, { enqueue });
    expect(res.status).toBe(200);
    const body = parse(res);
    expect(body.started).toEqual([
      { id: 'id-1', jobId: 'id-3' },
      { id: 'id-2', jobId: 'id-4' },
    ]);
    expect(body.items.every((i) => i.status === 'forging')).toBe(true);
    expect(body.items.find((i) => i.id === 'id-1').jobId).toBe('id-3');

    const jobs = store.upsertDoc.mock.calls.filter(([c]) => c === 'jobs').map(([, d]) => d);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: 'id-3',
      type: 'forge-from-url',
      status: 'queued',
      requestedBy: { oid: 'u1', email: 'owner@hcw.test' },
      payload: {
        url: 'https://a.test/1',
        kind: 'guide',
        ideaOrigin: 'imported-source',
        queueItemId: 'id-1',
        brief: expect.objectContaining({ objective: 'Explain', mode: 'url', sourceUrl: 'https://a.test/1' }),
      },
    });
    expect(enqueue.mock.calls.map(([m]) => m)).toEqual([
      { jobId: 'id-3', type: 'forge-from-url' },
      { jobId: 'id-4', type: 'forge-from-url' },
    ]);
    // A payload stays under the job type's 16 KiB ceiling with every field full.
    expect(Buffer.byteLength(JSON.stringify(jobs[0].payload))).toBeLessThan(16384);
  });

  it('skips entries already forging or forged, and refuses to run without a queue output', async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://a.test/1', 'https://b.test/2'] }), context);
    const doc = store.docs.get(`admin_config/${QUEUE_DOC_ID}`);
    doc.items[0].status = 'forged';
    doc.items[0].contentId = 'c-1';
    const enqueue = vi.fn();
    const body = parse(await h.forge(request({ ids: ['id-1', 'id-2'] }), context, { enqueue }));
    expect(body.started).toEqual([{ id: 'id-2', jobId: 'id-3' }]);
    expect(body.items.find((i) => i.id === 'id-1')).toMatchObject({ status: 'forged', contentId: 'c-1' });
    expect((await h.forge(request({ ids: ['id-2'] }), context, {})).status).toBe(500);
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

  it('recordQueueOutcome updates the named entry under the ETag and ignores one that is gone', async () => {
    const store = memStore();
    const h = handlers(store);
    await h.add(request({ urls: ['https://a.test/1'] }), context);
    await h.forge(request({ ids: ['id-1'] }), context, { enqueue: vi.fn() });
    await recordQueueOutcome(
      store,
      { queueItemId: 'id-1', status: 'succeeded', result: { success: true, contentId: 'c-7' }, error: null },
      { now: () => NOW }
    );
    const body = parse(await h.list(request(null, 'GET'), context));
    expect(body.items[0]).toMatchObject({ status: 'forged', contentId: 'c-7', error: null });
    expect(
      await recordQueueOutcome(store, { queueItemId: 'gone', status: 'failed', error: 'x' }, { now: () => NOW })
    ).toMatchObject({ items: body.items.map((i) => expect.objectContaining({ id: i.id })) });
    expect(await recordQueueOutcome(store, { queueItemId: '../x', status: 'failed' }, { now: () => NOW })).toBeNull();
  });
});

describe('updateQueue', () => {
  it('retries a 412 and writes on the next read; gives up after the attempts with a plain sentence', async () => {
    const store = memStore({ id: QUEUE_DOC_ID, configScope: 'admin_config', items: [] });
    store.conflictsLeft = 2;
    const doc = await updateQueue(store, (items) => [...items, { id: 'n', url: 'https://n.test' }], {
      now: () => NOW,
    });
    expect(doc.items).toHaveLength(1);
    expect(store.replaceDocIfMatch).toHaveBeenCalledTimes(3);

    store.conflictsLeft = 99;
    await expect(updateQueue(store, (items) => items, { now: () => NOW })).rejects.toThrow(/kept changing/);
  });

  it('a mutate that returns null writes nothing', async () => {
    const store = memStore({ id: QUEUE_DOC_ID, configScope: 'admin_config', items: [] });
    await updateQueue(store, () => null, { now: () => NOW });
    expect(store.replaceDocIfMatch).not.toHaveBeenCalled();
    expect(store.createDoc).not.toHaveBeenCalled();
  });

  it('entryBrief always carries the entry URL in URL mode, whatever the fields say', () => {
    const brief = entryBrief(
      { url: 'https://a.test/1', brief: { objective: 'o' } },
      { mode: 'idea', sourceUrl: 'https://evil.test', audience: 'devs' }
    );
    expect(brief).toMatchObject({ mode: 'url', sourceUrl: 'https://a.test/1', objective: 'o', audience: 'devs' });
  });
});
