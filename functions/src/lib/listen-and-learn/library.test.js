/**
 * The Audio Library model (ADR 0033 §4): what a book or chapter body may
 * carry, how a stored document reads with defaults, and the counts the
 * Library grid shows.
 */
import { describe, it, expect } from 'vitest';
import {
  BOOK_KINDS,
  LIMITS,
  parseBookCreate,
  parseBookPatch,
  parseChapterCreate,
  parseChapterPatch,
  parseReorder,
  publishedChapters,
  summarizeChapters,
  toBookView,
  toChapterView,
} from './library.js';
import { STATUS } from './publish.js';
import { DEFAULT_VOICE_SETTINGS } from './speech-settings.js';

describe('parseBookPatch', () => {
  it('keeps only the fields the body names, validated', () => {
    const { value } = parseBookPatch({
      title: '  Azure for  Architects ',
      author: 'Saul',
      tags: ['Azure', 'azure', ' Design '],
      coverImageUrl: '/api/public/media/covers/x/cover.png',
      kind: 'book',
    });
    expect(value).toEqual({
      title: 'Azure for Architects',
      author: 'Saul',
      tags: ['azure', 'design'],
      coverImageUrl: '/api/public/media/covers/x/cover.png',
      kind: 'book',
    });
  });

  it('refuses an empty title, a bad kind, a non-https cover and an over-long field by sentence', () => {
    expect(parseBookPatch({ title: '   ' }).error).toMatch(/title is required/);
    expect(parseBookPatch({ kind: 'podcast' }).error).toBe(
      `kind must be one of ${BOOK_KINDS.join(', ')}`
    );
    expect(parseBookPatch({ coverImageUrl: 'javascript:alert(1)' }).error).toMatch(
      /https URL or a site-relative/
    );
    expect(parseBookPatch({ coverImageUrl: '//evil.example/x.png' }).error).toMatch(/https URL/);
    expect(parseBookPatch({ author: 'a'.repeat(LIMITS.author + 1) }).error).toMatch(/at most/);
    expect(parseBookPatch({}).error).toBe('Nothing to change');
  });

  it('validates a voice through the speech settings rules', () => {
    expect(parseBookPatch({ voice: { narrator: 'NotAVoice' } }).error).toMatch(/Gemini voices/);
    const { value } = parseBookPatch({ voice: { narrator: 'Sulafat', speakingRate: 1.25 } });
    expect(value.voice).toMatchObject({
      narrator: 'Sulafat',
      speakingRate: 1.25,
      provider: 'auto',
    });
  });
});

describe('parseBookCreate', () => {
  it('derives the code from the title for a book with no exam', () => {
    const { value } = parseBookCreate({ provider: 'Azure', title: 'Zero Trust, Explained' });
    expect(value).toMatchObject({
      provider: 'azure',
      examCode: 'zero-trust-explained',
      kind: 'book',
      title: 'Zero Trust, Explained',
      tags: [],
      author: null,
      voice: DEFAULT_VOICE_SETTINGS,
    });
  });

  it('keeps an explicit exam code for a course shell', () => {
    const { value } = parseBookCreate({
      provider: 'aws',
      kind: 'course',
      title: 'Solutions Architect',
      examCode: 'SAA-C03',
    });
    expect(value.examCode).toBe('saa-c03');
    expect(value.kind).toBe('course');
  });

  it('refuses a missing provider or a title that slugs to nothing', () => {
    expect(parseBookCreate({ title: 'X' }).error).toMatch(/provider is required/);
    expect(parseBookCreate({ provider: 'azure', title: '!!!' }).error).toMatch(/slug/);
    expect(parseBookCreate({ provider: 'azure', title: '' }).error).toMatch(/title is required/);
  });
});

describe('parseChapterCreate', () => {
  it('needs text or a content item, and derives the manual_ id', () => {
    const { value } = parseChapterCreate({ title: 'Chapter One', sourceText: 'Hello.\nWorld.' });
    expect(value).toEqual({
      id: 'manual_chapter-one',
      title: 'Chapter One',
      sourceText: 'Hello.\nWorld.',
      contentId: null,
      speak: true,
    });
    expect(parseChapterCreate({ title: 'Only a title' }).error).toMatch(/sourceText.*contentId/);
    expect(parseChapterCreate({ title: 'From content', contentId: 'c-1' }).value).toMatchObject({
      contentId: 'c-1',
      sourceText: null,
      speak: true,
    });
    expect(parseChapterCreate({ title: 'Quiet', sourceText: 'x', speak: false }).value.speak).toBe(
      false
    );
  });

  it('bounds the text', () => {
    expect(
      parseChapterCreate({ title: 'T', sourceText: 'x'.repeat(LIMITS.sourceText + 1) }).error
    ).toMatch(/at most/);
  });
});

