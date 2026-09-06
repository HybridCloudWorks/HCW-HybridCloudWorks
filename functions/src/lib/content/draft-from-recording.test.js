import { describe, it, expect, vi } from 'vitest';
import {
  createRecordingDrafter,
  createContentFromRecordingHandler,
  parseRecordingRequest,
  inferProviderFromRecording,
  RECORDING_CONTENT_TYPES,
  MIN_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_CHARS,
} from './draft-from-recording.js';
import { createContentDocument } from '../cms/content-create.js';

const NOW = new Date('2026-09-06T12:00:00.000Z');
const now = () => NOW;
const TRANSCRIPT =
  'So today we are talking about Azure landing zones and why the hub and spoke '.repeat(8);

function memStore(containers = {}) {
  const data = Object.fromEntries(
    Object.entries(containers).map(([k, v]) => [k, new Map(v.map((d) => [d.id, d]))])
  );
  const get = (c) => (data[c] ||= new Map());
  return {
    data,
    readDoc: vi.fn(async (c, id) => get(c).get(id) || null),
    upsertDoc: vi.fn(async (c, doc) => {
      get(c).set(doc.id, doc);
      return doc;
    }),
    patchDoc: vi.fn(async (c, id, u) => {
      const next = { ...(get(c).get(id) || { id }), ...u };
      get(c).set(id, next);
      return next;
    }),
    // findDuplicateContent queries content; an empty result = no duplicate.
    queryDocs: vi.fn(async () => []),
  };
}

const recording = {
  id: 'rec-1',
  title: 'Landing zones, live',
  transcript: TRANSCRIPT,
  status: 'new',
};

const goodDraft = {
  title: 'Why hub and spoke still wins',
  summary: 'A summary.',
  postContent: '## Heading\n\nBody text long enough to be a draft.\n\n## TL;DR\n\n- point',
  summaryPrompt: 'sp',
  detailsPrompt: 'dp',
  keyTopics: ['azure', 'landing zones'],
  suggestedContentType: 'blog',
  aiProvider: 'gemini',
  aiModel: null,
  format: 'deep-dive',
};

const request = (body, headers = {}) => ({
  json: async () => body,
  headers: new Map(Object.entries(headers)),
  params: {},
});
const allowGuard = { requireRole: vi.fn(async () => ({ user: { email: 'ed@hcw.test' } })) };
const denyGuard = {
  requireRole: vi.fn(async () => ({ error: { status: 401, body: '{"error":"no"}' } })),
};
const parse = (res) => ({ status: res.status, body: JSON.parse(res.body) });

describe('parseRecordingRequest', () => {
  it('requires an identifier-shaped recordingId and a known contentType', () => {
    expect(() => parseRecordingRequest(null)).toThrow(/JSON body/);
    expect(() => parseRecordingRequest({ contentType: 'blog_post' })).toThrow(/recordingId/);
    expect(() => parseRecordingRequest({ recordingId: 'a b', contentType: 'blog_post' })).toThrow(
      /identifier/
    );
    expect(() => parseRecordingRequest({ recordingId: 'rec-1', contentType: 'tweet' })).toThrow(
      /contentType must be one of/
    );
    const ok = parseRecordingRequest({
      recordingId: 'rec-1',
      contentType: 'podcast_notes',
      title: ' T ',
      provider: 'gemini',
      transcript: 'x',
    });
    expect(ok).toEqual({
      recordingId: 'rec-1',
      title: 'T',
      transcript: 'x',
      contentType: 'podcast_notes',
      requestedProvider: 'gemini',
      cloudProvider: '',
    });
    // Every dropdown value in RecordingsPage.jsx is a contract key.
    expect(Object.keys(RECORDING_CONTENT_TYPES).sort()).toEqual(
      ['blog_post', 'linkedin_post', 'meeting_summary', 'podcast_notes', 'technical_guide'].sort()
    );
  });

  it('infers the cloud provider from the title and transcript, explicit value first', () => {
    expect(inferProviderFromRecording({ title: 'x', transcript: TRANSCRIPT })).toBe('Azure');
    expect(
      inferProviderFromRecording({ title: 'GitHub Actions deep dive', transcript: 'hi' })
    ).toBe('Github');
    expect(inferProviderFromRecording({ title: 'Lunch', transcript: 'nothing cloudy' })).toBe(
      'Multi'
    );
    expect(
      inferProviderFromRecording({ cloudProvider: 'Aws', title: 'Azure', transcript: '' })
    ).toBe('Aws');
  });
});

