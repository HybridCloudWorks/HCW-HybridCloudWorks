/**
 * The Image Gallery page's pure rules, pinned now that they are functions
 * rather than lines inside the component (PR #841).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS,
  bulkClearsSelection,
  bulkClosesDetails,
  bulkMessage,
  deletionMessage,
  emptyStateFor,
  filtersFromSearch,
  hasActiveFilters,
  listingSummary,
  pagePosition,
  providerValuesFrom,
  slotValuesFrom,
  tagValuesFrom,
  withIds,
  withoutIds,
} from './galleryPageModel';

describe('filtersFromSearch', () => {
  it('starts from the defaults and takes what the link carries', () => {
    expect(filtersFromSearch('')).toEqual(DEFAULT_FILTERS);
    expect(filtersFromSearch('?folder=aws&sort=oldest')).toMatchObject({
      folder: 'aws',
      sort: 'oldest',
      state: 'active',
    });
  });

  it('widens the state to everything for a set or search link, unless the link says otherwise', () => {
    expect(filtersFromSearch('?set=Azure%20Chibi').state).toBe('all');
    expect(filtersFromSearch('?q=hero').state).toBe('all');
    expect(filtersFromSearch('?q=hero&state=trash').state).toBe('trash');
  });
});

describe('hasActiveFilters', () => {
  it('ignores paging and state, and notices everything else', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, state: 'trash', offset: 60 })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, tag: 'cloud' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: 'x' })).toBe(true);
  });
});

describe('emptyStateFor', () => {
  it('words trash and archived for themselves, and everything else generically', () => {
    expect(emptyStateFor('trash').title).toBe('Trash is empty');
    expect(emptyStateFor('archived').title).toBe('No archived images');
    expect(emptyStateFor('all').title).toBe('No images');
  });
});

describe('deletionMessage', () => {
  const item = { title: 'Alpha' };
  it('says whether the file went, stayed for others, or was never there', () => {
    expect(deletionMessage(item, { storageDeleted: true })).toBe(
      '"Alpha" and its file were deleted.'
    );
    expect(deletionMessage(item, { sharedWith: 1 })).toBe(
      '"Alpha" was deleted; the file stays because 1 other record use it.'
    );
    expect(deletionMessage(item, { sharedWith: 2 })).toContain('2 other records');
    expect(deletionMessage(item, {})).toBe('"Alpha" was deleted; no stored file was found for it.');
  });
});

describe('bulkMessage', () => {
  it('counts, pluralises, names the verb and the folder, and reports failures', () => {
    expect(bulkMessage('archive', {}, { updated: 1, failed: 0 })).toBe('1 image archived.');
    expect(bulkMessage('tag', {}, { updated: 3, failed: 0 })).toBe('3 images retagged.');
    expect(bulkMessage('move', { folder: 'aws' }, { updated: 2, failed: 1 })).toBe(
      '2 images moved to aws; 1 failed.'
    );
    expect(bulkMessage('delete', {}, { updated: 2, failed: 0 })).toBe(
      '2 images deleted permanently.'
    );
  });
});

describe('after a bulk action', () => {
  it('clears the selection for the actions that move images out of view', () => {
    expect(['delete', 'trash', 'archive', 'restore'].every(bulkClearsSelection)).toBe(true);
    expect(bulkClearsSelection('tag')).toBe(false);
    expect(bulkClearsSelection('move')).toBe(false);
  });

  it('closes the details only when a delete took the open image', () => {
    const targets = [{ id: 'a' }, { id: 'b' }];
    expect(bulkClosesDetails(targets, 'delete', 'a')).toBe(true);
    expect(bulkClosesDetails(targets, 'delete', 'c')).toBe(false);
    expect(bulkClosesDetails(targets, 'trash', 'a')).toBe(false);
  });
});

describe('selection sets', () => {
  it('add and remove without mutating', () => {
    const start = new Set(['a']);
    expect([...withIds(start, ['b', 'c'])]).toEqual(['a', 'b', 'c']);
    expect([...withoutIds(new Set(['a', 'b', 'c']), ['b'])]).toEqual(['a', 'c']);
    expect([...start]).toEqual(['a']);
  });
});

describe('pagePosition and listingSummary', () => {
  it('derive the page and the 1-based range from offset, limit and total', () => {
    expect(pagePosition({ offset: 120, limit: 60 }, 150, 30)).toEqual({
      page: 3,
      pageCount: 3,
      first: 121,
      last: 150,
    });
    expect(pagePosition({ offset: 0, limit: 60 }, 0, 0)).toEqual({
      page: 1,
      pageCount: 1,
      first: 0,
      last: 0,
    });
  });

  it('say loading, or the range with the selection count only when there is one', () => {
    const filters = { offset: 0, limit: 60 };
    expect(listingSummary({ loading: true, filters, total: 9, count: 9, selectedCount: 2 })).toBe(
      'Loading images…'
    );
    expect(listingSummary({ loading: false, filters, total: 9, count: 9, selectedCount: 0 })).toBe(
      'Showing 1–9 of 9'
    );
    expect(listingSummary({ loading: false, filters, total: 9, count: 9, selectedCount: 2 })).toBe(
      'Showing 1–9 of 9 · 2 selected'
    );
  });
});

describe('filter values', () => {
  const items = [{ provider: 'oracle', slot: 'hero', customTags: ['cloud'] }];
  it('prefer the server facets, uppercasing providers as badges are', () => {
    const facets = { providers: ['aws'], slots: ['rss'], tags: ['edge'] };
    expect(providerValuesFrom(facets, items)).toEqual(['AWS']);
    expect(slotValuesFrom(facets, items)).toEqual(['rss']);
    expect(tagValuesFrom(facets, items)).toEqual(['edge']);
  });

  it('derive from the items on screen when the facets are missing or empty', () => {
    expect(providerValuesFrom(null, items)).toEqual(['ORACLE']);
    expect(slotValuesFrom({ slots: [] }, items)).toEqual(['hero']);
    expect(tagValuesFrom({}, items)).toEqual(['cloud']);
  });
});
