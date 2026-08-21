import { describe, it, expect, vi } from 'vitest';
import {
  scrapeArticle,
  extractArticle,
  extractPublishedDate,
  htmlToMarkdown,
  absoluteImageUrl,
  referenceScrapedImages,
} from './scrape.js';

const body = 'Real article text. '.repeat(40);
const page = `<html><head>
<script type="application/ld+json">{"@type":"Article","datePublished":"2026-08-10T15:30:00+02:00"}</script>
<meta property="article:published_time" content="2026-08-11T00:00:00Z">
</head><body><nav>menu</nav><article><h1>Title</h1><p>${body}</p><img src="/img/a.png" alt="A"><img src="https://cdn/b.jpg"><img src="data:image/png;base64,xx"></article><footer>f</footer></body></html>`;

const ok = (text, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => text,
  json: async () => JSON.parse(text),
});

describe('extractArticle / markdown', () => {
  it('picks the article block, strips nav/footer, resolves image urls', () => {
    const { articleHtml, contentText, images } = extractArticle(page, 'https://site.test/post');
    expect(contentText).toContain('Real article text');
    expect(contentText).not.toContain('menu');
    expect(articleHtml).toContain('<h1>Title</h1>');
    expect(images).toEqual([
      { url: 'https://site.test/img/a.png', alt: 'A', index: 0 },
      { url: 'https://cdn/b.jpg', alt: '', index: 1 },
    ]);
    expect(htmlToMarkdown('<h2>H</h2><p>p <b>b</b></p>')).toBe('## H\n\np **b**');
    expect(absoluteImageUrl('//cdn/x.png', 'https://a.b/c')).toBe('https://cdn/x.png');
    expect(absoluteImageUrl('rel.png', 'https://a.b/c')).toBe('https://a.b/rel.png');
  });
});

describe('extractPublishedDate', () => {
  it('prefers meta tags over JSON-LD (first valid meta wins) and returns midnight UTC', () => {
    expect(extractPublishedDate(page).toISOString()).toBe('2026-08-11T00:00:00.000Z');
    const ldOnly =
      '<script type="application/ld+json">{"datePublished":"2026-08-10T23:59:00Z"}</script>';
    expect(extractPublishedDate(ldOnly).toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(extractPublishedDate('<time datetime="2026-01-05">x</time>').toISOString()).toBe(
      '2026-01-05T00:00:00.000Z'
    );
    expect(extractPublishedDate('<p>no date</p>')).toBeNull();
    expect(extractPublishedDate('')).toBeNull();
  });
});

describe('scrapeArticle', () => {
  it('returns the direct-html shape with the full page kept for date extraction', async () => {
    const fetch = vi.fn(async () => ok(page));
    const r = await scrapeArticle('https://site.test/post', { fetch, env: {}, now: () => 0 });
    expect(r).toMatchObject({ success: true, scrapeMode: 'direct_html', error: null });
    expect(r.html).toBe(page);
    expect(r.markdown).toContain('# Title');
    expect(r.images).toHaveLength(2);
    expect(r.wordCount).toBeGreaterThan(100);
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toMatch(/Mozilla/);
  });

  it('fails closed by default, and uses the reader fallback only when enabled', async () => {
    const failing = vi.fn(async () => ok('nope', 403));
    const r = await scrapeArticle('https://site.test/post', {
      fetch: failing,
      env: {},
      now: () => 0,
    });
    expect(r).toMatchObject({ success: false, scrapeMode: 'failed', error: 'Status code 403' });
    expect(failing).toHaveBeenCalledTimes(1);

    const withReader = vi.fn(async (url) =>
      String(url).startsWith('https://r.jina.ai/') ? ok('reader text '.repeat(60)) : ok('nope', 403)
    );
    const r2 = await scrapeArticle('https://site.test/post', {
      fetch: withReader,
      env: { CONTENTFORGE_SCRAPE_FALLBACK_ENABLED: 'true' },
      now: () => 0,
    });
    expect(r2).toMatchObject({ success: true, scrapeMode: 'reader_fallback' });
    expect(withReader.mock.calls[1][0]).toBe('https://r.jina.ai/http://site.test/post');
  });

  it('a TLS error is a failure, never a bypass', async () => {
    const fetch = vi.fn(async () => {
      throw Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    });
    const r = await scrapeArticle('https://site.test/post', { fetch, env: {}, now: () => 0 });
    expect(r.success).toBe(false);
    expect(r.scrapeFailureReason).toMatch(/certificate/);
  });

  it('referenceScrapedImages keeps ten URL references', () => {
    const refs = referenceScrapedImages(
      Array.from({ length: 12 }, (_, i) => ({ url: `https://s/${i}`, alt: `a${i}` }))
    );
    expect(refs).toHaveLength(10);
    expect(refs[0]).toEqual({ original: 'https://s/0', alt: 'a0', index: 0 });
  });
});
