/**
 * The one rule three surfaces share (#577).
 *
 * The Live Pages report, the Social Hub's composer and the Linkie Hub's push
 * list each carried their own copy of this, with a comment in two of them
 * claiming they matched LivePagesPage. `isLiveRecord` genuinely did, byte for
 * byte. `getLiveUrl` did not — see the module header.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_URL_FIELDS, curatedUrl, getLiveUrl, isLiveRecord } from './livePages';

describe('isLiveRecord', () => {
  it('accepts each of the three ways a record says it is live', () => {
    expect(isLiveRecord({ Live: true })).toBe(true);
    expect(isLiveRecord({ Status: 'Live' })).toBe(true);
    expect(isLiveRecord({ contentStatus: 'published_blog' })).toBe(true);
  });

  it('refuses a record that says nothing', () => {
    expect(isLiveRecord({})).toBe(false);
    expect(isLiveRecord({ Live: false })).toBe(false);
    expect(isLiveRecord({ contentStatus: 'draft' })).toBe(false);
    expect(isLiveRecord(null)).toBe(false);
  });

  it('soft-deletion wins outright, even over an explicit Live', () => {
    // A record can still say Live while it is inside the delete window, and
    // offering the operator a page that is about to stop existing is worse
    // than omitting one.
    expect(isLiveRecord({ Live: true, softDeletedAt: '2026-09-01' })).toBe(false);
    expect(isLiveRecord({ Status: 'Live', softDeleteExpiresAt: '2026-10-01' })).toBe(false);
  });
});

describe('getLiveUrl', () => {
  it('trusts the explicit URL fields in order', () => {
    expect(getLiveUrl({ slugPageUrl: 'a', publishedUrl: 'b' })).toBe('a');
    expect(getLiveUrl({ publishedUrl: 'b', blogUrl: 'c' })).toBe('b');
    expect(getLiveUrl({ blogUrl: 'c', publicUrl: 'd' })).toBe('c');
    expect(getLiveUrl({ publicUrl: 'd' })).toBe('d');
  });

  it('falls back to the curated path, with or without its leading slash', () => {
    expect(getLiveUrl({ curatedSubpagePath: '/x' })).toBe('https://hybridcloudworks.com/x');
    expect(getLiveUrl({ curatedSubpagePath: 'x' })).toBe('https://hybridcloudworks.com/x');
  });

  it('is an empty string when the record names nowhere', () => {
    expect(getLiveUrl({})).toBe('');
    expect(getLiveUrl({ curatedSubpagePath: '' })).toBe('');
  });

  it('skips a blank field rather than returning it', () => {
    expect(getLiveUrl({ slugPageUrl: '', publishedUrl: 'b' })).toBe('b');
  });
});

describe('curatedUrl', () => {
  it('is empty for no path, so a caller can chain it', () => {
    expect(curatedUrl('')).toBe('');
    expect(curatedUrl(null)).toBe('');
    expect(curatedUrl(undefined)).toBe('');
  });
});

describe('LIVE_URL_FIELDS', () => {
  it('is frozen, because the order is the rule', () => {
    expect(Object.isFrozen(LIVE_URL_FIELDS)).toBe(true);
  });
});
