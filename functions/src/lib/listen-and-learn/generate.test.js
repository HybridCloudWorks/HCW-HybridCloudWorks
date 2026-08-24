/**
 * The generation pipeline and its persistence.
 *
 * Two behaviours carry most of the weight here:
 *
 *   1. **Partial runs are the normal outcome.** A quota that runs out on area
 *      three must leave areas one and two saved. Every assertion about failure
 *      is really an assertion that the run continued.
 *   2. **A missing speech key degrades; a broken one fails.** This is the one
 *      deliberate divergence from Site-Main, and it is what lets the feature
 *      ship before the key does — so it is pinned from both sides.
 */
import { describe, it, expect, vi } from 'vitest';
import { generateEpisodes, isSupportedPlatform, SUPPORTED_PLATFORMS } from './generate.js';
import { SpeechNotConfiguredError, SpeechError } from './speech/index.js';
import {
  AUDIO_CONTAINER,
  EPISODE_CONTAINER,
  SET_CONTAINER,
  STATUS,
  audioPath,
  saveEpisode,
  saveEpisodeFailure,
  saveSet,
  setEpisodeStatus,
  setId,
  toEpisodeDoc,
  uploadEpisodeAudio,
} from './publish.js';

const NOW = '2026-08-24T12:00:00.000Z';

const area = (n, over = {}) => ({
  name: `Area ${n}`,
  slug: `area-${n}`,
  weightLow: 20,
  weightHigh: 25,
  weightLabel: '20–25%',
  subheadings: [`Sub ${n}`],
  objectives: [`Do ${n}`],
  sections: [{ title: `Sub ${n}`, objectives: [`Do ${n}`] }],
  ...over,
});

const guide = (areas) => ({
  examCode: 'AZ-104',
  title: 'Study guide for AZ-104',
  sourceUrl: 'https://learn.microsoft.com/az-104',
  areas,
});

const script = (over = {}) => ({
  title: 'Episode title',
  summary: 'One sentence.',
  keyTakeaways: ['a', 'b'],
  speakers: { a: 'Maya', b: 'Elena' },
  dialogue: [{ speaker: 'Maya', text: 'Hello' }],
  byteLength: 5,
  trimmedTurns: 0,
  ...over,
});

/** In-memory Cosmos: two containers keyed by partition then id. */
function makeStore() {
  const docs = { [SET_CONTAINER]: {}, [EPISODE_CONTAINER]: {} };
  return {
    docs,
    readDoc: vi.fn(async (container, id) => docs[container]?.[id] ?? null),
    upsertDoc: vi.fn(async (container, doc) => {
      docs[container][doc.id] = doc;
      return doc;
    }),
    patchDoc: vi.fn(async (container, id, updates) => {
      docs[container][id] = { ...(docs[container][id] || { id }), ...updates };
      return docs[container][id];
    }),
    queryDocs: vi.fn(async () => []),
  };
}

const makeStorage = () => ({ uploadBlob: vi.fn(async () => 'https://ignored') });

const baseRun = (over = {}) => ({
  platform: 'azure',
  examCode: 'AZ-104',
  studyGuideUrl: 'https://learn.microsoft.com/az-104',
  cert: { title: 'Azure Administrator', slug: 'az-104' },
  ai: {
    generateJsonResponse: vi.fn(),
    getActiveAiProvider: vi.fn(() => 'anthropic'),
    getCostEstimate: vi.fn(() => 0.01),
  },
  env: {},
  now: NOW,
  ...over,
});

/** Deps that all succeed, so a test only has to override what it is about. */
const happyDeps = (over = {}) => ({
  fetchGuide: vi.fn(async () => guide([area(1), area(2)])),
  findVideos: vi.fn(async (areas) =>
    areas.map((a) => ({ areaSlug: a.slug, videos: [{ videoId: `v-${a.slug}` }], error: null }))
  ),
  writeScript: vi.fn(async () => script()),
  synthesize: vi.fn(async () => ({
    audio: Buffer.from([1, 2, 3]),
    contentType: 'audio/mpeg',
    bytes: 3,
    requests: 1,
    provider: 'gemini',
    model: 'gemini-2.5-flash-preview-tts',
    estimatedSeconds: 42,
  })),
  ...over,
});

