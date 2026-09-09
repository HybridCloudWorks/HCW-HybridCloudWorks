/**
 * The article → transcript pipeline.
 *
 * Two behaviours carry the weight: an unpublished article is refused before
 * the model is called (so a refusal costs nothing), and an audio failure of
 * any kind is recorded on the saved draft rather than thrown (so a paid
 * script is never discarded because the voice failed).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ARTICLE_CONTAINER,
  TRANSCRIPT_JOB_TYPE,
  generateTranscriptFromArticle,
  refusalFor,
} from './generate.js';
import { STATUS, TRANSCRIPT_CONTAINER } from './store.js';
import { SpeechNotConfiguredError, SpeechError } from '../listen-and-learn/speech/index.js';
import { USAGE_SOURCES } from '../ai/usage.js';

const NOW = '2026-09-08T12:00:00.000Z';

const published = (over = {}) => ({
  id: 'content-1',
  Title: 'Picking a state backend',
  slug: 'picking-a-state-backend',
  'Cloud Provider': 'Azure',
  contentStatus: 'published_blog',
  content: 'A body long enough to script from.',
  ...over,
});

const script = (over = {}) => ({
  title: 'State backends, spoken',
  summary: 'Why remote state matters.',
  keyTakeaways: ['Lock it'],
  speakers: { a: 'Maya', b: 'Elena' },
  dialogue: [{ speaker: 'Maya', text: 'Hello' }],
  byteLength: 5,
  trimmedTurns: 0,
  truncated: false,
  ...over,
});

/** In-memory Cosmos with the article seeded. */
function makeStore(articleDoc = published()) {
  const docs = {
    [ARTICLE_CONTAINER]: articleDoc ? { [articleDoc.id]: articleDoc } : {},
    [TRANSCRIPT_CONTAINER]: {},
    ai_usage: {},
  };
  return {
    docs,
    readDoc: vi.fn(async (container, id) => docs[container]?.[id] ?? null),
    upsertDoc: vi.fn(async (container, doc) => {
      docs[container] ??= {};
      docs[container][doc.id] = doc;
      return doc;
    }),
    patchDoc: vi.fn(),
  };
}

const makeStorage = () => ({ uploadBlob: vi.fn(async () => 'https://ignored') });

const makeAi = () => ({
  generateJsonResponse: vi.fn(),
  getCostEstimate: vi.fn(() => 0.01),
});

/** Deps that all succeed, so a test only has to override what it is about. */
const happyDeps = (over = {}) => ({
  // Records one model call the way the real generator does, so the usage
  // assertions see a script row beside the audio row.
  writeScript: vi.fn(async ({ usageOut }) => {
    usageOut?.push({ provider: 'anthropic', model: 'claude', promptTokens: 10, completionTokens: 20 });
    return script();
  }),
  synthesize: vi.fn(async () => ({
    audio: Buffer.from([1, 2, 3]),
    contentType: 'audio/mpeg',
    bytes: 3,
    requests: 1,
    provider: 'gemini',
    model: 'gemini-2.5-flash-preview-tts',
    estimatedSeconds: 42,
    promptTokens: 100,
    completionTokens: 900,
  })),
  ...over,
});

const run = ({ store = makeStore(), storage = makeStorage(), ai = makeAi(), deps, ...over } = {}) =>
  generateTranscriptFromArticle({
    articleId: 'content-1',
    store,
    storage,
    ai,
    env: {},
    now: NOW,
    deps: happyDeps(deps),
    ...over,
  });

describe('refusalFor', () => {
  it('names a missing article, an unpublished one, and a soft-deleted one', () => {
    expect(refusalFor(null, 'content-9')).toMatch(/content-9 was not found/);
    expect(refusalFor(published({ contentStatus: 'draft' }), 'content-1')).toMatch(
      /content-1 is not published; only published articles/
    );
    expect(refusalFor(published({ softDeletedAt: NOW }), 'content-1')).toMatch(/not published/);
    expect(refusalFor(published(), 'content-1')).toBeNull();
  });

  it('exports the job type the handler and the worker share', () => {
    expect(TRANSCRIPT_JOB_TYPE).toBe('generate-podcast-transcript');
  });
});