describe('createContentFromRecording', () => {
  function build({ store, drafter, persist = createContentDocument, budgetMs } = {}) {
    const s = store || memStore({ recordings: [recording] });
    const d = drafter || { generateDraft: vi.fn(async () => goodDraft) };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = createContentFromRecordingHandler({
      guard: allowGuard,
      recordingDrafter: createRecordingDrafter({
        drafter: d,
        store: s,
        persist,
        now,
        uuid: () => 'content-uuid-1',
        log,
      }),
      budgetMs,
    });
    return { store: s, drafter: d, handler, log };
  }
  const ctx = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };

  it('drafts through the shared drafter, persists through createContentDocument, links the recording', async () => {
    const { store, drafter, handler } = build();
    const res = parse(
      await handler(
        request({
          recordingId: 'rec-1',
          transcript: TRANSCRIPT,
          title: 'Landing zones, live',
          contentType: 'technical_guide',
          provider: 'gemini',
        }),
        ctx
      )
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      contentId: 'content-uuid-1',
      draft: {
        title: 'Why hub and spoke still wins',
        aiProvider: 'gemini',
        cloudProvider: 'Azure',
      },
    });

    // The drafter got the transcript as the source and the type's instructions.
    const call = drafter.generateDraft.mock.calls[0][0];
    expect(call.markdown).toBe(TRANSCRIPT.trim());
    expect(call.url).toBe('recording:rec-1');
    expect(call.cloudProvider).toBe('Azure');
    expect(call.customInstructionPrompt).toBe(RECORDING_CONTENT_TYPES.technical_guide.instructions);

    // The document is the createContentItem shape, not a private one.
    const doc = store.data.content.get('content-uuid-1');
    expect(doc).toMatchObject({
      id: 'content-uuid-1',
      type: 'blog',
      publishTarget: expect.any(String),
      Title: 'Why hub and spoke still wins',
      postContent: expect.stringContaining('## Heading'),
      contentStatus: 'draft',
      storageCollection: 'content',
      source: 'recording',
      sourceRecordingId: 'rec-1',
      recordingContentType: 'technical_guide',
      requestedAiProvider: 'gemini',
      aiProvider: 'gemini',
      'Cloud Provider': 'Azure',
      createdBy: 'ed@hcw.test',
      'Created At': NOW.toISOString(),
    });
    expect(doc.contentQuality).toBeDefined();
    expect(doc.imageReadiness).toBeDefined();
    expect(doc.titleNormalized ?? doc.dedupTitle ?? true).toBeTruthy();

    // The link back, server-side.
    expect(store.data.recordings.get('rec-1')).toMatchObject({
      status: 'routed',
      contentId: 'content-uuid-1',
      routedAt: NOW.toISOString(),
      routedContentType: 'technical_guide',
    });
  });

  it('falls back to the stored transcript and title when the request omits them', async () => {
    const { drafter, handler } = build();
    const res = parse(
      await handler(request({ recordingId: 'rec-1', contentType: 'meeting_summary' }), ctx)
    );
    expect(res.status).toBe(200);
    expect(drafter.generateDraft.mock.calls[0][0].markdown).toBe(TRANSCRIPT.trim());
    expect(drafter.generateDraft.mock.calls[0][0].scrapedTitle).toBe('Landing zones, live');
  });

  it('refuses without the editor role, before reading the body', async () => {
    const drafter = { generateDraft: vi.fn() };
    const handler = createContentFromRecordingHandler({
      guard: denyGuard,
      recordingDrafter: createRecordingDrafter({
        drafter,
        store: memStore(),
        persist: createContentDocument,
      }),
    });
    const res = await handler(request({ recordingId: 'rec-1', contentType: 'blog_post' }), ctx);
    expect(res.status).toBe(401);
    expect(drafter.generateDraft).not.toHaveBeenCalled();
  });

  it('maps input, lookup and size failures to 400 / 404 / 422 / 413 without calling the model', async () => {
    const { drafter, handler, store } = build();
    expect(parse(await handler(request({ recordingId: 'rec-1' }), ctx)).status).toBe(400);
    expect(parse(await handler(request(null), ctx)).status).toBe(400);
    expect(
      parse(await handler(request({ recordingId: 'missing', contentType: 'blog_post' }), ctx))
        .status
    ).toBe(404);
    expect(
      parse(
        await handler(
          request({ recordingId: 'rec-1', contentType: 'blog_post', transcript: 'too short' }),
          ctx
        )
      )
    ).toMatchObject({ status: 422, body: { code: 'TRANSCRIPT_TOO_SHORT' } });
    expect(
      parse(
        await handler(
          request({
            recordingId: 'rec-1',
            contentType: 'blog_post',
            transcript: 'a'.repeat(MAX_TRANSCRIPT_CHARS + 1),
          }),
          ctx
        )
      )
    ).toMatchObject({ status: 413, body: { code: 'TRANSCRIPT_TOO_LONG' } });
    expect(drafter.generateDraft).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(MIN_TRANSCRIPT_CHARS).toBeLessThan(TRANSCRIPT.length);
  });

  it('reports a disabled or unconfigured AI feature as 503, a timeout as 504, anything else as 502', async () => {
    const disabled = new Error("The 'forgeDrafting' AI feature is turned off in the admin portal.");
    disabled.code = 'AI_FEATURE_DISABLED';
    let r = build({
      drafter: {
        generateDraft: vi.fn(async () => {
          throw disabled;
        }),
      },
    });
    expect(
      parse(await r.handler(request({ recordingId: 'rec-1', contentType: 'blog_post' }), ctx))
    ).toMatchObject({ status: 503, body: { code: 'AI_FEATURE_DISABLED' } });
    expect(r.store.patchDoc).not.toHaveBeenCalled();

    const unconfigured = new Error('no key');
    unconfigured.code = 'AI_NOT_CONFIGURED';
    r = build({
      drafter: {
        generateDraft: vi.fn(async () => {
          throw unconfigured;
        }),
      },
    });
    expect(
      parse(await r.handler(request({ recordingId: 'rec-1', contentType: 'blog_post' }), ctx))
        .status
    ).toBe(503);

    r = build({
      drafter: { generateDraft: vi.fn(() => new Promise(() => {})) },
      budgetMs: 20,
    });
    expect(
      parse(await r.handler(request({ recordingId: 'rec-1', contentType: 'blog_post' }), ctx))
    ).toMatchObject({ status: 504, body: { code: 'DRAFT_BUDGET_EXCEEDED' } });

    r = build({
      drafter: {
        generateDraft: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
    });
    expect(
      parse(await r.handler(request({ recordingId: 'rec-1', contentType: 'blog_post' }), ctx))
    ).toMatchObject({ status: 502, body: { code: 'GENERATION_FAILED', error: 'boom' } });
  });

  it('surfaces the persistence path’s own verdicts (409 duplicate) and does not link the recording', async () => {
    const persist = vi.fn(async () => ({
      status: 409,
      body: { success: false, error: 'Duplicate content detected', existingId: 'c-old' },
    }));
    const { handler, store } = build({ persist });
    const res = parse(
      await handler(request({ recordingId: 'rec-1', contentType: 'blog_post' }), ctx)
    );
    expect(res).toMatchObject({
      status: 409,
      body: { code: 'PERSIST_REJECTED', details: { existingId: 'c-old' } },
    });
    expect(store.patchDoc).not.toHaveBeenCalled();
    // The persistence call carried the shared write path's contract.
    expect(persist.mock.calls[0][0]).toMatchObject({
      runEditorialCritique: false,
      user: { email: 'ed@hcw.test' },
      data: { source: 'recording', contentStatus: 'draft' },
    });
  });

  it('treats an empty model answer as a generation failure, not a blank draft', async () => {
    const { handler, store } = build({
      drafter: { generateDraft: vi.fn(async () => ({ ...goodDraft, postContent: '   ' })) },
    });
    const res = parse(
      await handler(request({ recordingId: 'rec-1', contentType: 'blog_post' }), ctx)
    );
    expect(res).toMatchObject({ status: 502, body: { code: 'DRAFT_EMPTY' } });
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });
});