describe('platform support', () => {
  it('accepts the platforms with a working study-guide adapter', () => {
    expect(isSupportedPlatform('azure')).toBe(true);
    expect(isSupportedPlatform('AWS')).toBe(true);
    // GitHub exams live on Microsoft Learn and parse with the same adapter.
    expect(SUPPORTED_PLATFORMS.github).toBe('microsoft');
    expect(isSupportedPlatform('vmware')).toBe(false);
    expect(isSupportedPlatform('')).toBe(false);
  });

  it('names the supported platforms when refusing one', async () => {
    await expect(
      generateEpisodes({ ...baseRun({ platform: 'vmware' }), store: makeStore() })
    ).rejects.toThrow(/not available for "vmware".*azure, github, aws/s);
  });
});

describe('a full run', () => {
  it('saves the set, then one draft episode per area, in study-guide order', async () => {
    const store = makeStore();
    const storage = makeStorage();

    const report = await generateEpisodes({
      ...baseRun(),
      store,
      storage,
      deps: happyDeps(),
    });

    expect(report).toMatchObject({
      examCode: 'AZ-104',
      platform: 'azure',
      provider: 'microsoft',
      areaCount: 2,
      generated: 2,
      failed: 0,
      withoutAudio: 0,
    });

    const set = store.docs[SET_CONTAINER][setId('azure', 'AZ-104')];
    expect(set).toMatchObject({ certTitle: 'Azure Administrator', areaCount: 2 });

    const episodes = Object.values(store.docs[EPISODE_CONTAINER]);
    expect(episodes.map((e) => e.id)).toEqual(['area-1', 'area-2']);
    expect(episodes.map((e) => e.order)).toEqual([0, 1]);
    // Every episode is a draft. Nothing this run does can publish one.
    expect(episodes.every((e) => e.status === STATUS.draft)).toBe(true);
    expect(episodes.every((e) => e.approvedAt === null && e.approvedBy === null)).toBe(true);
  });

  it('records which voice read the episode', async () => {
    // Provenance, for the same reason the approver is recorded. It is also
    // what answers "why does this one sound different" after a model change.
    const store = makeStore();
    await generateEpisodes({ ...baseRun(), store, storage: makeStorage(), deps: happyDeps() });

    expect(store.docs[EPISODE_CONTAINER]['area-1']).toMatchObject({
      speechProvider: 'gemini',
      speechModel: 'gemini-2.5-flash-preview-tts',
      durationSeconds: 42,
    });
  });

  it('leaves the provenance null when there was no audio', async () => {
    const store = makeStore();
    const deps = happyDeps({
      synthesize: vi.fn(async () => {
        throw new SpeechNotConfiguredError();
      }),
    });
    await generateEpisodes({ ...baseRun(), store, storage: makeStorage(), deps });

    expect(store.docs[EPISODE_CONTAINER]['area-1']).toMatchObject({
      speechProvider: null,
      speechModel: null,
      durationSeconds: null,
    });
  });

  it('partitions every episode under its set, not its own id', async () => {
    // listen_and_learn_episodes is partitioned on /setId because an area slug
    // is unique only within a set — AZ-104 and AZ-305 both have governance
    // areas, and flattening them would overwrite one with the other.
    const store = makeStore();
    await generateEpisodes({ ...baseRun(), store, storage: makeStorage(), deps: happyDeps() });

    for (const doc of Object.values(store.docs[EPISODE_CONTAINER])) {
      expect(doc.setId).toBe('azure_az-104');
    }
  });

  it('regenerating one area is scoped and still checked against the current guide', async () => {
    const store = makeStore();
    const deps = happyDeps();
    const report = await generateEpisodes({
      ...baseRun(),
      store,
      storage: makeStorage(),
      onlyAreas: ['area-2'],
      deps,
    });

    expect(report.areaCount).toBe(1);
    expect(Object.keys(store.docs[EPISODE_CONTAINER])).toEqual(['area-2']);
  });

  it('refuses an area that no longer exists in the guide', async () => {
    // Silently regenerating nothing would look like success on a re-scoped exam.
    await expect(
      generateEpisodes({
        ...baseRun(),
        store: makeStore(),
        storage: makeStorage(),
        onlyAreas: ['area-retired'],
        deps: happyDeps(),
      })
    ).rejects.toThrow(/None of the requested areas \(area-retired\) exist/);
  });
});

