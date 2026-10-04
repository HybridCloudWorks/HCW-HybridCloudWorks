import { describe, it, expect } from 'vitest';
import {
  GALLERY_MAX_LIMIT,
  dateValue,
  matchesParams,
  parseGalleryListParams,
  sortItems,
} from './filters.js';

const query = (values) => (key) => values[key];

/** A normalised row with the fields the filters read, every one overridable. */
const row = (overrides = {}) => ({
  id: 'img-1',
  title: 'Azure landing zone',
  altText: '',
  caption: '',
  prompt: '',
  promptSet: 'lego',
  promptSetId: 'lego',
  promptName: '',
  articleId: 'article-1',
  contentId: 'article-1',
  imageUrl: '/api/public/media/covers/a.png',
  provider: 'Azure',
  slot: 'hero',
  folder: 'default',
  customTags: ['cloud'],
  source: 'ai-cover',
  createdAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
  softDeletedAt: null,
  usageCount: 0,
  ...overrides,
});

describe('parseGalleryListParams', () => {
  it('defaults every value and bounds the ones that have bounds', () => {
    const p = parseGalleryListParams(query({}));
    expect(p).toMatchObject({
      state: 'active',
      sort: 'newest',
      offset: 0,
      limit: 60,
      usage: false,
    });
    expect(parseGalleryListParams(query({ limit: '9999', offset: '-4' }))).toMatchObject({
      limit: GALLERY_MAX_LIMIT,
      offset: 0,
    });
    expect(parseGalleryListParams(query({ state: 'bogus', sort: 'sideways' }))).toMatchObject({
      state: 'active',
      sort: 'newest',
    });
  });

  it('lower-cases the facet values and keeps set and id params as given', () => {
    const p = parseGalleryListParams(
      query({ q: ' Landing ', folder: 'AWS', set: 'Lego', contentId: 'A1', usage: 'TRUE' })
    );
    expect(p).toMatchObject({
      q: 'landing',
      folder: 'aws',
      set: 'Lego',
      contentId: 'A1',
      usage: true,
    });
  });
});

describe('matchesParams', () => {
  const params = (overrides) => ({ ...parseGalleryListParams(query({})), ...overrides });

  it('shows only the rows of the requested lifecycle state, and every row for all', () => {
    const live = row();
    const archived = row({ archivedAt: '2026-09-02T00:00:00.000Z' });
    const trashed = row({
      softDeletedAt: '2026-09-03T00:00:00.000Z',
      archivedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(
      [live, archived, trashed].map((r) => matchesParams(r, params({ state: 'active' })))
    ).toEqual([true, false, false]);
    expect(
      [live, archived, trashed].map((r) => matchesParams(r, params({ state: 'archived' })))
    ).toEqual([false, true, false]);
    expect(
      [live, archived, trashed].map((r) => matchesParams(r, params({ state: 'trash' })))
    ).toEqual([false, false, true]);
    expect(
      [live, archived, trashed].map((r) => matchesParams(r, params({ state: 'all' })))
    ).toEqual([true, true, true]);
  });

  it('treats the literal all as no filter on the facet params', () => {
    const p = params({ folder: 'all', source: 'all', provider: 'all', slot: 'all', tag: 'all' });
    expect(matchesParams(row(), p)).toBe(true);
  });

  it('reads --none-- as the default folder only', () => {
    expect(matchesParams(row({ folder: 'default' }), params({ folder: '--none--' }))).toBe(true);
    expect(matchesParams(row({ folder: 'aws' }), params({ folder: '--none--' }))).toBe(false);
    expect(matchesParams(row({ folder: 'aws' }), params({ folder: 'aws' }))).toBe(true);
  });

  it('matches provider and slot case-insensitively, and tags, set and ids exactly', () => {
    expect(matchesParams(row(), params({ provider: 'azure', slot: 'hero' }))).toBe(true);
    expect(matchesParams(row(), params({ provider: 'aws' }))).toBe(false);
    expect(matchesParams(row(), params({ tag: 'cloud' }))).toBe(true);
    expect(matchesParams(row(), params({ tag: 'edge' }))).toBe(false);
    expect(
      matchesParams(row({ promptSet: '', promptSetId: 'lego' }), params({ set: 'lego' }))
    ).toBe(true);
    expect(
      matchesParams(row({ contentId: '', articleId: 'a-9' }), params({ contentId: 'a-9' }))
    ).toBe(true);
    expect(matchesParams(row(), params({ articleId: 'other' }))).toBe(false);
  });

  it('searches the text fields together, lower-cased', () => {
    expect(matchesParams(row(), params({ q: 'landing zone' }))).toBe(true);
    expect(matchesParams(row({ caption: 'Night SKYLINE' }), params({ q: 'skyline' }))).toBe(true);
    expect(matchesParams(row(), params({ q: 'nowhere' }))).toBe(false);
  });
});

describe('sortItems', () => {
  const a = row({ id: 'a', title: 'Beta', createdAt: '2026-09-01T00:00:00.000Z', usageCount: 1 });
  const b = row({ id: 'b', title: 'Alpha', createdAt: '2026-09-03T00:00:00.000Z', usageCount: 0 });
  const c = row({ id: 'c', title: 'Alpha', createdAt: '2026-09-02T00:00:00.000Z', usageCount: 1 });
  const ids = (items) => items.map((i) => i.id);

  it('sorts newest first by default and oldest first on request', () => {
    expect(ids(sortItems([a, b, c], 'newest'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortItems([a, b, c], 'oldest'))).toEqual(['a', 'c', 'b']);
  });

  it('breaks title and usage ties newest first', () => {
    expect(ids(sortItems([a, b, c], 'title'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortItems([a, b, c], 'most-used'))).toEqual(['c', 'a', 'b']);
  });
});

describe('dateValue', () => {
  it('reads an ISO stamp and answers 0 for anything else', () => {
    expect(dateValue('2026-09-01T00:00:00.000Z')).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
    expect(dateValue('not a date')).toBe(0);
    expect(dateValue(null)).toBe(0);
  });
});
