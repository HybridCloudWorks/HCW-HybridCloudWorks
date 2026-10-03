/**
 * Audio versions (ADR 0033 §4): stamped paths, the implicit version a
 * pre-library document is read as, the merge a regeneration performs, and a
 * failure that keeps a published chapter published.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  EPISODE_CONTAINER,
  STATUS,
  activeVersionOf,
  audioPath,
  episodeKindOf,
  manualChapterId,
  mergeRegeneration,
  mirrorActiveVersion,
  saveEpisodeFailure,
  speakableTextOf,
  toVersion,
  versionStamp,
  versionsOf,
} from './publish.js';

const NOW = '2026-10-03T14:05:09.123Z';

describe('versionStamp and audioPath', () => {
  it('stamps UTC to the second and puts it before the extension', () => {
    expect(versionStamp(NOW)).toBe('20261003140509');
    expect(versionStamp(new Date(NOW))).toBe('20261003140509');
    expect(audioPath('AZURE', 'AZ-104', 'area-1', versionStamp(NOW))).toBe(
      'azure/az-104/area-1-20261003140509.mp3'
    );
    expect(audioPath('azure', 'az-104', 'area-1')).toBe('azure/az-104/area-1.mp3');
  });

  it('falls back to the clock for an unparseable time rather than stamping NaN', () => {
    expect(versionStamp('not a date')).toMatch(/^\d{14}$/);
  });
});

describe('kinds and ids', () => {
  it('knows the manual kind and still reads anything else as guide', () => {
    expect(episodeKindOf({ kind: 'manual' })).toBe('manual');
    expect(episodeKindOf({ kind: 'source' })).toBe('source');
    expect(episodeKindOf({ kind: 'podcast' })).toBe('guide');
    expect(manualChapterId('Chapter One!')).toBe('manual_chapter-one');
    expect(() => manualChapterId('!!!')).toThrow(/title/);
  });
});

describe('versionsOf / activeVersionOf / mirrorActiveVersion', () => {
  it('reads a document with audio and no versions as one active legacy version', () => {
    const doc = {
      audioUrl: '/u',
      audioPath: 'p.mp3',
      audioBytes: 3,
      durationSeconds: 9,
      generatedAt: 't',
    };
    expect(versionsOf(doc)).toEqual([
      expect.objectContaining({ id: 'legacy', active: true, audioUrl: '/u', audioPath: 'p.mp3' }),
    ]);
    expect(activeVersionOf(doc).id).toBe('legacy');
    expect(versionsOf({})).toEqual([]);
    expect(activeVersionOf({})).toBeNull();
  });

  it('mirrors the active version onto the top-level fields', () => {
    const doc = {
      audioUrl: '/old',
      versions: [
        {
          id: 'a',
          audioUrl: '/a',
          audioPath: 'a.mp3',
          audioBytes: 1,
          durationSeconds: 1,
          active: false,
        },
        {
          id: 'b',
          audioUrl: '/b',
          audioPath: 'b.mp3',
          audioBytes: 2,
          durationSeconds: 2,
          active: true,
          speechModel: 'm',
        },
      ],
    };
    expect(mirrorActiveVersion(doc)).toMatchObject({
      audioUrl: '/b',
      audioPath: 'b.mp3',
      audioBytes: 2,
      durationSeconds: 2,
      speechModel: 'm',
    });
  });

  it('names a version by its stamp, or legacy for an unstamped path', () => {
    expect(toVersion({ url: '/u', path: 'x/y-20261003140509.mp3' }, { now: NOW }).id).toBe(
      '20261003140509'
    );
    expect(toVersion({ url: '/u', path: 'x/y.mp3' }, { now: NOW }).id).toBe('legacy');
    expect(toVersion(null, { now: NOW })).toBeNull();
  });
});

describe('mergeRegeneration', () => {
  const fresh = (path, extra = {}) => ({
    id: 'area-1',
    setId: 's',
    title: 'Fresh title',
    order: 2,
    status: STATUS.draft,
    audioUrl: `/u/${path}`,
    audioPath: path,
    audioBytes: 10,
    durationSeconds: 60,
    speechProvider: 'gemini',
    speechModel: 'm',
    audioError: null,
    approvedAt: null,
    approvedBy: null,
    ...extra,
  });

  it('is a first take when nothing existed', () => {
    const merged = mergeRegeneration(null, fresh('a/b/c-20261003140509.mp3'), {
      now: NOW,
      actorId: 'o',
    });
    expect(merged.status).toBe(STATUS.draft);
    expect(merged.versions).toEqual([
      expect.objectContaining({ id: '20261003140509', active: true, generatedBy: 'o' }),
    ]);
    expect(merged.firstGeneratedAt).toBe(NOW);
    expect(merged.regeneratedAt).toBeNull();
  });

  it('keeps a published status and its approver, deactivates the old take, keeps hand edits', () => {
    const existing = {
      ...fresh('a/b/c.mp3'),
      status: STATUS.published,
      approvedAt: 'then',
      approvedBy: 'approver',
      title: 'Renamed by hand',
      titleEditedAt: 'edit',
      order: 7,
      orderEditedAt: 'edit',
      lastError: { message: 'old' },
      generatedAt: 'first',
    };
    const merged = mergeRegeneration(existing, fresh('a/b/c-20261003140509.mp3'), {
      now: NOW,
      costUsd: 0.2,
    });
    expect(merged).toMatchObject({
      status: STATUS.published,
      approvedAt: 'then',
      approvedBy: 'approver',
      title: 'Renamed by hand',
      order: 7,
      lastError: null,
      firstGeneratedAt: 'first',
      regeneratedAt: NOW,
      audioPath: 'a/b/c-20261003140509.mp3',
    });
    expect(merged.versions.map((v) => [v.id, v.active])).toEqual([
      ['legacy', false],
      ['20261003140509', true],
    ]);
    expect(merged.versions[1].costUsd).toBe(0.2);
  });

  it('keeps an archived chapter archived, and a draft a draft', () => {
    expect(
      mergeRegeneration(
        {
          ...fresh('a.mp3'),
          status: STATUS.archived,
          statusBeforeArchive: 'published',
          archivedAt: 'x',
        },
        fresh('b-20261003140509.mp3'),
        { now: NOW }
      )
    ).toMatchObject({ status: STATUS.archived, statusBeforeArchive: 'published', archivedAt: 'x' });
    expect(
      mergeRegeneration(
        { ...fresh('a.mp3'), status: STATUS.failed },
        fresh('b-20261003140509.mp3'),
        { now: NOW }
      ).status
    ).toBe(STATUS.draft);
  });

  it('with no new audio keeps the previous take active and carries the explanation', () => {
    const merged = mergeRegeneration(
      { ...fresh('a/b/c-20261003140509.mp3'), status: STATUS.published },
      fresh(null, { audioUrl: null, audioPath: null, audioError: 'no key' }),
      { now: '2026-10-04T00:00:00.000Z' }
    );
    expect(merged.versions).toHaveLength(1);
    expect(merged.versions[0].active).toBe(true);
    expect(merged.audioUrl).toBe('/u/a/b/c-20261003140509.mp3');
    expect(merged.audioError).toBe('no key');
    expect(merged.status).toBe(STATUS.published);
  });
});

describe('saveEpisodeFailure keeps a published chapter on the site (ADR 0033 §4)', () => {
  const makeStore = (existing) => ({
    readDoc: vi.fn(async () => existing),
    upsertDoc: vi.fn(async () => {}),
  });

  it('records lastError and keeps status, audio and approval for a published chapter', async () => {
    const store = makeStore({
      id: 'area-1',
      status: STATUS.published,
      approvedBy: 'o',
      audioUrl: '/u',
      transcript: [{ speaker: 'Maya', text: 'kept' }],
      generatedAt: 'first',
    });
    await saveEpisodeFailure(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area: { slug: 'area-1', name: 'Area 1' },
      error: 'Gemini TTS HTTP 500',
      order: 0,
      now: NOW,
    });
    const [container, doc] = store.upsertDoc.mock.calls[0];
    expect(container).toBe(EPISODE_CONTAINER);
    expect(doc).toMatchObject({
      status: STATUS.published,
      approvedBy: 'o',
      audioUrl: '/u',
      generatedAt: 'first',
      lastError: { message: 'Gemini TTS HTTP 500', at: NOW, attempt: 'regeneration' },
    });
    expect(doc.error).toBeNull();
    expect(doc.transcript).toEqual([{ speaker: 'Maya', text: 'kept' }]);
  });

  it('marks a draft or never-generated chapter failed, as before', async () => {
    const store = makeStore(null);
    await saveEpisodeFailure(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area: { slug: 'area-1', name: 'Area 1' },
      error: 'x'.repeat(600),
      order: 1,
      now: NOW,
      kind: 'manual',
    });
    const [, doc] = store.upsertDoc.mock.calls[0];
    expect(doc.status).toBe(STATUS.failed);
    expect(doc.error).toHaveLength(500);
    expect(doc.kind).toBe('manual');
    expect(doc.lastError.message).toHaveLength(500);
  });
});

describe('speakableTextOf', () => {
  it('reads the body under its several spellings, drops markup, keeps line breaks', () => {
    expect(
      speakableTextOf({ postContent: '<p>Hello&nbsp;<b>world</b></p>\n<p>Two &amp; three</p>' })
    ).toBe('Hello world\nTwo & three');
    expect(speakableTextOf({ content: 'plain' })).toBe('plain');
    expect(speakableTextOf({ Content: '<scr<script>ipt>x' })).toBe('x');
    expect(speakableTextOf({})).toBe('');
  });
});