describe('a missing speech key degrades, a broken one fails', () => {
  it('still saves the transcript when no key is configured, and says why', async () => {
    const store = makeStore();
    const storage = makeStorage();
    const deps = happyDeps({
      synthesize: vi.fn(async () => {
        throw new SpeechNotConfiguredError();
      }),
    });

    const report = await generateEpisodes({ ...baseRun(), store, storage, deps });

    expect(report.generated).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.withoutAudio).toBe(2);

    const episode = store.docs[EPISODE_CONTAINER]['area-1'];
    expect(episode.status).toBe(STATUS.draft);
    expect(episode.transcript).toEqual([{ speaker: 'Maya', text: 'Hello' }]);
    expect(episode.audioUrl).toBeNull();
    expect(episode.audioError).toMatch(/GEMINI_API_KEY/);
    // Nothing was uploaded, so no empty blob is left behind.
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('fails the area on a rejected key rather than shipping a silent gap', async () => {
    // A 401 is a fault to fix. Degrading here would publish transcript-only
    // episodes forever while the key sat there broken.
    const store = makeStore();
    const deps = happyDeps({
      synthesize: vi.fn(async () => {
        throw new SpeechError('Azure Speech HTTP 401: denied', { status: 401 });
      }),
    });

    const report = await generateEpisodes({
      ...baseRun(),
      store,
      storage: makeStorage(),
      deps,
    });

    expect(report.generated).toBe(0);
    expect(report.failed).toBe(2);
    expect(store.docs[EPISODE_CONTAINER]['area-1']).toMatchObject({
      status: STATUS.failed,
      error: expect.stringContaining('401'),
    });
  });
});

describe('partial failure', () => {
  it('records a gap for the failing area and keeps the others', async () => {
    const store = makeStore();
    const deps = happyDeps({
      writeScript: vi.fn(async ({ area: a }) => {
        if (a.slug === 'area-1') throw new Error('model refused');
        return script();
      }),
    });

    const report = await generateEpisodes({
      ...baseRun(),
      store,
      storage: makeStorage(),
      deps,
    });

    expect(report).toMatchObject({ generated: 1, failed: 1 });
    expect(store.docs[EPISODE_CONTAINER]['area-1']).toMatchObject({
      status: STATUS.failed,
      error: 'model refused',
      areaName: 'Area 1',
    });
    expect(store.docs[EPISODE_CONTAINER]['area-2'].status).toBe(STATUS.draft);
  });

  it('ships episodes without links when video search fails entirely', async () => {
    const store = makeStore();
    const deps = happyDeps({
      findVideos: vi.fn(async () => {
        throw new Error('quota exhausted');
      }),
    });

    const report = await generateEpisodes({ ...baseRun(), store, storage: makeStorage(), deps });

    expect(report.videoError).toBe('quota exhausted');
    expect(report.generated).toBe(2);
    expect(store.docs[EPISODE_CONTAINER]['area-1'].videos).toEqual([]);
  });

  it('truncates a long failure reason rather than storing an essay', async () => {
    const store = makeStore();
    await saveEpisodeFailure(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area: area(1),
      error: 'x'.repeat(900),
      order: 0,
      now: NOW,
    });
    expect(store.docs[EPISODE_CONTAINER]['area-1'].error).toHaveLength(500);
  });

  it('a failed regeneration does not destroy the episode it replaced', async () => {
    // Cosmos upsert is a whole-document replace, so the failure writer merges.
    // Without that, one bad rerun would delete a working transcript and audio.
    const store = makeStore();
    await saveEpisode(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area: area(1),
      script: script(),
      audio: { url: '/api/public/media/listenandlearn/a.mp3', path: 'a.mp3', bytes: 10 },
      videos: [],
      order: 0,
      now: NOW,
    });

    await saveEpisodeFailure(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area: area(1),
      error: 'regeneration failed',
      order: 0,
      now: NOW,
    });

    const doc = store.docs[EPISODE_CONTAINER]['area-1'];
    expect(doc.status).toBe(STATUS.failed);
    expect(doc.error).toBe('regeneration failed');
    expect(doc.transcript).toEqual([{ speaker: 'Maya', text: 'Hello' }]);
    expect(doc.audioUrl).toBe('/api/public/media/listenandlearn/a.mp3');
  });
});