describe('a full run', () => {
  it('scripts, synthesises, uploads and saves one draft, then records both usage rows', async () => {
    const store = makeStore();
    const storage = makeStorage();
    const deps = happyDeps();
    const ai = makeAi();

    const report = await generateTranscriptFromArticle({
      articleId: 'content-1',
      store,
      storage,
      ai,
      env: {},
      now: NOW,
      deps,
    });

    // The generator gets the stored document and a generate that reaches the
    // router with this product's feature declared — the podcast's toggle,
    // not Listen & Learn's.
    const { article, generate } = deps.writeScript.mock.calls[0][0];
    expect(article).toMatchObject({ id: 'content-1' });
    await generate({ prompt: 'p', purpose: 'analysis' });
    expect(ai.generateJsonResponse).toHaveBeenCalledWith({
      prompt: 'p',
      purpose: 'analysis',
      feature: 'podcastScript',
    });
    expect(deps.synthesize).toHaveBeenCalledWith({
      dialogue: [{ speaker: 'Maya', text: 'Hello' }],
      env: {},
    });
    expect(storage.uploadBlob.mock.calls[0].slice(0, 2)).toEqual([
      'podcast',
      'article/picking-a-state-backend.mp3',
    ]);

    const saved = store.docs[TRANSCRIPT_CONTAINER]['article_picking-a-state-backend'];
    expect(saved).toMatchObject({
      status: STATUS.draft,
      sourceId: 'content-1',
      sourceProvider: 'azure',
      audioBytes: 3,
      speechProvider: 'gemini',
      audioError: null,
    });

    const usageRows = Object.values(store.docs.ai_usage);
    expect(usageRows.map((r) => r.source).sort()).toEqual(
      [USAGE_SOURCES.podcastScript, USAGE_SOURCES.podcastAudio].sort()
    );
    expect(USAGE_SOURCES.podcastScript).toBe('podcast:script');
    expect(USAGE_SOURCES.podcastAudio).toBe('podcast:audio');

    expect(report).toMatchObject({
      id: 'article_picking-a-state-backend',
      articleId: 'content-1',
      status: STATUS.draft,
      audioBytes: 3,
      audioError: null,
      transcriptBytes: 5,
      costUsd: 0.02,
    });
  });

  it('records the usage rows only after the transcript is saved', async () => {
    const order = [];
    const store = makeStore();
    store.upsertDoc = vi.fn(async (container, doc) => {
      order.push(container);
      return doc;
    });
    await run({ store });
    expect(order[0]).toBe(TRANSCRIPT_CONTAINER);
    expect(order.slice(1)).toEqual(['ai_usage', 'ai_usage']);
  });
});

