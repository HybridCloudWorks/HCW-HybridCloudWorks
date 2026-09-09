/**
 * Podcast transcript admin routes.
 *
 * The load-bearing assertions: every route is gated (review at publisher),
 * an unpublished article is refused at the door rather than as a failed job,
 * the enqueue writes the same job document `enqueueJob` does, the listing
 * never carries a transcript body, and a reviewer cannot set `failed`.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPodcastHandlers } from './handlers.js';
import { ARTICLE_CONTAINER, TRANSCRIPT_JOB_TYPE } from './generate.js';
import { STATUS, TRANSCRIPT_CONTAINER, TRANSCRIPT_LIST_FIELDS } from './store.js';
import { JOBS_CONTAINER } from '../jobs.js';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const context = { log: vi.fn(), error: vi.fn() };

const USER = { oid: 'oid-1', email: 'editor@example.test' };
const allowGuard = {
  requireRole: vi.fn(async (_req, role) => ({ user: USER, role, error: null })),
};
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};
/** Editor, but not publisher: the review route must refuse. */
const editorOnlyGuard = {
  requireRole: vi.fn(async (_req, role) =>
    role === 'publisher'
      ? { user: null, role: null, error: { status: 403, body: '{}' } }
      : { user: USER, role, error: null }
  ),
};

const makeRequest = ({ params = {}, body } = {}) => ({
  params,
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

const published = (over = {}) => ({
  id: 'content-1',
  Title: 'Picking a state backend',
  slug: 'picking-a-state-backend',
  contentStatus: 'published_blog',
  ...over,
});

const makeStore = (over = {}) => ({
  queryDocs: vi.fn(async () => []),
  readDoc: vi.fn(async () => null),
  upsertDoc: vi.fn(async (_c, doc) => doc),
  patchDoc: vi.fn(async (_c, id, updates) => ({ id, ...updates })),
  ...over,
});

const handlers = (store, guard = allowGuard) =>
  createPodcastHandlers({ guard, store, now: () => NOW, uuid: () => 'job-1' });

describe('auth', () => {
  it('every handler passes a guard denial through with zero store reads', async () => {
    const store = makeStore();
    const h = handlers(store, denyGuard);

    const responses = await Promise.all([
      h.generateTranscript(makeRequest({ body: { articleId: 'content-1' } }), context, {
        enqueue: vi.fn(),
      }),
      h.listTranscripts(makeRequest(), context),
      h.getTranscript(makeRequest({ params: { id: 'article_x' } }), context),
      h.reviewTranscript(makeRequest({ body: { id: 'article_x', status: 'published' } }), context),
    ]);

    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('review is gated at publisher; generate and the reads at editor', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => published()) });
    const h = handlers(store, editorOnlyGuard);

    const review = await h.reviewTranscript(
      makeRequest({ body: { id: 'article_x', status: 'published' } }),
      context
    );
    expect(review.status).toBe(403);
    expect(store.patchDoc).not.toHaveBeenCalled();

    const generate = await h.generateTranscript(
      makeRequest({ body: { articleId: 'content-1' } }),
      context,
      { enqueue: vi.fn() }
    );
    expect(generate.status).toBe(202);
    expect((await h.listTranscripts(makeRequest(), context)).status).toBe(200);
  });
});

describe('generateTranscript', () => {
  it('writes a queued job for a published article, sends the message, answers 202', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => published()) });
    const enqueue = vi.fn();
    const res = await handlers(store).generateTranscript(
      makeRequest({ body: { articleId: ' content-1 ' } }),
      context,
      { enqueue }
    );

    expect(res.status).toBe(202);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      jobId: 'job-1',
      type: TRANSCRIPT_JOB_TYPE,
      status: 'queued',
      poll: 'getJob?jobId=job-1',
      transcriptId: 'article_picking-a-state-backend',
    });
    expect(store.readDoc).toHaveBeenCalledWith(ARTICLE_CONTAINER, 'content-1', 'content-1');
    // The same document shape enqueueJob writes, so the worker, the sweeper
    // and getJob read it identically.
    expect(store.upsertDoc).toHaveBeenCalledWith(JOBS_CONTAINER, {
      id: 'job-1',
      type: TRANSCRIPT_JOB_TYPE,
      payload: { articleId: 'content-1' },
      status: 'queued',
      createdAt: NOW.toISOString(),
      startedAt: null,
      finishedAt: null,
      attempts: 0,
      requestedBy: USER,
      result: null,
      error: null,
    });
    expect(enqueue).toHaveBeenCalledWith({ jobId: 'job-1', type: TRANSCRIPT_JOB_TYPE });
  });

  it('refuses an unpublished article with 409 and a plain sentence, enqueuing nothing', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => published({ contentStatus: 'approved_blog' })),
    });
    const enqueue = vi.fn();
    const res = await handlers(store).generateTranscript(
      makeRequest({ body: { articleId: 'content-1' } }),
      context,
      { enqueue }
    );

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(
      /content-1 is not published; only published articles produce a podcast transcript/
    );
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('404s an article that does not exist', async () => {
    const res = await handlers(makeStore()).generateTranscript(
      makeRequest({ body: { articleId: 'ghost' } }),
      context,
      { enqueue: vi.fn() }
    );
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/ghost was not found/);
  });

  it('400s a missing, non-string or oversized articleId with the worker\'s own sentences', async () => {
    // One validator behind both doors: the route must refuse with exactly the
    // message the job would have failed with, or the same input reads as two
    // different faults depending on how it arrived.
    const h = handlers(makeStore());
    const io = { enqueue: vi.fn() };
    const refuse = async (body) => {
      const res = await h.generateTranscript(makeRequest({ body }), context, io);
      expect(res.status).toBe(400);
      return JSON.parse(res.body).error;
    };
    expect(await refuse({})).toBe('articleId is required');
    expect(await refuse({ articleId: '   ' })).toBe('articleId is required');
    expect(await refuse({ articleId: 42 })).toBe('articleId is required');
    expect(await refuse({ articleId: 'x'.repeat(201) })).toBe('articleId is too long');
    expect(io.enqueue).not.toHaveBeenCalled();
  });

  it('400s a body that is not JSON', async () => {
    const io = { enqueue: vi.fn() };
    expect((await handlers(makeStore()).generateTranscript(makeRequest(), context, io)).status).toBe(
      400
    );
    expect(io.enqueue).not.toHaveBeenCalled();
  });

  it('500s when no queue output is wired, rather than writing a job nothing will run', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => published()) });
    const res = await handlers(store).generateTranscript(
      makeRequest({ body: { articleId: 'content-1' } }),
      context
    );
    expect(res.status).toBe(500);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('500s a store failure without leaking it', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => {
        throw new Error('cosmos down');
      }),
    });
    const res = await handlers(store).generateTranscript(
      makeRequest({ body: { articleId: 'content-1' } }),
      context,
      { enqueue: vi.fn() }
    );
    expect(res.status).toBe(500);
    expect(res.body).not.toContain('cosmos down');
  });
});

