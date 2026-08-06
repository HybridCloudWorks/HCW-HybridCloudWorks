import { describe, it, expect, vi } from 'vitest';
import {
  normalizeUrlForDedup,
  normalizeTitleForDedup,
  getDocDateValue,
  findDuplicateContent,
  buildDedupFields,
  TITLE_DEDUP_WINDOW_MS,
} from './content-dedup.js';

describe('normalizeUrlForDedup', () => {
  it('canonicalizes protocol, www, fragment, and trailing slashes', () => {
    expect(normalizeUrlForDedup('http://www.Example.com/Post/#section')).toBe(
      'https://example.com/Post'
    );
    expect(normalizeUrlForDedup('https://example.com///')).toBe('https://example.com/');
  });

  it('strips tracking params but keeps meaningful ones', () => {
    expect(
      normalizeUrlForDedup('https://example.com/a?utm_source=x&utm_medium=y&page=2&fbclid=z&ref=hn')
    ).toBe('https://example.com/a?page=2');
  });

  it('returns null on garbage', () => {
    expect(normalizeUrlForDedup('not a url')).toBeNull();
    expect(normalizeUrlForDedup('')).toBeNull();
    expect(normalizeUrlForDedup(null)).toBeNull();
    expect(normalizeUrlForDedup(42)).toBeNull();
  });
});

describe('normalizeTitleForDedup', () => {
  it('folds case, diacritics, punctuation, and whitespace', () => {
    expect(normalizeTitleForDedup('  Café: Résumé — Part 2!  ')).toBe('cafe resume part 2');
    expect(normalizeTitleForDedup('Same Title')).toBe(normalizeTitleForDedup('same   title.'));
  });

  it('returns null when nothing survives', () => {
    expect(normalizeTitleForDedup('—!!—')).toBeNull();
    expect(normalizeTitleForDedup('')).toBeNull();
  });
});

describe('getDocDateValue', () => {
  it('accepts Date, Firestore-style Timestamp, and ISO strings', () => {
    const d = new Date('2026-01-15T00:00:00Z');
    expect(getDocDateValue(d)).toBe(d);
    expect(getDocDateValue({ toDate: () => d })).toBe(d);
    // Migrated Cosmos docs carry ISO strings — the deliberate adaptation.
    expect(getDocDateValue('2026-01-15T00:00:00.000Z')?.getTime()).toBe(d.getTime());
  });

  it('rejects unparseable values instead of returning Invalid Date', () => {
    expect(getDocDateValue('not a date')).toBeNull();
    expect(getDocDateValue(null)).toBeNull();
    expect(getDocDateValue(123)).toBeNull();
  });
});

/** Store fake: routes each query to a canned result by matched field. */
function makeStore(hits = {}) {
  return {
    queryDocs: vi.fn(async (container, query) => {
      expect(container).toBe('content');
      for (const [needle, rows] of Object.entries(hits)) {
        if (query.includes(needle)) return rows;
      }
      return [];
    }),
  };
}

describe('findDuplicateContent stage order', () => {
  const candidate = {
    url: 'https://www.example.com/post?utm_source=feed',
    canonicalUrl: 'https://example.com/canonical',
    title: 'A sufficiently long title here',
    publishedAt: '2026-02-01T00:00:00Z',
  };

  it('short-circuits on the exact-URL stage and never runs later stages', async () => {
    const store = makeStore({ 'c["sourceUrl"]': [{ id: 'dup-1' }] });
    const result = await findDuplicateContent(store, candidate);
    expect(result).toEqual({ duplicate: true, reason: 'exact_url', existingId: 'dup-1' });
    expect(store.queryDocs).toHaveBeenCalledTimes(1);
  });

  it('falls through to the legacy CD Url field', async () => {
    const store = makeStore({ 'c["CD Url"]': [{ id: 'dup-legacy' }] });
    const result = await findDuplicateContent(store, candidate);
    expect(result.reason).toBe('legacy_url');
    expect(result.existingId).toBe('dup-legacy');
  });

  it('matches on the normalized URL after exact misses', async () => {
    const store = {
      queryDocs: vi.fn(async (_c, query, params) => {
        if (query.includes('c["normalizedUrl"]')) {
          // The stage must query with the tracking-param-stripped form.
          expect(params[0].value).toBe('https://example.com/post');
          return [{ id: 'dup-2' }];
        }
        return [];
      }),
    };
    const result = await findDuplicateContent(store, candidate);
    expect(result.reason).toBe('normalized_url');
  });

  it('checks the canonical URL only when distinct from the normalized URL', async () => {
    const store = makeStore({ 'c["canonicalUrl"]': [{ id: 'dup-3' }] });
    const result = await findDuplicateContent(store, candidate);
    expect(result.reason).toBe('canonical_url');

    // Same canonical as the page URL → the stage is skipped entirely.
    const skipStore = makeStore({ 'c["canonicalUrl"]': [{ id: 'dup-3' }] });
    const same = await findDuplicateContent(skipStore, {
      ...candidate,
      canonicalUrl: candidate.url,
    });
    expect(same.duplicate).toBe(false);
  });

  it('matches titles only within the seven-day window, reading ISO dates', async () => {
    const inWindow = new Date(Date.parse(candidate.publishedAt) + TITLE_DEDUP_WINDOW_MS - 1000);
    const outOfWindow = new Date(Date.parse(candidate.publishedAt) + TITLE_DEDUP_WINDOW_MS + 60_000);

    const hit = makeStore({
      'c.normalizedTitle': [{ id: 'dup-4', publishedAt: inWindow.toISOString() }],
    });
    expect((await findDuplicateContent(hit, candidate)).reason).toBe('title_within_window');

    const miss = makeStore({
      'c.normalizedTitle': [{ id: 'dup-4', publishedAt: outOfWindow.toISOString() }],
    });
    expect((await findDuplicateContent(miss, candidate)).duplicate).toBe(false);
  });

  it('skips the title stage for short titles and undated matches', async () => {
    const store = makeStore({ 'c.normalizedTitle': [{ id: 'x' }] });
    // < 8 chars normalized → stage disabled
    expect((await findDuplicateContent(store, { ...candidate, title: 'Short' })).duplicate).toBe(
      false
    );
    // dated-field-free match rows are ignored, not treated as duplicates
    expect((await findDuplicateContent(store, candidate)).duplicate).toBe(false);
  });

  it('reports non-duplicate with no store calls when the candidate is empty', async () => {
    const store = makeStore();
    const result = await findDuplicateContent(store, {});
    expect(result).toEqual({ duplicate: false });
    expect(store.queryDocs).not.toHaveBeenCalled();
  });
});

describe('buildDedupFields', () => {
  it('emits only the fields that normalize to something', () => {
    expect(
      buildDedupFields({
        url: 'https://www.example.com/a/?utm_source=x',
        canonicalUrl: 'not a url',
        title: 'A Title!',
      })
    ).toEqual({ normalizedUrl: 'https://example.com/a', normalizedTitle: 'a title' });
    expect(buildDedupFields({})).toEqual({});
  });
});
