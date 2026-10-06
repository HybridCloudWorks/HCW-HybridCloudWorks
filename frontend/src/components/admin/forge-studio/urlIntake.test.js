/**
 * URL intake for From a URL (owner request 2026-10-06): what a pasted block
 * and a saved .html page yield, how the list is bounded, how a URL reads.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_URLS_PER_IMPORT,
  decodeEntities,
  extractUrls,
  extractUrlsFromHtml,
  extractUrlsFromText,
  mergeDetected,
  normalizeUrl,
  shortUrl,
} from './urlIntake';

describe('normalizeUrl', () => {
  it('keeps http(s), drops the fragment and trailing prose punctuation, refuses the rest', () => {
    expect(normalizeUrl(' https://a.test/p?utm_source=x#top ')).toBe(
      'https://a.test/p?utm_source=x'
    );
    expect(normalizeUrl('https://a.test/p).')).toBe('https://a.test/p');
    expect(normalizeUrl('mailto:x@y.test')).toBe('');
    expect(normalizeUrl('javascript:alert(1)')).toBe('');
    expect(normalizeUrl('a.test/no-scheme')).toBe('');
  });
});

describe('extractUrlsFromText', () => {
  it('finds every distinct URL in order, one per line or inside prose', () => {
    const text = `Read https://a.test/one, then https://b.test/two.
https://a.test/one#again
(https://c.test/three) and "https://d.test/four"`;
    expect(extractUrlsFromText(text)).toEqual([
      'https://a.test/one',
      'https://b.test/two',
      'https://c.test/three',
      'https://d.test/four',
    ]);
    expect(extractUrlsFromText('no links here')).toEqual([]);
    expect(extractUrlsFromText(null)).toEqual([]);
  });
});

describe('extractUrlsFromHtml', () => {
  const page = `<html><body>
    <a href="https://a.test/one">One</a>
    <a href='https://b.test/two?x=1#frag'>Two</a>
    <a href=https://a.test/one>Dup</a>
    <a href="/relative">Rel</a>
    <a href="#top">Top</a>
    <a href="mailto:x@y.test">Mail</a>
    <a href="javascript:void(0)">JS</a>
    <p>Bare https://c.test/three in text.</p>
  </body></html>`;

  it('takes every linked http(s) URL once, skips anchors, mailto and javascript, then bare URLs', () => {
    expect(extractUrlsFromHtml(page)).toEqual([
      'https://a.test/one',
      'https://b.test/two?x=1',
      'https://c.test/three',
    ]);
  });

  it('decodes entities in an href, so a query with &amp; keeps its second parameter', () => {
    const html =
      '<a href="https://a.test/?x=1&amp;y=2">q</a> <a href="https://b.test/&#x2F;p">n</a>';
    expect(extractUrlsFromHtml(html)).toEqual(['https://a.test/?x=1&y=2', 'https://b.test//p']);
    expect(decodeEntities('a &amp; b &lt; &#65; &quot;c&quot;')).toBe('a & b < A "c"');
  });

  it('resolves relative links only when a base URL is given', () => {
    expect(extractUrlsFromHtml(page, { baseUrl: 'https://site.test/news/' })).toContain(
      'https://site.test/relative'
    );
  });

  it('extractUrls decides by content: a tag with an href is HTML, otherwise text', () => {
    expect(extractUrls('<a href="https://a.test/x">x</a> https://b.test/y')).toEqual([
      'https://a.test/x',
      'https://b.test/y',
    ]);
    expect(extractUrls('https://a.test/x\nhttps://b.test/y')).toEqual([
      'https://a.test/x',
      'https://b.test/y',
    ]);
    expect(extractUrls('<p>plain</p>', { html: true })).toEqual([]);
  });
});

describe('mergeDetected', () => {
  it('adds distinct URLs in order, ignores repeats and junk, and caps the list', () => {
    const { urls, dropped } = mergeDetected(
      ['https://a.test/1'],
      ['https://a.test/1', 'https://b.test/2', 'nope', 'https://b.test/2#x']
    );
    expect(urls).toEqual(['https://a.test/1', 'https://b.test/2']);
    expect(dropped).toBe(0);

    const many = Array.from({ length: MAX_URLS_PER_IMPORT + 5 }, (_, i) => `https://n.test/${i}`);
    const capped = mergeDetected([], many);
    expect(capped.urls).toHaveLength(MAX_URLS_PER_IMPORT);
    expect(capped.dropped).toBe(5);
  });
});

describe('shortUrl', () => {
  it('shows host and path without scheme, query or trailing slash', () => {
    expect(shortUrl('https://www.finops.org/insights/agentic/?utm_source=x')).toBe(
      'www.finops.org/insights/agentic'
    );
    expect(shortUrl('https://a.test/')).toBe('a.test');
    expect(shortUrl('garbage')).toBe('garbage');
  });
});
