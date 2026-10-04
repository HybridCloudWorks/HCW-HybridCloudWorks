/**
 * Listen & Learn data access.
 *
 * The assertion that matters most is structural: there is no `scope`
 * parameter. Upstream carried one, and a public query that forgot to append
 * `status == 'published'` was rejected by a Firestore rule and rendered the
 * study-podcast section empty with no visible error. Here the public read is a
 * different function against a different, anonymous endpoint that cannot
 * return a draft — so the mistake has nowhere to live.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({ getJSON: vi.fn(), postJSON: vi.fn(), sendJSON: vi.fn() }));
vi.mock('@/lib/publicApi', () => ({ fetchPublicListenAndLearn: vi.fn() }));
vi.mock('@/lib/jobs', () => ({ runJob: vi.fn() }));

const { getJSON, postJSON } = await import('@/lib/api');
const { fetchPublicListenAndLearn } = await import('@/lib/publicApi');
const { runJob } = await import('@/lib/jobs');
const {
  SUPPORTED_PLATFORMS,
  fetchPublishedEpisodes,
  fetchSetForReview,
  fetchSets,
  generateEpisodes,
  isSupportedPlatform,
  reviewEpisode,
  setIdFor,
} = await import('./listenAndLearn.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platform support', () => {
  it('mirrors the server list, so a page never offers an unsupported platform', () => {
    expect(SUPPORTED_PLATFORMS).toEqual(['azure', 'github', 'aws']);
    expect(isSupportedPlatform('AZURE')).toBe(true);
    expect(isSupportedPlatform('github')).toBe(true);
    expect(isSupportedPlatform('vmware')).toBe(false);
    expect(isSupportedPlatform(undefined)).toBe(false);
  });

  it('builds the same set id the server does', () => {
    expect(setIdFor('AZURE', 'AZ-104')).toBe('azure_az-104');
    expect(setIdFor('', '')).toBe('_');
  });
});

describe('the public read cannot be asked for a draft', () => {
  it('goes through the anonymous endpoint, which filters server-side', async () => {
    fetchPublicListenAndLearn.mockResolvedValue({ set: { id: 'azure_az-104' }, episodes: [] });
    const result = await fetchPublishedEpisodes({ platform: 'azure', examCode: 'AZ-104' });

    expect(fetchPublicListenAndLearn).toHaveBeenCalledWith({
      platform: 'azure',
      examCode: 'AZ-104',
    });
    expect(result.episodes).toEqual([]);
    // Never reaches an authenticated route: the public page has no token.
    expect(getJSON).not.toHaveBeenCalled();
  });

  it('takes no scope or status argument that a caller could get wrong', () => {
    // fetchPublishedEpisodes({platform, examCode}) — one object, two keys.
    // If this signature grows a `scope`, the upstream bug is back.
    expect(fetchPublishedEpisodes.length).toBeLessThanOrEqual(1);
  });

  it('returns null for a certification that was never generated', async () => {
    fetchPublicListenAndLearn.mockResolvedValue(null);
    expect(await fetchPublishedEpisodes({ platform: 'azure', examCode: 'AZ-900' })).toBeNull();
  });
});

describe('admin reads', () => {
  it('lists sets from the editor-gated route', async () => {
    getJSON.mockResolvedValue({ items: [{ id: 'azure_az-104' }] });
    expect(await fetchSets()).toEqual([{ id: 'azure_az-104' }]);
    expect(getJSON).toHaveBeenCalledWith('cms/listen-and-learn');
  });

  it('tolerates a response with no items rather than throwing on .map', async () => {
    getJSON.mockResolvedValue({});
    expect(await fetchSets()).toEqual([]);
  });

  it('encodes the path segments of a review read', async () => {
    getJSON.mockResolvedValue({ set: null, episodes: [] });
    await fetchSetForReview({ platform: 'azure', examCode: 'AZ 104/x' });
    expect(getJSON).toHaveBeenCalledWith('cms/listen-and-learn/azure/AZ%20104%2Fx');
  });

  it('defaults a missing set and episode list', async () => {
    getJSON.mockResolvedValue({});
    expect(await fetchSetForReview({ platform: 'azure', examCode: 'AZ-104' })).toEqual({
      set: null,
      episodes: [],
    });
  });
});

describe('review', () => {
  it('posts the target and the new status', async () => {
    postJSON.mockResolvedValue({ success: true });
    await reviewEpisode({
      platform: 'azure',
      examCode: 'AZ-104',
      areaSlug: 'area-1',
      status: 'published',
    });

    expect(postJSON).toHaveBeenCalledWith('cms/listen-and-learn/review', {
      platform: 'azure',
      examCode: 'AZ-104',
      areaSlug: 'area-1',
      status: 'published',
    });
  });
});

describe('generation runs as a job', () => {
  it('enqueues the job type rather than calling an HTTP handler', async () => {
    // A run is minutes long; an HTTP response is bounded at 230 seconds.
    runJob.mockResolvedValue({ status: 'succeeded', result: { generated: 5 } });
    await generateEpisodes({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://learn.microsoft.com/az-104',
    });

    const [[type, payload, options]] = runJob.mock.calls;
    expect(type).toBe('generate-listen-and-learn');
    expect(payload).toEqual({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://learn.microsoft.com/az-104',
    });
    // Longer than the server's own 25-minute ceiling, so a timeout here
    // reports the job's outcome instead of pre-empting it.
    expect(options.maxWaitMs).toBeGreaterThan(25 * 60 * 1000);
  });

  it('omits optional fields rather than sending empty strings', async () => {
    runJob.mockResolvedValue({});
    await generateEpisodes({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://x',
      certTitle: '',
      certSlug: '',
      areas: [],
    });

    const [[, payload]] = runJob.mock.calls;
    expect(payload).not.toHaveProperty('certTitle');
    expect(payload).not.toHaveProperty('certSlug');
    expect(payload).not.toHaveProperty('areas');
  });

  it('carries the per-run voice model only when one was chosen — "Stored default" sends none', async () => {
    // The worker reads the stored default when the payload names no model
    // (speech-settings.js); a blank string would be refused there, and an
    // omitted field is what "Stored default" means (Copilot on #462).
    runJob.mockResolvedValue({});
    const base = { platform: 'azure', examCode: 'AZ-104', studyGuideUrl: 'https://x' };
    await generateEpisodes({ ...base, ttsModel: '' });
    await generateEpisodes({ ...base, ttsModel: undefined });
    await generateEpisodes({ ...base, ttsModel: 'gemini-2.5-flash-preview-tts' });

    expect(runJob.mock.calls[0][1]).not.toHaveProperty('ttsModel');
    expect(runJob.mock.calls[1][1]).not.toHaveProperty('ttsModel');
    expect(runJob.mock.calls[2][1]).toMatchObject({ ttsModel: 'gemini-2.5-flash-preview-tts' });
  });

  it('passes the optional fields through when they are set', async () => {
    runJob.mockResolvedValue({});
    await generateEpisodes({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://x',
      certTitle: 'Azure Administrator',
      certSlug: 'az-104',
      areas: ['area-1'],
    });

    expect(runJob.mock.calls[0][1]).toMatchObject({
      certTitle: 'Azure Administrator',
      certSlug: 'az-104',
      areas: ['area-1'],
    });
  });

  it('forwards the progress callback so a partial run is visible', async () => {
    runJob.mockResolvedValue({});
    const onUpdate = vi.fn();
    await generateEpisodes({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://x',
      onUpdate,
    });

    expect(runJob.mock.calls[0][2].onUpdate).toBe(onUpdate);
  });

  it('forwards the acceptance callback, which is where the speech estimate arrives', async () => {
    runJob.mockResolvedValue({});
    const onAccepted = vi.fn();
    await generateEpisodes({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://x',
      onAccepted,
    });

    expect(runJob.mock.calls[0][2].onAccepted).toBe(onAccepted);
  });
});

describe('the Audio Library calls (ADR 0033 §4)', async () => {
  const lib = await import('./listenAndLearn.js');
  const { sendJSON } = await import('@/lib/api');
  const key = { platform: 'azure', examCode: 'AZ-104' };

  it('offers only the platforms with a public page to play a course on, and says why GitHub is missing', () => {
    expect(lib.GENERATE_PLATFORMS).toEqual(['azure', 'aws']);
    expect(lib.GITHUB_GENERATE_NOTE).toMatch(/GitHub/);
    expect(lib.SUPPORTED_PLATFORMS).toContain('github');
  });

  it('lists books, archived ones only when asked', async () => {
    getJSON.mockResolvedValue({ items: [{ id: 'a' }] });
    expect(await lib.fetchBooks()).toEqual([{ id: 'a' }]);
    expect(getJSON).toHaveBeenLastCalledWith('cms/listen-and-learn');
    await lib.fetchBooks({ archived: true });
    expect(getJSON).toHaveBeenLastCalledWith('cms/listen-and-learn?archived=1');
  });

  it('creates, patches and soft-deletes a book through its route, with force as a query', async () => {
    postJSON.mockResolvedValue({ item: { id: 'azure_x' } });
    expect(await lib.createBook({ provider: 'azure', title: 'X' })).toEqual({ id: 'azure_x' });
    expect(postJSON).toHaveBeenCalledWith('cms/listen-and-learn', {
      provider: 'azure',
      title: 'X',
    });

    sendJSON.mockResolvedValue({ item: { id: 'azure_az-104', title: 'Renamed' } });
    expect(await lib.patchBook(key, { title: 'Renamed' })).toEqual({
      id: 'azure_az-104',
      title: 'Renamed',
    });
    expect(sendJSON).toHaveBeenCalledWith('cms/listen-and-learn/azure/AZ-104', 'PATCH', {
      title: 'Renamed',
    });

    sendJSON.mockResolvedValue({ success: true });
    await lib.deleteBook(key);
    expect(sendJSON).toHaveBeenLastCalledWith('cms/listen-and-learn/azure/AZ-104', 'DELETE');
    await lib.deleteBook(key, { force: true });
    expect(sendJSON).toHaveBeenLastCalledWith(
      'cms/listen-and-learn/azure/AZ-104?force=1',
      'DELETE'
    );
  });

  it('creates, patches, reorders and deletes chapters, and deletes one version', async () => {
    postJSON.mockResolvedValue({ item: { id: 'manual_x' }, job: null });
    await lib.createChapter(key, { title: 'X', sourceText: 'Hi' });
    expect(postJSON).toHaveBeenCalledWith('cms/listen-and-learn/azure/AZ-104/chapters', {
      title: 'X',
      sourceText: 'Hi',
    });

    sendJSON.mockResolvedValue({ item: { id: 'manual_x', order: 2 } });
    await lib.patchChapter({ ...key, chapterId: 'manual_x' }, { order: 2 });
    expect(sendJSON).toHaveBeenLastCalledWith(
      'cms/listen-and-learn/azure/AZ-104/chapters/manual_x',
      'PATCH',
      { order: 2 }
    );

    await lib.reorderChapters(key, ['b', 'a']);
    expect(sendJSON).toHaveBeenLastCalledWith(
      'cms/listen-and-learn/azure/AZ-104/chapters',
      'PATCH',
      {
        order: ['b', 'a'],
      }
    );

    await lib.deleteChapter({ ...key, chapterId: 'manual_x' }, { force: true });
    expect(sendJSON).toHaveBeenLastCalledWith(
      'cms/listen-and-learn/azure/AZ-104/chapters/manual_x?force=1',
      'DELETE'
    );

    await lib.deleteVersion({ ...key, chapterId: 'manual_x', versionId: '20261003140509' });
    expect(sendJSON).toHaveBeenLastCalledWith(
      'cms/listen-and-learn/azure/AZ-104/chapters/manual_x/versions/20261003140509',
      'DELETE'
    );
  });

  it('regenerates one chapter as a job enqueued through its own route, so a 400 is the route’s sentence', async () => {
    runJob.mockResolvedValue({ status: 'succeeded' });
    postJSON.mockResolvedValue({ ok: true, jobId: 'j' });
    const onAccepted = vi.fn();
    await lib.regenerateChapter(
      { ...key, chapterId: 'area-1', ttsModel: 'gemini-2.5-flash-preview-tts' },
      { onAccepted }
    );
    const [, payload, options] = runJob.mock.calls.at(-1);
    expect(payload).toEqual({ ttsModel: 'gemini-2.5-flash-preview-tts' });
    expect(options.onAccepted).toBe(onAccepted);
    await options.fetchers.enqueue({ payload });
    expect(postJSON).toHaveBeenCalledWith(
      'cms/listen-and-learn/azure/AZ-104/chapters/area-1/regenerate',
      payload
    );
  });

  it('follows a job another call already queued without enqueueing again', async () => {
    runJob.mockResolvedValue({ status: 'succeeded' });
    const accepted = { ok: true, jobId: 'j-2', type: 'speak-listen-and-learn-chapter' };
    await lib.followJob(accepted);
    const [type, , options] = runJob.mock.calls.at(-1);
    expect(type).toBe('speak-listen-and-learn-chapter');
    expect(await options.fetchers.enqueue()).toBe(accepted);
  });

  it('prices text by the book when one is named', async () => {
    postJSON.mockResolvedValue({ estimatedCostUsd: 0.01 });
    await lib.estimateSpeech({ text: 'Hello', ...key });
    expect(postJSON).toHaveBeenCalledWith('cms/listen-and-learn/estimate', {
      text: 'Hello',
      platform: 'azure',
      examCode: 'AZ-104',
    });
    await lib.estimateSpeech({ bytes: 9000 });
    expect(postJSON).toHaveBeenLastCalledWith('cms/listen-and-learn/estimate', { bytes: 9000 });
  });
});
