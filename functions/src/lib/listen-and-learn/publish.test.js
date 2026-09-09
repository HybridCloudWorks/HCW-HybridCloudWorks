/**
 * The stored shape of the two episode kinds (#433).
 *
 * generate.test.js pins everything `publish.js` did before this change and is
 * not edited by it. What is asserted here is what #433 added: the one rule for
 * reading `kind`, the id scheme that keeps a source episode out of a guide
 * area's way, and the set that is created only when missing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  EPISODE_KIND,
  EPISODE_CONTAINER,
  SET_CONTAINER,
  SOURCE_EPISODE_ID_PREFIX,
  SOURCE_EPISODE_ORDER,
  STATUS,
  ensureSet,
  episodeKindOf,
  saveEpisodeFailure,
  slugifyTitle,
  sourceEpisodeId,
  toEpisodeDoc,
} from './publish.js';
import { slugify as guideSlugify } from './studyguide.js';

const NOW = '2026-09-09T12:00:00.000Z';

function makeStore() {
  const docs = { [SET_CONTAINER]: {}, [EPISODE_CONTAINER]: {} };
  return {
    docs,
    readDoc: vi.fn(async (container, id) => docs[container]?.[id] ?? null),
    upsertDoc: vi.fn(async (container, doc) => {
      docs[container][doc.id] = doc;
      return doc;
    }),
  };
}

const script = {
  title: 'T',
  summary: 'S',
  keyTakeaways: [],
  speakers: { a: 'Maya', b: 'Elena' },
  dialogue: [{ speaker: 'Maya', text: 'Hello' }],
  byteLength: 5,
  trimmedTurns: 0,
};

describe('episodeKindOf — the one rule', () => {
  it('reads a missing kind as guide, because every pre-#433 episode is one', () => {
    expect(episodeKindOf({})).toBe(EPISODE_KIND.guide);
    expect(episodeKindOf({ kind: undefined })).toBe(EPISODE_KIND.guide);
    expect(episodeKindOf(null)).toBe(EPISODE_KIND.guide);
  });

  it('reads the stored kind, and never a third value', () => {
    expect(episodeKindOf({ kind: 'source' })).toBe(EPISODE_KIND.source);
    expect(episodeKindOf({ kind: 'guide' })).toBe(EPISODE_KIND.guide);
    expect(episodeKindOf({ kind: 'podcast' })).toBe(EPISODE_KIND.guide);
  });

  it('is never inferred from the source list', () => {
    // A stored field, not a guess: a guide episode with a stray non-empty
    // list is still a guide episode, and a source episode with none is not.
    expect(episodeKindOf({ sources: [{ kind: 'page', url: 'https://x' }] })).toBe('guide');
    expect(episodeKindOf({ kind: 'source', sources: [] })).toBe('source');
  });
});

describe('sourceEpisodeId — the id scheme', () => {
  it('is source_ plus the slug of the title', () => {
    expect(sourceEpisodeId('Entra ID basics')).toBe('source_entra-id-basics');
    expect(sourceEpisodeId('  Entra   ID  basics ')).toBe('source_entra-id-basics');
    expect(sourceEpisodeId('ENTRA ID BASICS')).toBe('source_entra-id-basics');
    expect(SOURCE_EPISODE_ID_PREFIX).toBe('source_');
  });

  it('cannot collide with any guide area, because a guide slug never contains an underscore', () => {
    // The guide slugifier maps every non-alphanumeric run to one hyphen, so
    // no area name — including one that starts with "Source" — can produce
    // the prefix. Pinned against the real function, not a copy of its regex.
    for (const name of ['Source control', 'source_control', 'Source: the control', 'sources']) {
      expect(guideSlugify(name)).not.toMatch(/_/);
      expect(guideSlugify(name).startsWith(SOURCE_EPISODE_ID_PREFIX)).toBe(false);
    }
    expect(sourceEpisodeId('Control')).toBe('source_control');
    expect(guideSlugify('Source control')).toBe('source-control');
  });

  it('slugifies by the same rule as the guide, so the two read alike', () => {
    for (const name of ['Manage Azure identities', 'AZ-104: Governance & compliance', '  a  b  ']) {
      expect(slugifyTitle(name)).toBe(guideSlugify(name));
    }
  });

  it('refuses a title with nothing to slug', () => {
    expect(() => sourceEpisodeId('---')).toThrow(/needs a title/);
    expect(() => sourceEpisodeId('')).toThrow(/needs a title/);
  });

  it('is a valid blob path segment', async () => {
    const { isValidBlobPath } = await import('../blob-paths.js');
    expect(isValidBlobPath(`azure/az-104/${sourceEpisodeId('Entra ID basics')}.mp3`)).toBe(true);
  });
});

describe('toEpisodeDoc', () => {
  const base = {
    area: { slug: 'area-1', name: 'Area 1', weightLabel: '' },
    script,
    audio: null,
    videos: [],
    examCode: 'AZ-104',
    provider: 'azure',
    order: 0,
    now: NOW,
  };

  it('writes kind guide and an empty source list by default, from now on', () => {
    const doc = toEpisodeDoc(base);
    expect(doc.kind).toBe(EPISODE_KIND.guide);
    expect(doc.sources).toEqual([]);
  });

  it('writes kind source with the resolved list', () => {
    const sources = [{ kind: 'page', url: 'https://example.com', title: 'Example' }];
    const doc = toEpisodeDoc({
      ...base,
      area: { slug: 'source_t', name: 'T' },
      kind: 'source',
      sources,
      order: SOURCE_EPISODE_ORDER,
    });
    expect(doc).toMatchObject({
      id: 'source_t',
      kind: 'source',
      sources,
      order: SOURCE_EPISODE_ORDER,
      status: STATUS.draft,
    });
  });

  it('never stores a third kind or a non-array source list', () => {
    expect(toEpisodeDoc({ ...base, kind: 'podcast' }).kind).toBe('guide');
    expect(toEpisodeDoc({ ...base, sources: 'https://x' }).sources).toEqual([]);
  });
});

describe('saveEpisodeFailure keeps the kind', () => {
  const area = { slug: 'source_t', name: 'T' };

  it('writes the caller kind on a marker for an episode that never succeeded', async () => {
    const store = makeStore();
    await saveEpisodeFailure(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area,
      error: 'could not read a source',
      order: SOURCE_EPISODE_ORDER,
      now: NOW,
      kind: 'source',
    });
    expect(store.docs[EPISODE_CONTAINER].source_t).toMatchObject({
      kind: 'source',
      status: STATUS.failed,
    });
  });

  it('keeps the stored kind when the caller gives none, and defaults to guide', async () => {
    const store = makeStore();
    store.docs[EPISODE_CONTAINER].source_t = { id: 'source_t', kind: 'source', transcript: [] };
    await saveEpisodeFailure(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area,
      error: 'x',
      order: 0,
      now: NOW,
    });
    expect(store.docs[EPISODE_CONTAINER].source_t.kind).toBe('source');

    await saveEpisodeFailure(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      area: { slug: 'area-1', name: 'Area 1' },
      error: 'x',
      order: 0,
      now: NOW,
    });
    expect(store.docs[EPISODE_CONTAINER]['area-1'].kind).toBe('guide');
  });
});

describe('ensureSet', () => {
  it('creates a minimal set when none exists, so the episode has a home', async () => {
    const store = makeStore();
    const set = await ensureSet(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      cert: { title: 'Azure Administrator', slug: 'az-104' },
      now: NOW,
      actorId: 'oid-1',
    });
    expect(set).toMatchObject({
      id: 'azure_az-104',
      provider: 'azure',
      examCode: 'AZ-104',
      certTitle: 'Azure Administrator',
      certSlug: 'az-104',
      areaCount: 0,
      studyGuideUrl: null,
      generatedBy: 'oid-1',
    });
    expect(store.upsertDoc).toHaveBeenCalledWith(SET_CONTAINER, set);
  });

  it('leaves an existing set exactly as it is — a source episode is not a guide run', async () => {
    const store = makeStore();
    const existing = {
      id: 'azure_az-104',
      studyGuideUrl: 'https://learn.microsoft.com/az-104',
      areaCount: 5,
      generatedAt: '2026-08-01T00:00:00.000Z',
      generatedBy: 'oid-0',
    };
    store.docs[SET_CONTAINER]['azure_az-104'] = existing;

    const set = await ensureSet(store, {
      provider: 'azure',
      examCode: 'AZ-104',
      cert: { title: 'Changed' },
      now: NOW,
      actorId: 'oid-1',
    });
    expect(set).toBe(existing);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('falls back to the exam code for the title and slug', async () => {
    const store = makeStore();
    const set = await ensureSet(store, { provider: 'aws', examCode: 'SAA-C03', now: NOW });
    expect(set.certTitle).toBe('SAA-C03');
    expect(set.certSlug).toBe('saa-c03');
  });
});
