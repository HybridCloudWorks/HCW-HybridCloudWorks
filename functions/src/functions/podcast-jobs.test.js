/**
 * Generation payload validation and the job's registration.
 *
 * The pipeline itself is tested in lib/podcast/generate.test.js; this pins
 * the thin adapter — what the worker accepts, and that it registers at the
 * role of the route that enqueues it.
 */
import { describe, it, expect, vi } from 'vitest';

// The module registers a job type on import, and registerJobType throws on a
// duplicate — so the registry is faked rather than shared across test files.
const registerJobType = vi.fn();
vi.mock('../lib/jobs.js', async (importOriginal) => ({
  ...(await importOriginal()),
  registerJobType: (...args) => registerJobType(...args),
}));
const readDoc = vi.fn();
const patchDoc = vi.fn();
vi.mock('../lib/cosmos-client.js', () => ({
  readDoc: (...args) => readDoc(...args),
  upsertDoc: vi.fn(),
  patchDoc: (...args) => patchDoc(...args),
}));
vi.mock('../lib/blob-storage.js', () => ({ uploadBlob: vi.fn(), readBlobForDelivery: vi.fn(), deleteBlob: vi.fn() }));
vi.mock('../lib/ai/router.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateJsonResponse: vi.fn(),
  getCostEstimate: vi.fn(),
}));
vi.mock('../lib/cms/publish.js', () => ({ publicUrlOf: vi.fn(() => '') }));

const {
  parsePublishPayload,
  parseTranscriptPayload,
  runTranscriptGeneration,
  runTranscriptPublish,
  runRecordingGeneration,
  runUploadTranscription,
} = await import('./podcast-jobs.js');

describe('parseTranscriptPayload', () => {
  it('accepts an article id and trims it', () => {
    expect(parseTranscriptPayload({ articleId: ' content-1 ' })).toEqual({
      value: { articleId: 'content-1' },
    });
  });

  it('refuses a missing, blank, non-string or oversized id without throwing', () => {
    expect(parseTranscriptPayload(undefined).error).toBe('articleId is required');
    expect(parseTranscriptPayload({}).error).toBe('articleId is required');
    expect(parseTranscriptPayload({ articleId: '  ' }).error).toBe('articleId is required');
    expect(parseTranscriptPayload({ articleId: 42 }).error).toBe('articleId is required');
    expect(parseTranscriptPayload({ articleId: 'x'.repeat(201) }).error).toBe('articleId is too long');
  });
});

describe('runTranscriptGeneration', () => {
  it('fails a bad payload with the validation message before touching anything', async () => {
    await expect(runTranscriptGeneration({}, { context: { log: vi.fn() } })).rejects.toThrow(
      'articleId is required'
    );
  });
});

describe('parsePublishPayload', () => {
  it('accepts a transcript id and trims it; refuses the rest without throwing', () => {
    expect(parsePublishPayload({ transcriptId: ' article_x ' })).toEqual({
      value: { transcriptId: 'article_x' },
    });
    expect(parsePublishPayload(undefined).error).toBe('transcriptId is required');
    expect(parsePublishPayload({ transcriptId: 7 }).error).toBe('transcriptId is required');
    // Bounded by UTF-8 bytes (Cosmos's 1,023), so a wide-character id of
    // fewer characters is refused too.
    expect(parsePublishPayload({ transcriptId: 'x'.repeat(1024) }).error).toBe(
      'transcriptId is too long'
    );
    expect(parsePublishPayload({ transcriptId: '語'.repeat(400) }).error).toBe(
      'transcriptId is too long'
    );
  });
});

describe('runTranscriptPublish', () => {
  it('fails a bad payload with the validation message before touching anything', async () => {
    readDoc.mockClear();
    await expect(runTranscriptPublish({}, { context: { log: vi.fn() } })).rejects.toThrow(
      'transcriptId is required'
    );
    expect(readDoc).not.toHaveBeenCalled();
  });

  it('records a skip on the document with no key seeded, and reports it — never an error', async () => {
    // No RSSCOM_* in this process: the client reports not configured, the
    // job stores `skipped` and succeeds. Approval stays exactly as written.
    vi.stubEnv('RSSCOM_API_KEY', '');
    vi.stubEnv('RSSCOM_PODCAST_ID', '');
    readDoc.mockReset();
    patchDoc.mockReset();
    readDoc.mockResolvedValue({
      id: 'article_x',
      status: 'published',
      audioPath: 'article/x.mp3',
      host: { rsscom: { pending: true, jobId: 'job-1' } },
    });
    patchDoc.mockResolvedValue({});
    const context = { log: vi.fn(), warn: vi.fn() };

    const report = await runTranscriptPublish({ transcriptId: 'article_x' }, { context });

    expect(report).toMatchObject({ id: 'article_x', skipped: 'not_configured', error: null });
    expect(patchDoc).toHaveBeenCalledTimes(1);
    const [container, id, patch] = patchDoc.mock.calls[0];
    expect(container).toBe('podcast_transcripts');
    expect(id).toBe('article_x');
    expect(Object.keys(patch)).toEqual(['host']);
    expect(patch.host.rsscom).toMatchObject({ skipped: 'not_configured', error: null });
    expect(patch.host.rsscom).not.toHaveProperty('pending');
    expect(context.log.mock.calls[0][0]).toMatch(/skipped \(not_configured\)/);
    vi.unstubAllEnvs();
  });
});