describe('refusals cost nothing', () => {
  it('refuses an unpublished article before any model call, and writes nothing', async () => {
    const store = makeStore(published({ contentStatus: 'draft' }));
    const deps = happyDeps();
    await expect(run({ store, deps })).rejects.toThrow(/not published; only published articles/);

    expect(deps.writeScript).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('refuses a soft-deleted article the same way — audio must not resurrect retracted content', async () => {
    const store = makeStore(published({ softDeletedAt: NOW }));
    const deps = happyDeps();
    await expect(run({ store, deps })).rejects.toThrow(/not published/);
    expect(deps.writeScript).not.toHaveBeenCalled();
  });

  it('refuses a missing article by id', async () => {
    const store = makeStore(null);
    await expect(run({ store })).rejects.toThrow(/content-1 was not found/);
  });

  it('requires an article id, and bounds it, with the sentences the route uses', async () => {
    await expect(run({ articleId: '  ' })).rejects.toThrow('articleId is required');
    await expect(run({ articleId: 'x'.repeat(201) })).rejects.toThrow('articleId is too long');
  });
});

describe('audio failures degrade; the transcript is still saved', () => {
  it('no speech provider: saves the draft with audioError and no audio', async () => {
    const store = makeStore();
    const storage = makeStorage();
    const report = await run({
      store,
      storage,
      deps: {
        synthesize: vi.fn(async () => {
          throw new SpeechNotConfiguredError();
        }),
      },
    });

    const saved = store.docs[TRANSCRIPT_CONTAINER]['article_picking-a-state-backend'];
    expect(saved.status).toBe(STATUS.draft);
    expect(saved.audioUrl).toBeNull();
    expect(saved.audioError).toMatch(/speech provider/i);
    expect(storage.uploadBlob).not.toHaveBeenCalled();
    expect(report.audioError).toBe(saved.audioError);
    // No audio row when nothing was synthesised.
    expect(Object.values(store.docs.ai_usage).map((r) => r.source)).toEqual([
      USAGE_SOURCES.podcastScript,
    ]);
  });

  it('a broken provider: recorded, not thrown', async () => {
    // Unlike the Learn pipeline, which fails the area on this. The transcript
    // is the artefact and #436 re-voices it; a paid script is not discarded.
    const store = makeStore();
    const report = await run({
      store,
      deps: {
        synthesize: vi.fn(async () => {
          throw new SpeechError('TTS returned 401');
        }),
      },
    });
    expect(report.status).toBe(STATUS.draft);
    expect(report.audioError).toBe('TTS returned 401');
    expect(store.docs[TRANSCRIPT_CONTAINER]['article_picking-a-state-backend'].transcript).toHaveLength(1);
  });

  it('the blob container not existing yet: synthesised, not stored, said so', async () => {
    // Until the Terraform apply creates `podcast`, the upload answers 404.
    const store = makeStore();
    const storage = {
      uploadBlob: vi.fn(async () => {
        throw Object.assign(new Error('The specified container does not exist.'), { statusCode: 404 });
      }),
    };
    const report = await run({ store, storage });

    const saved = store.docs[TRANSCRIPT_CONTAINER]['article_picking-a-state-backend'];
    expect(saved.status).toBe(STATUS.draft);
    expect(saved.audioUrl).toBeNull();
    expect(saved.audioError).toMatch(/synthesised but not stored.*container does not exist/);
    // The synthesis happened and was paid for, so it is still attributed.
    expect(saved.speechProvider).toBe('gemini');
    expect(Object.values(store.docs.ai_usage).map((r) => r.source).sort()).toEqual(
      [USAGE_SOURCES.podcastAudio, USAGE_SOURCES.podcastScript].sort()
    );
    expect(report.audioBytes).toBe(0);
  });
});

describe('script failures', () => {
  it('records the failure on the transcript and rethrows the model error', async () => {
    const store = makeStore();
    await expect(
      run({
        store,
        deps: {
          writeScript: vi.fn(async () => {
            throw new Error('model refused');
          }),
        },
      })
    ).rejects.toThrow('model refused');

    const stored = store.docs[TRANSCRIPT_CONTAINER]['article_picking-a-state-backend'];
    expect(stored.status).toBe(STATUS.failed);
    expect(stored.error).toBe('model refused');
    expect(Object.keys(store.docs.ai_usage)).toHaveLength(0);
  });

  it('a failure record that cannot be written does not mask the model error', async () => {
    // The Cosmos container missing is the realistic case: both writes 404,
    // and the error worth reporting is the one from the model.
    const store = makeStore();
    store.upsertDoc = vi.fn(async () => {
      throw Object.assign(new Error('not found'), { code: 404 });
    });
    await expect(
      run({
        store,
        deps: {
          writeScript: vi.fn(async () => {
            throw new Error('model refused');
          }),
        },
      })
    ).rejects.toThrow('model refused');
  });

  it('a save that fails because the Cosmos container is missing is a plain, named error', async () => {
    // Not a silent success: the job fails, and the message says what to apply.
    const store = makeStore();
    store.upsertDoc = vi.fn(async (container) => {
      if (container === TRANSCRIPT_CONTAINER) {
        throw Object.assign(new Error('Resource Not Found'), { code: 404 });
      }
    });
    await expect(run({ store })).rejects.toThrow(/podcast_transcripts.*not provisioned/s);
  });
});
