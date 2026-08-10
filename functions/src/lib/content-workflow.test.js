/**
 * Content workflow write RPCs — pinned to source :3340-3564, :4635-4985,
 * :5827-5906. Load-bearing: the edit-conflict 409 works against ISO-string
 * blogEditedAt (the documented adaptation), cleared image slots become
 * deletions, unpublish only from published/approved, and schedule dates must
 * be future-valid.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createContentWorkflowHandlers,
  validateSaveEditorDraftBody,
  assertNoEditConflict,
  buildContentImageUpdates,
  buildContentImageFieldUpdates,
  editedAtMillis,
} from './content-workflow.js';

const context = { log: vi.fn(), error: vi.fn() };

const USER = { oid: 'u1', preferred_username: 'editor@hcw.dev' };
const guardAs = (role) => ({
  requireRole: vi.fn(async () => ({ user: USER, role, error: null })),
});
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = (body) => ({
  headers: { get: () => 'vitest' },
  json: async () => body ?? {},
});

function makeStore(over = {}) {
  return {
    readDoc: vi.fn(async () => ({ id: 'c1', Title: 'Existing', contentStatus: 'editing' })),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    upsertDoc: vi.fn(async (_c, d) => d),
    deleteDoc: vi.fn(async () => {}),
    ...over,
  };
}

const NOW = new Date('2026-08-07T04:00:00.000Z');
const fixed = { now: () => NOW, uuid: () => 'fixed-uuid' };

describe('helpers', () => {
  it('editedAtMillis parses ISO strings — the migrated-doc adaptation', () => {
    expect(editedAtMillis('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(editedAtMillis({ toMillis: () => 42 })).toBe(42);
    expect(editedAtMillis(undefined)).toBe(0);
    expect(editedAtMillis('junk')).toBe(0);
  });

  it('assertNoEditConflict throws on mismatch unless forced', () => {
    const data = { blogEditedAt: '2026-01-01T00:00:00.000Z' };
    const ms = Date.parse('2026-01-01T00:00:00Z');
    expect(() => assertNoEditConflict(data, ms, false)).not.toThrow();
    expect(() => assertNoEditConflict(data, ms - 1000, false)).toThrow('EDIT_CONFLICT');
    expect(() => assertNoEditConflict(data, ms - 1000, true)).not.toThrow();
    expect(() => assertNoEditConflict({}, 0, false)).not.toThrow(); // never edited
  });

  it('validateSaveEditorDraftBody enforces the source ceilings', () => {
    expect(validateSaveEditorDraftBody({ draft: 'ok', tags: 'a,b' }).ok).toBe(true);
    expect(validateSaveEditorDraftBody({ tags: Array(26).fill('t').join(',') }).error).toMatch(
      /25 entries/
    );
    expect(validateSaveEditorDraftBody({ orderedImageUrls: ['ftp://x'] }).error).toMatch(
      /http\(s\)/
    );
    expect(validateSaveEditorDraftBody({ publishedDate: 'junk' }).error).toMatch(/valid date/);
    expect(validateSaveEditorDraftBody({ authorName: '  ' }).resolvedAuthor).toBe(
      'Hybrid Cloud Works'
    );
  });

  it('image slot builders: hero fans out, cleared slots become deletions', () => {
    const updates = buildContentImageUpdates(['https://a/1.png', 'https://a/2.png'], {});
    expect(updates.heroImageUrl).toBe('https://a/1.png');
    expect(updates.contentImageUrl).toBe('https://a/1.png');
    expect(updates.secondaryImageUrls).toEqual(['https://a/2.png']);
    expect(updates.aiImageUrls).toEqual({ hero: 'https://a/1.png', secondary1: 'https://a/2.png' });

    const cleared = buildContentImageFieldUpdates(buildContentImageUpdates([], {}));
    expect('heroImageUrl' in cleared && cleared.heroImageUrl === undefined).toBe(true);
    expect('secondaryImageUrls' in cleared && cleared.secondaryImageUrls === undefined).toBe(true);
    expect(cleared.aiImageUrls).toEqual({});
  });
});

describe('saveEditorDraft', () => {
  const validBody = { contentId: 'c1', draft: 'Body text', title: 'T', tags: 'a,b' };

  it('409s a stale editor and lets force through', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', blogEditedAt: '2026-08-01T00:00:00.000Z' })),
    });
    const h = createContentWorkflowHandlers({ guard: guardAs('editor'), store, ...fixed });

    const stale = await h.saveEditorDraft(
      makeRequest({ ...validBody, expectedEditedAtMs: 0 }),
      context
    );
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body).error).toBe('EDIT_CONFLICT');
    expect(store.patchDoc).not.toHaveBeenCalled();

    const forced = await h.saveEditorDraft(
      makeRequest({ ...validBody, expectedEditedAtMs: 0, force: true }),
      context
    );
    expect(forced.status).toBe(200);
    const version = store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions')[1];
    expect(version.versionReason).toBe('draft_force_saved');
  });

  it('patches content, then writes version + audit with the source shapes', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'c1', Title: 'Old' })) });
    const h = createContentWorkflowHandlers({ guard: guardAs('editor'), store, ...fixed });
    const res = await h.saveEditorDraft(
      makeRequest({ ...validBody, expectedEditedAtMs: 0 }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ success: true, contentId: 'c1', tagCount: 2 });

    const patch = store.patchDoc.mock.calls[0][2];
    expect(patch.contentStatus).toBe('editing');
    expect(patch.blogEditedAt).toBe(NOW.toISOString());
    expect(patch.Tags).toEqual(['a', 'b']);
    expect(patch.editorAuthor).toBe('Hybrid Cloud Works');

    const audit = store.upsertDoc.mock.calls.find(([c]) => c === 'admin_audit_logs')[1];
    expect(audit.action).toBe('draft_saved');
    expect(audit.contentTitle).toBe('Old');
  });

  it('returns the marker it just wrote, so the client can save again immediately', async () => {
    // The editor polls this document every twenty seconds and sends the
    // `blogEditedAt` it last saw as `expectedEditedAtMs`. Without the marker in
    // the response, a second save inside that window still carries the
    // pre-save value and 409s the caller against their own previous write —
    // and, worse, the client had to guess which polled document was its own.
    // (TODO.md T-208)
    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'c1' })) });
    const h = createContentWorkflowHandlers({ guard: guardAs('editor'), store, ...fixed });

    const res = await h.saveEditorDraft(
      makeRequest({ ...validBody, expectedEditedAtMs: 0 }),
      context
    );

    // Identical to the persisted value, not merely present: the client compares
    // it for exact equality against what the next poll returns.
    expect(JSON.parse(res.body).blogEditedAt).toBe(store.patchDoc.mock.calls[0][2].blogEditedAt);
  });

  it('preserves a published_* status instead of demoting to editing', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', contentStatus: 'published_blog' })),
    });
    const h = createContentWorkflowHandlers({ guard: guardAs('editor'), store, ...fixed });
    await h.saveEditorDraft(makeRequest({ ...validBody, expectedEditedAtMs: 0 }), context);
    expect(store.patchDoc.mock.calls[0][2].contentStatus).toBe('published_blog');
  });
});

describe('unpublishContentToInspected', () => {
  it('only unpublishes from published/approved', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', contentStatus: 'editing' })),
    });
    const h = createContentWorkflowHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const res = await h.unpublishContentToInspected(makeRequest({ contentId: 'c1' }), context);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).allowedStatuses).toEqual(['published', 'approved']);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('normalizes legacy statuses, patches, and audits the transition', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'c1', contentStatus: 'published_news', Title: 'T' })),
    });
    const h = createContentWorkflowHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (
        await h.unpublishContentToInspected(
          makeRequest({ contentId: 'c1', reviewNotes: 'n' }),
          context
        )
      ).body
    );
    expect(body).toMatchObject({ from: 'published', to: 'inspected' });
    const patch = store.patchDoc.mock.calls[0][2];
    expect(patch).toMatchObject({
      contentStatus: 'inspected',
      Live: false,
      scheduledPublishDate: null,
    });
    expect(store.upsertDoc.mock.calls.find(([c]) => c === 'admin_audit_logs')[1].action).toBe(
      'content_unpublished'
    );
  });
});

describe('deleteContentItem / softDeleteLivePage', () => {
  it('hard delete tolerates missing docs like Firestore', async () => {
    const store = makeStore({
      deleteDoc: vi.fn(async () => {
        const err = new Error('nf');
        err.code = 404;
        throw err;
      }),
    });
    const h = createContentWorkflowHandlers({ guard: guardAs('publisher'), store, ...fixed });
    expect((await h.deleteContentItem(makeRequest({ contentId: 'gone' }), context)).status).toBe(
      200
    );
  });

  it('soft delete resolves blogId as a legacy content-id alias', async () => {
    const store = makeStore({
      readDoc: vi.fn(async (_c, id) => (id === 'legacy-1' ? { id: 'legacy-1' } : null)),
    });
    const h = createContentWorkflowHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const res = await h.softDeleteLivePage(
      makeRequest({ blogId: 'legacy-1', reason: ' old ' }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body.contentId).toBe('legacy-1');
    expect(body.softDeleteExpiresAt).toBe('2026-08-08T04:00:00.000Z'); // +24h
    const patch = store.patchDoc.mock.calls[0][2];
    expect(patch).toMatchObject({
      contentStatus: 'archived',
      Status: 'Archived',
      softDeletedAt: NOW.toISOString(),
      deletionReason: 'old',
    });
  });

  it('soft delete 404s when neither id resolves', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => null) });
    const h = createContentWorkflowHandlers({ guard: guardAs('publisher'), store, ...fixed });
    expect((await h.softDeleteLivePage(makeRequest({ contentId: 'x' }), context)).status).toBe(404);
  });
});

describe('saveContentSchedule', () => {
  it('instant publish clears the schedule; future date required otherwise', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'c1', type: 'framework' })) });
    const h = createContentWorkflowHandlers({ guard: guardAs('publisher'), store, ...fixed });

    const instant = JSON.parse(
      (await h.saveContentSchedule(makeRequest({ contentId: 'c1', instantPublish: true }), context))
        .body
    );
    expect(instant.scheduledPublishDate).toBeNull();
    expect(store.patchDoc.mock.calls[0][2]).toMatchObject({
      contentStatus: 'approved',
      publishTarget: 'framework', // resolved from the doc type
      Live: false,
      scheduledPublishDate: null,
    });

    const past = await h.saveContentSchedule(
      makeRequest({ contentId: 'c1', instantPublish: false, scheduledPublishDate: '2020-01-01' }),
      context
    );
    expect(past.status).toBe(400);

    const future = JSON.parse(
      (
        await h.saveContentSchedule(
          makeRequest({
            contentId: 'c1',
            instantPublish: false,
            scheduledPublishDate: '2026-09-01T00:00:00Z',
          }),
          context
        )
      ).body
    );
    expect(future.scheduledPublishDate).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('inspection state RPCs', () => {
  it('requestContentInspection arms the trigger; reset disarms and clears errors', async () => {
    const store = makeStore();
    const h = createContentWorkflowHandlers({ guard: guardAs('editor'), store, ...fixed });

    await h.requestContentInspection(makeRequest({ contentId: 'c1' }), context);
    expect(store.patchDoc.mock.calls[0][2]).toMatchObject({
      inspectTrigger: true,
      contentStatus: 'ingested',
    });

    await h.resetContentReviewState(makeRequest({ contentId: 'c1' }), context);
    expect(store.patchDoc.mock.calls[1][2]).toMatchObject({
      inspectTrigger: false,
      inspectError: null,
      Live: false,
      scheduledPublishDate: null,
    });
  });

  it('every handler denies with zero store calls', async () => {
    const store = makeStore();
    const h = createContentWorkflowHandlers({ guard: denyGuard, store, ...fixed });
    const reqs = [
      h.saveEditorDraft(makeRequest({ contentId: 'c1' }), context),
      h.unpublishContentToInspected(makeRequest({ contentId: 'c1' }), context),
      h.deleteContentItem(makeRequest({ contentId: 'c1' }), context),
      h.saveContentSchedule(makeRequest({ contentId: 'c1' }), context),
      h.softDeleteLivePage(makeRequest({ contentId: 'c1' }), context),
      h.requestContentInspection(makeRequest({ contentId: 'c1' }), context),
      h.resetContentReviewState(makeRequest({ contentId: 'c1' }), context),
    ];
    for (const r of reqs) expect((await r).status).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.deleteDoc).not.toHaveBeenCalled();
  });
});