describe('registration', () => {
  it('registers generate-podcast-transcript at editor, the role of the route that enqueues it', () => {
    const [type, spec] = registerJobType.mock.calls.find(
      ([name]) => name === 'generate-podcast-transcript'
    );
    expect(type).toBe('generate-podcast-transcript');
    expect(spec.role).toBe('editor');
    expect(typeof spec.worker).toBe('function');
    // One article id; a payload larger than this is not one.
    expect(spec.maxPayloadBytes).toBeLessThanOrEqual(1024);
  });

  it('registers publish-podcast-transcript at publisher, the role of review and the retry', () => {
    const [type, spec] = registerJobType.mock.calls.find(
      ([name]) => name === 'publish-podcast-transcript'
    );
    expect(type).toBe('publish-podcast-transcript');
    expect(spec.role).toBe('publisher');
    expect(spec.worker).toBe(runTranscriptPublish);
    expect(spec.maxPayloadBytes).toBeLessThanOrEqual(1024);
    // Above the client's own deadlines (30 s + 300 s + 30 s), so a slow host
    // is recorded as the client's error rather than as a job timeout.
    expect(spec.timeoutMs).toBeGreaterThan(360_000);
    expect(typeof spec.onComplete).toBe('function');
  });

  it('clears the pending marker when the publish job dies around the step, and stays quiet on success', async () => {
    const [, spec] = registerJobType.mock.calls.find(
      ([name]) => name === 'publish-podcast-transcript'
    );
    const now = () => new Date('2026-09-09T10:00:00.000Z');
    readDoc.mockReset();
    patchDoc.mockReset();
    readDoc.mockResolvedValue({
      id: 'article_x',
      status: 'published',
      host: { rsscom: { pending: true, jobId: 'job-1' } },
    });
    patchDoc.mockResolvedValue({});

    await spec.onComplete(
      { job: { payload: { transcriptId: 'article_x' } }, status: 'timeout', error: 'job timed out' },
      { context: {}, now }
    );
    expect(patchDoc).toHaveBeenCalledTimes(1);
    expect(patchDoc.mock.calls[0][2].host.rsscom).toEqual({
      lastAttemptAt: '2026-09-09T10:00:00.000Z',
      error: { status: null, code: 'JOB_TIMEOUT', message: 'job timed out', retryable: true },
    });

    patchDoc.mockClear();
    await spec.onComplete(
      { job: { payload: { transcriptId: 'article_x' } }, status: 'succeeded', error: null },
      { context: {}, now }
    );
    expect(patchDoc).not.toHaveBeenCalled();
  });
  it('registers the two recording-side jobs (#442) at editor, like the routes that enqueue them', () => {
    for (const name of ['generate-podcast-transcript-from-recording', 'transcribe-recording-upload']) {
      const [, spec] = registerJobType.mock.calls.find(([type]) => type === name);
      expect(spec.role, name).toBe('editor');
      expect(typeof spec.worker, name).toBe('function');
      expect(spec.maxPayloadBytes, name).toBeLessThanOrEqual(1024);
    }
  });
});

describe('recording-side workers', () => {
  it('fail a bad payload with the validation sentence before touching anything', async () => {
    const ctx = { context: { log: vi.fn() } };
    await expect(runRecordingGeneration({}, ctx)).rejects.toThrow(
      'recordingId or storedRecordingId is required'
    );
    await expect(runRecordingGeneration({ recordingId: 'a', storedRecordingId: 'b' }, ctx)).rejects.toThrow(
      /not both/
    );
    await expect(runUploadTranscription({ title: 't' }, ctx)).rejects.toThrow('uploadPath is required');
    await expect(runUploadTranscription({ uploadPath: 'article/x.mp3', title: 't' }, ctx)).rejects.toThrow(
      'uploadPath is not an upload path'
    );
  });
});