describe('parseChapterPatch', () => {
  it('accepts a rename, an order, text, a version, archive and clearError', () => {
    expect(
      parseChapterPatch({
        title: 'New',
        order: 3,
        sourceText: ' text ',
        activeVersionId: '20261003140509',
        archived: true,
        clearError: true,
      }).value
    ).toEqual({
      title: 'New',
      order: 3,
      sourceText: 'text',
      activeVersionId: '20261003140509',
      archived: true,
      clearError: true,
    });
  });

  it('refuses a bad order, a non-boolean archive, a malformed version id and an empty body', () => {
    expect(parseChapterPatch({ order: -1 }).error).toMatch(/order must be/);
    expect(parseChapterPatch({ order: 1.5 }).error).toMatch(/order must be/);
    expect(parseChapterPatch({ archived: 'yes' }).error).toMatch(/archived must be/);
    expect(parseChapterPatch({ activeVersionId: '../x' }).error).toMatch(/version/);
    expect(parseChapterPatch({ clearError: false }).error).toMatch(/clearError/);
    expect(parseChapterPatch({}).error).toBe('Nothing to change');
  });
});

describe('parseReorder', () => {
  it('takes a list of distinct ids', () => {
    expect(parseReorder({ order: ['a', ' b '] }).value).toEqual(['a', 'b']);
    expect(parseReorder({ order: [] }).error).toMatch(/chapter ids/);
    expect(parseReorder({ order: ['a', 'a'] }).error).toMatch(/twice/);
    expect(parseReorder({ order: ['a', 3] }).error).toMatch(/chapter ids/);
  });
});

describe('views', () => {
  it('reads a pre-library episode as one implicit active version', () => {
    const view = toChapterView(
      {
        id: 'area-1',
        areaSlug: 'area-1',
        audioUrl: '/u',
        audioPath: 'azure/az-104/area-1.mp3',
        generatedAt: 't',
      },
      { areaSlugs: ['area-1', 'area-2'] }
    );
    expect(view.kind).toBe('guide');
    expect(view.versions).toHaveLength(1);
    expect(view.versions[0]).toMatchObject({ id: 'legacy', active: true, audioUrl: '/u' });
    expect(view.activeVersionId).toBe('legacy');
    expect(view.versionCount).toBe(1);
    expect(view.droppedFromGuide).toBe(false);
  });

  it('flags a guide chapter the current guide no longer lists, and never a hand-made one', () => {
    const set = { areaSlugs: ['area-1'] };
    expect(toChapterView({ id: 'area-9', areaSlug: 'area-9' }, set).droppedFromGuide).toBe(true);
    expect(toChapterView({ id: 'manual_x', kind: 'manual' }, set).droppedFromGuide).toBe(false);
    expect(toChapterView({ id: 'source_x', kind: 'source' }, set).droppedFromGuide).toBe(false);
    // A set that has never been parsed has no opinion.
    expect(toChapterView({ id: 'area-9' }, { areaSlugs: [] }).droppedFromGuide).toBe(false);
    expect(toChapterView({ id: 'area-9' }, null).droppedFromGuide).toBe(false);
  });

  it('reads a pre-library set as a course titled after its certification', () => {
    const view = toBookView({
      id: 'azure_az-104',
      examCode: 'AZ-104',
      certTitle: 'Azure Administrator',
    });
    expect(view).toMatchObject({
      kind: 'course',
      title: 'Azure Administrator',
      author: null,
      tags: [],
      archivedAt: null,
      voice: DEFAULT_VOICE_SETTINGS,
    });
    expect(view.counts.chapters).toBe(0);
  });

  it('counts chapters per book, apart from soft-deleted ones, with the audible duration', () => {
    const counts = summarizeChapters([
      { setId: 'a', status: STATUS.published, durationSeconds: 100 },
      { setId: 'a', status: STATUS.draft, durationSeconds: 50.4 },
      { setId: 'a', status: STATUS.failed },
      { setId: 'a', status: STATUS.archived, durationSeconds: 999 },
      { setId: 'a', status: STATUS.published, softDeletedAt: 't', durationSeconds: 5 },
      { setId: 'b', status: STATUS.draft },
    ]);
    expect(counts.get('a')).toEqual({
      chapters: 4,
      published: 1,
      drafts: 1,
      failed: 1,
      archived: 1,
      durationSeconds: 150,
    });
    expect(counts.get('b').chapters).toBe(1);
  });

  it('names the published chapters that stand in the way of a delete', () => {
    expect(
      publishedChapters([
        { id: 'a', status: STATUS.published },
        { id: 'b', status: STATUS.draft },
        { id: 'c', status: STATUS.published, softDeletedAt: 't' },
      ]).map((c) => c.id)
    ).toEqual(['a']);
  });
});
