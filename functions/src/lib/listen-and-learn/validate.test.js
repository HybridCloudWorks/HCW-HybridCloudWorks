import { describe, it, expect } from 'vitest';
import {
  checkBoolean,
  checkEnum,
  checkInteger,
  checkPattern,
  checkTags,
  checkText,
  checkUrl,
  collectFields,
  firstError,
} from './validate.js';

describe('checkText', () => {
  it('skips an absent field, clears an empty optional one, refuses an empty required one', () => {
    expect(checkText(undefined, 'author', 10)).toEqual({ skip: true });
    expect(checkText('', 'author', 10)).toEqual({ value: null });
    expect(checkText(null, 'author', 10)).toEqual({ value: null });
    expect(checkText('', 'title', 10, { required: true })).toEqual({ error: 'title is required' });
    expect(checkText('   ', 'title', 10, { required: true })).toEqual({
      error: 'title is required',
    });
  });

  it('collapses whitespace, bounds the length, and refuses a non-string', () => {
    expect(checkText('  Cloud   design ', 'title', 20)).toEqual({ value: 'Cloud design' });
    expect(checkText('x'.repeat(21), 'title', 20)).toEqual({
      error: 'title must be at most 20 characters',
    });
    expect(checkText(42, 'title', 20)).toEqual({ error: 'title must be a string' });
  });
});

describe('checkUrl', () => {
  it('takes https and site-relative paths, nothing executable, within the bound', () => {
    expect(checkUrl('https://example.test/a.png', 'coverImageUrl', 500)).toEqual({
      value: 'https://example.test/a.png',
    });
    expect(checkUrl('/api/public/media/covers/a.png', 'coverImageUrl', 500)).toEqual({
      value: '/api/public/media/covers/a.png',
    });
    expect(checkUrl('javascript:alert(1)', 'coverImageUrl', 500)).toEqual({
      error: 'coverImageUrl must be an https URL or a site-relative path',
    });
    expect(checkUrl('http://example.test/a.png', 'coverImageUrl', 500).error).toBeDefined();
    expect(checkUrl(`https://e.test/${'a'.repeat(500)}`, 'coverImageUrl', 500)).toEqual({
      error: 'coverImageUrl must be at most 500 characters',
    });
    expect(checkUrl(undefined, 'coverImageUrl', 500)).toEqual({ skip: true });
    expect(checkUrl('', 'coverImageUrl', 500)).toEqual({ value: null });
    expect(checkUrl(7, 'coverImageUrl', 500)).toEqual({ error: 'coverImageUrl must be a string' });
  });
});

describe('checkTags', () => {
  const limits = { maxTags: 4, maxTagLength: 5 };

  it('lower-cases, trims, drops empties and duplicates; null clears', () => {
    expect(checkTags([' Cloud', 'cloud', '', 'Edge '], limits)).toEqual({
      value: ['cloud', 'edge'],
    });
    expect(checkTags(null, limits)).toEqual({ value: [] });
    expect(checkTags(undefined, limits)).toEqual({ skip: true });
  });

  it('refuses a non-array, a non-string entry, too many tags and a long tag', () => {
    expect(checkTags('cloud', limits)).toEqual({ error: 'tags must be an array of strings' });
    expect(checkTags(['a', 3], limits)).toEqual({ error: 'tags must be an array of strings' });
    expect(checkTags(['a', 'b', 'c', 'd', 'e'], limits)).toEqual({
      error: 'tags must hold at most 4 entries',
    });
    expect(checkTags(['toolong'], limits)).toEqual({ error: 'a tag must be at most 5 characters' });
  });
});

describe('the small checks', () => {
  it('checkEnum names the choices', () => {
    expect(checkEnum('book', 'kind', ['course', 'book'])).toEqual({ value: 'book' });
    expect(checkEnum('zine', 'kind', ['course', 'book'])).toEqual({
      error: 'kind must be one of course, book',
    });
    expect(checkEnum(undefined, 'kind', ['course'])).toEqual({ skip: true });
  });

  it('checkBoolean takes only true or false', () => {
    expect(checkBoolean(false, 'archived')).toEqual({ value: false });
    expect(checkBoolean('yes', 'archived')).toEqual({ error: 'archived must be true or false' });
    expect(checkBoolean(undefined, 'archived')).toEqual({ skip: true });
  });

  it('checkInteger reads numbers and numeric strings within the range', () => {
    expect(checkInteger('7', 'order', { min: 0, max: 10 })).toEqual({ value: 7 });
    expect(checkInteger(11, 'order', { min: 0, max: 10 })).toEqual({
      error: 'order must be a whole number between 0 and 10',
    });
    expect(checkInteger(1.5, 'order', { min: 0, max: 10 }).error).toBeDefined();
    expect(checkInteger(undefined, 'order', { min: 0, max: 10 })).toEqual({ skip: true });
  });

  it("checkPattern uses the caller's sentence", () => {
    expect(checkPattern('abc123', /^[a-z0-9]+$/, 'must name a version')).toEqual({
      value: 'abc123',
    });
    expect(checkPattern('a b', /^[a-z0-9]+$/, 'must name a version')).toEqual({
      error: 'must name a version',
    });
    expect(checkPattern(9, /^[0-9]+$/, 'must be digits')).toEqual({ error: 'must be digits' });
  });

  it('firstError answers the first rule that holds, or null', () => {
    expect(
      firstError([
        [false, 'a'],
        [true, 'b'],
        [true, 'c'],
      ])
    ).toBe('b');
    expect(firstError([[false, 'a']])).toBeNull();
  });
});

describe('collectFields', () => {
  it('keeps only the fields named, in order, and stops at the first error', () => {
    expect(
      collectFields([
        ['title', { value: 'T' }],
        ['author', { skip: true }],
        ['tags', { value: [] }],
      ])
    ).toEqual({ value: { title: 'T', tags: [] } });
    expect(
      collectFields([
        ['title', { value: 'T' }],
        ['author', { error: 'author must be a string' }],
        ['tags', { error: 'tags must be an array of strings' }],
      ])
    ).toEqual({ error: 'author must be a string' });
  });

  it('refuses a body that names nothing', () => {
    expect(collectFields([['title', { skip: true }]])).toEqual({ error: 'Nothing to change' });
  });
});