describe('listTranscripts', () => {
  it('projects to the listing allowlist — never the transcript body — and bounds the query', async () => {
    const store = makeStore();
    await handlers(store).listTranscripts(makeRequest(), context);

    const [container, query] = store.queryDocs.mock.calls[0];
    expect(container).toBe(TRANSCRIPT_CONTAINER);
    expect(query).toMatch(/^SELECT TOP \d+ /);
    expect(query).not.toMatch(/SELECT TOP \d+ \*/);
    expect(query).not.toContain('c.transcript');
    for (const field of TRANSCRIPT_LIST_FIELDS) expect(query).toContain(`c.${field}`);
  });

  it('orders newest first in the query, not in memory, so the TOP bound keeps the newest rows', async () => {
    // A bounded query with no ORDER BY hands back any MAX rows; sorting those
    // afterwards would present a stale window as "newest first".
    const store = makeStore();
    await handlers(store).listTranscripts(makeRequest(), context);
    expect(store.queryDocs.mock.calls[0][1]).toMatch(/ ORDER BY c\.generatedAt DESC$/);
  });

  it('returns the rows in the order Cosmos gave them, with a total', async () => {
    const rows = [
      { id: 'article_b', generatedAt: '2026-06-01T00:00:00Z' },
      { id: 'article_a', generatedAt: '2026-01-01T00:00:00Z' },
    ];
    const store = makeStore({ queryDocs: vi.fn(async () => rows) });
    const body = JSON.parse((await handlers(store).listTranscripts(makeRequest(), context)).body);
    expect(body.items.map((t) => t.id)).toEqual(['article_b', 'article_a']);
    expect(body.total).toBe(2);
  });
});

describe('getTranscript', () => {
  it('returns one transcript in full, drafts and failures included', async () => {
    const doc = { id: 'article_x', status: STATUS.failed, error: 'model refused', transcript: [] };
    const store = makeStore({ readDoc: vi.fn(async () => doc) });
    const res = await handlers(store).getTranscript(
      makeRequest({ params: { id: 'article_x' } }),
      context
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).item).toEqual(doc);
    expect(store.readDoc).toHaveBeenCalledWith(TRANSCRIPT_CONTAINER, 'article_x', 'article_x');
  });

  it('404s an unknown id and 400s a missing one', async () => {
    const h = handlers(makeStore());
    expect((await h.getTranscript(makeRequest({ params: { id: 'nope' } }), context)).status).toBe(
      404
    );
    expect((await h.getTranscript(makeRequest(), context)).status).toBe(400);
  });
});

describe('reviewTranscript', () => {
  const review = (body, store = makeStore()) =>
    handlers(store).reviewTranscript(makeRequest({ body }), context);

  it('publishes a transcript and stamps the approver from the guard identity', async () => {
    const store = makeStore();
    const res = await review({ id: 'article_x', status: 'published' }, store);

    expect(res.status).toBe(200);
    expect(store.patchDoc).toHaveBeenCalledWith(
      TRANSCRIPT_CONTAINER,
      'article_x',
      { status: 'published', approvedAt: NOW.toISOString(), approvedBy: 'oid-1' },
      { partitionKey: 'article_x' }
    );
    expect(JSON.parse(res.body)).toMatchObject({ success: true, id: 'article_x', status: 'published' });
  });

  it('returns a transcript to draft, clearing the stamp', async () => {
    const store = makeStore();
    await review({ id: 'article_x', status: 'draft' }, store);
    expect(store.patchDoc.mock.calls[0][2]).toEqual({
      status: 'draft',
      approvedAt: null,
      approvedBy: null,
    });
  });

  it('refuses "failed", which belongs to the generator, and any unknown status', async () => {
    const store = makeStore();
    const res = await review({ id: 'article_x', status: 'failed' }, store);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/status must be "published" or "draft"/);
    expect((await review({ id: 'article_x', status: 'archived' })).status).toBe(400);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('400s a missing id and a body that is not a JSON object', async () => {
    expect((await review({ status: 'published' })).status).toBe(400);
    expect((await handlers(makeStore()).reviewTranscript(makeRequest(), context)).status).toBe(400);
  });

  it('500s a store failure rather than reporting a change that did not happen', async () => {
    const store = makeStore({
      patchDoc: vi.fn(async () => {
        throw new Error('cosmos down');
      }),
    });
    const res = await review({ id: 'article_x', status: 'published' }, store);
    expect(res.status).toBe(500);
    expect(res.body).not.toContain('cosmos down');
  });
});