describe('persistence details', () => {
  it('stores a site-relative media URL, never a storage-account URL', async () => {
    // The account denies anonymous reads, so a direct blob URL is dead on
    // arrival — and an absolute URL breaks on any topology change.
    const storage = makeStorage();
    const uploaded = await uploadEpisodeAudio({
      storage,
      provider: 'Azure',
      examCode: 'AZ-104',
      areaSlug: 'area-1',
      audio: Buffer.from([1, 2]),
      contentType: 'audio/mpeg',
    });

    expect(uploaded.path).toBe('azure/az-104/area-1.mp3');
    expect(uploaded.url).toBe('/api/public/media/listenandlearn/azure/az-104/area-1.mp3');
    expect(uploaded.bytes).toBe(2);
    expect(storage.uploadBlob).toHaveBeenCalledWith(
      AUDIO_CONTAINER,
      'azure/az-104/area-1.mp3',
      expect.any(Buffer),
      'audio/mpeg',
      expect.objectContaining({ examCode: 'AZ-104', areaSlug: 'area-1' })
    );
  });

  it('lowercases the blob path so a set has one canonical location', () => {
    expect(audioPath('AZURE', 'AZ-104', 'area-1')).toBe('azure/az-104/area-1.mp3');
    expect(setId('AZURE', 'AZ-104')).toBe('azure_az-104');
  });

  it('a regenerated episode does not inherit the approval it replaced', async () => {
    const store = makeStore();
    const save = () =>
      saveEpisode(store, {
        provider: 'azure',
        examCode: 'AZ-104',
        area: area(1),
        script: script(),
        audio: { url: '/u', path: 'p', bytes: 1 },
        videos: [],
        order: 0,
        now: NOW,
      });

    await save();
    await setEpisodeStatus(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      areaSlug: 'area-1',
      status: STATUS.published,
      actorId: 'oid-1',
      now: NOW,
    });
    expect(store.docs[EPISODE_CONTAINER]['area-1'].status).toBe(STATUS.published);

    await save();
    expect(store.docs[EPISODE_CONTAINER]['area-1'].status).toBe(STATUS.draft);
    expect(store.docs[EPISODE_CONTAINER]['area-1'].approvedBy).toBeNull();
  });

  it('stamps who approved and clears the stamp on unapproval', async () => {
    const store = makeStore();
    store.docs[EPISODE_CONTAINER]['area-1'] = { id: 'area-1', status: STATUS.draft };

    await setEpisodeStatus(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      areaSlug: 'area-1',
      status: STATUS.published,
      actorId: 'oid-9',
      now: NOW,
    });
    expect(store.docs[EPISODE_CONTAINER]['area-1']).toMatchObject({
      status: STATUS.published,
      approvedBy: 'oid-9',
      approvedAt: NOW,
    });

    await setEpisodeStatus(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      areaSlug: 'area-1',
      status: STATUS.draft,
      actorId: 'oid-9',
      now: NOW,
    });
    expect(store.docs[EPISODE_CONTAINER]['area-1']).toMatchObject({
      status: STATUS.draft,
      approvedBy: null,
      approvedAt: null,
    });
  });

  it('passes the set as the explicit partition key on a status change', async () => {
    const store = makeStore();
    store.docs[EPISODE_CONTAINER]['area-1'] = { id: 'area-1' };
    await setEpisodeStatus(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      areaSlug: 'area-1',
      status: STATUS.published,
      now: NOW,
    });

    expect(store.patchDoc).toHaveBeenCalledWith(
      EPISODE_CONTAINER,
      'area-1',
      expect.anything(),
      { partitionKey: 'azure_az-104' }
    );
  });

  it('refuses a status the reviewer must not set', async () => {
    await expect(
      setEpisodeStatus(makeStore(), {
        provider: 'azure',
        examCode: 'AZ-104',
        areaSlug: 'area-1',
        status: 'archived',
        now: NOW,
      })
    ).rejects.toThrow(/Unknown episode status "archived"/);
  });

  it('keeps the transcript, which is the accessible equivalent of the audio', () => {
    const doc = toEpisodeDoc({
      area: area(1),
      script: script(),
      audio: { url: '/u', path: 'p', bytes: 4 },
      videos: [],
      examCode: 'AZ-104',
      provider: 'azure',
      order: 3,
      now: NOW,
    });

    expect(doc.transcript).toEqual([{ speaker: 'Maya', text: 'Hello' }]);
    expect(doc.speakers).toEqual({ a: 'Maya', b: 'Elena' });
    expect(doc.weightLabel).toBe('20–25%');
    expect(doc.order).toBe(3);
  });

  it('preserves an earlier generatedBy when the set is re-saved', async () => {
    const store = makeStore();
    await saveSet(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      guide: guide([area(1)]),
      cert: { title: 'T', slug: 's' },
      now: NOW,
      actorId: 'oid-1',
    });
    await saveSet(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      guide: guide([area(1), area(2)]),
      cert: {},
      now: '2026-09-01T00:00:00.000Z',
      actorId: 'oid-2',
    });

    const set = store.docs[SET_CONTAINER]['azure_az-104'];
    expect(set.areaCount).toBe(2);
    expect(set.generatedBy).toBe('oid-2');
    // Falls back to the guide title when the caller supplies no cert title.
    expect(set.certTitle).toBe('Study guide for AZ-104');
  });
});
