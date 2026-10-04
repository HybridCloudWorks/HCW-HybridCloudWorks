/**
 * The queue view in the URL (PR #841): what is read on mount, with its
 * defaults, and what is written back.
 */
import { describe, it, expect } from 'vitest';
import {
  buildQueueSearchParams,
  PAGE_SIZES,
  readPageSize,
  readSortDirection,
  readSortKey,
} from './viewParams';

const params = (query) => new URLSearchParams(query);

describe('reading the view', () => {
  it('takes a known sort key and falls back to published otherwise', () => {
    expect(readSortKey(params('sort=title'))).toBe('title');
    expect(readSortKey(params('sort=bogus'))).toBe('published');
    expect(readSortKey(params(''))).toBe('published');
  });

  it('is descending unless the URL says asc', () => {
    expect(readSortDirection(params('dir=asc'))).toBe('asc');
    expect(readSortDirection(params('dir=up'))).toBe('desc');
    expect(readSortDirection(params(''))).toBe('desc');
  });

  it('accepts only the offered page sizes, else 100', () => {
    for (const size of PAGE_SIZES) expect(readPageSize(params(`pageSize=${size}`))).toBe(size);
    expect(readPageSize(params('pageSize=75'))).toBe(100);
    expect(readPageSize(params(''))).toBe(100);
  });
});

describe('buildQueueSearchParams', () => {
  const view = {
    statusFilter: 'rejected',
    contentTypeFilter: 'blog',
    kindFilter: 'all',
    ideaOriginFilter: 'all',
    pageSize: 50,
    sortKey: 'domain',
    sortDirection: 'asc',
  };

  it('writes every filter, leaving out taxonomy filters that are not narrowed', () => {
    expect(buildQueueSearchParams(view).toString()).toBe(
      'status=rejected&contentType=blog&pageSize=50&sort=domain&dir=asc'
    );
  });

  it('writes a narrowed taxonomy filter', () => {
    const narrowed = { ...view, kindFilter: 'article', ideaOriginFilter: 'imported-source' };
    const out = buildQueueSearchParams(narrowed);
    expect(out.get('kind')).toBe('article');
    expect(out.get('ideaOrigin')).toBe('imported-source');
  });

  it('round-trips through the readers', () => {
    const out = buildQueueSearchParams(view);
    expect(readSortKey(out)).toBe('domain');
    expect(readSortDirection(out)).toBe('asc');
    expect(readPageSize(out)).toBe(50);
  });
});
