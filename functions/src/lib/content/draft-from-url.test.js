/**
 * URL → draft (Blog Machine T-602): scrape orchestration, supporting-material
 * assembly under the drafter's 5-document ceiling, both callers' payload
 * dialects, and the HTTP handler's error mapping — the codes are the
 * contract the Publish-Ready Builder shows to the owner.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isHttpUrl,
  extractPageTitle,
  extractPageDescription,
  inferProviderFromUrl,
  scrapeToSource,
  createUrlDrafter,
  createGenerateArticleDraftHandler,
  buildUrlSourceDoc,
  MAX_EXTRA_URL_SCRAPES,
} from './draft-from-url.js';

const PAGE_HTML = `<html><head>
  <title>Fallback Title</title>
  <meta property="og:title" content="OG Title" />
  <meta property="og:description" content="OG description." />
</head><body>x</body></html>`;

const goodScrape = (over = {}) => ({
  success: true,
  markdown: '# Article\n\nBody text.',
  html: PAGE_HTML,
  plainText: 'Body text.',
  images: [{ src: 'https://img.example/hero.png' }],
  wordCount: 42,
  scrapeMode: 'direct_html',
  error: null,
  ...over,
});

describe('url and page helpers', () => {
  it('isHttpUrl accepts http(s) only', () => {
    expect(isHttpUrl('https://a.example/x')).toBe(true);
    expect(isHttpUrl('http://a.example')).toBe(true);
    expect(isHttpUrl('ftp://a.example')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('extractPageTitle prefers og:title, falls back to <title>, then the fallback', () => {
    expect(extractPageTitle(PAGE_HTML)).toBe('OG Title');
    expect(extractPageTitle('<html><head><title>T</title></head></html>')).toBe('T');
    expect(extractPageTitle('<html></html>', 'fb')).toBe('fb');
  });

  it('extractPageDescription reads og:description then meta description', () => {
    expect(extractPageDescription(PAGE_HTML)).toBe('OG description.');
    expect(extractPageDescription('<meta name="description" content="plain">')).toBe('plain');
    expect(extractPageDescription('')).toBe('');
  });

  it('inferProviderFromUrl maps the same keywords the Builder uses, Multi otherwise', () => {
    expect(inferProviderFromUrl('https://learn.microsoft.com/azure/aks')).toBe('Azure');
    expect(inferProviderFromUrl('https://aws.amazon.com/blogs/x')).toBe('Aws');
    expect(inferProviderFromUrl('https://cloud.google.com/run')).toBe('Gcp');
    expect(inferProviderFromUrl('https://example.com/post')).toBe('Multi');
  });
});

describe('scrapeToSource', () => {
  it('rejects a non-http URL with BAD_URL before any network touch', async () => {
    const scrape = vi.fn();
    await expect(scrapeToSource('notaurl', { scrape })).rejects.toMatchObject({
      code: 'BAD_URL',
    });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('maps a failed or empty scrape to SCRAPE_FAILED with the scraper reason', async () => {
    const scrape = vi.fn(async () => ({ success: false, error: 'Status code 403' }));
    await expect(scrapeToSource('https://a.example/x', { scrape })).rejects.toMatchObject({
      code: 'SCRAPE_FAILED',
      message: expect.stringContaining('Status code 403'),
    });
  });

  it('returns markdown, title, description and images on success', async () => {
    const scrape = vi.fn(async () => goodScrape());
    const source = await scrapeToSource('https://a.example/x ', { scrape });
    expect(source).toMatchObject({
      url: 'https://a.example/x',
      markdown: '# Article\n\nBody text.',
      title: 'OG Title',
      description: 'OG description.',
      wordCount: 42,
      scrapeMode: 'direct_html',
    });
  });
});

describe('createUrlDrafter', () => {
  const makeDrafter = () => ({
    generateDraft: vi.fn(async () => ({
      title: 'Drafted',
      summary: 'S',
      postContent: '# P',
      keyTopics: ['a'],
      summaryPrompt: 'sp',
      detailsPrompt: 'dp',
      suggestedContentType: 'blog',
    })),
  });

  it('drafts from the primary URL, inferring the provider when none is given', async () => {
    const drafter = makeDrafter();
    const scrape = vi.fn(async () => goodScrape());
    const { draftFromUrl } = createUrlDrafter({ drafter, scrape });
    const result = await draftFromUrl({ url: 'https://learn.microsoft.com/azure/x' });
    expect(result.draft.title).toBe('Drafted');
    expect(result.draft.sourceUrls).toEqual(['https://learn.microsoft.com/azure/x']);
    const call = drafter.generateDraft.mock.calls[0][0];
    expect(call).toMatchObject({
      url: 'https://learn.microsoft.com/azure/x',
      cloudProvider: 'Azure',
      scrapedTitle: 'OG Title',
      description: 'OG description.',
      markdown: '# Article\n\nBody text.',
    });
  });

  it("merges both dialects' instructions and folds draftText in as a supporting document", async () => {
    const drafter = makeDrafter();
    const scrape = vi.fn(async () => goodScrape());
    const { draftFromUrl } = createUrlDrafter({ drafter, scrape });
    await draftFromUrl({
      url: 'https://a.example/x',
      customInstructionPrompt: 'Builder prompt',
      instructions: 'Editor instruction',
      draftText: 'current draft body',
    });
    const call = drafter.generateDraft.mock.calls[0][0];
    expect(call.customInstructionPrompt).toBe('Builder prompt\n\nEditor instruction');
    expect(call.supportingDocuments).toEqual([
      expect.objectContaining({ name: 'Current article draft', textContent: 'current draft body' }),
    ]);
  });

  it('scrapes extra KB urls (capped) and tolerates one failing', async () => {
    const drafter = makeDrafter();
    const scrape = vi.fn(async (url) => {
      if (url.includes('broken')) return { success: false, error: 'nope' };
      return goodScrape();
    });
    const { draftFromUrl } = createUrlDrafter({ drafter, scrape });
    const extras = ['https://kb.example/1', 'https://kb.example/broken', 'https://kb.example/2'];
    const result = await draftFromUrl({
      url: 'https://a.example/x',
      urls: ['https://a.example/x', ...extras, 'https://kb.example/beyond-cap'],
    });
    // primary + capped extras recorded as provenance
    expect(result.draft.sourceUrls).toEqual(['https://a.example/x', ...extras]);
    expect(scrape).toHaveBeenCalledTimes(1 + MAX_EXTRA_URL_SCRAPES);
    const docs = drafter.generateDraft.mock.calls[0][0].supportingDocuments;
    expect(docs).toHaveLength(2); // the broken extra degraded, it did not fail the draft
    expect(docs[0].name).toMatch(/^KB article: /);
  });

  it('fetches documentUrls server-side: pdf as base64, text inline, failures skipped', async () => {
    const drafter = makeDrafter();
    const scrape = vi.fn(async () => goodScrape());
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('.pdf'))
        return {
          ok: true,
          headers: { get: () => 'application/pdf' },
          arrayBuffer: async () => new TextEncoder().encode('PDFDATA').buffer,
        };
      if (url.endsWith('missing')) return { ok: false, headers: { get: () => '' } };
      return {
        ok: true,
        headers: { get: () => 'text/plain' },
        text: async () => 'kb text',
      };
    });
    const { draftFromUrl } = createUrlDrafter({ drafter, scrape, fetch: fetchImpl });
    await draftFromUrl({
      url: 'https://a.example/x',
      documentUrls: ['https://kb.example/doc.pdf', 'https://kb.example/missing', 'https://kb.example/notes.txt'],
    });
    const docs = drafter.generateDraft.mock.calls[0][0].supportingDocuments;
    expect(docs).toEqual([
      expect.objectContaining({ name: 'doc.pdf', mimeType: 'application/pdf' }),
      expect.objectContaining({ name: 'notes.txt', textContent: 'kb text' }),
    ]);
    expect(Buffer.from(docs[0].base64Data, 'base64').toString()).toBe('PDFDATA');
  });
});

describe('createGenerateArticleDraftHandler', () => {
  const makeRequest = (body) => ({ json: async () => body });
  const okGuard = { requireRole: vi.fn(async () => ({ oid: 'u1' })) };

  it('refuses without the editor role, before reading the body', async () => {
    const guard = {
      requireRole: vi.fn(async () => ({ error: { status: 403, body: 'no' } })),
    };
    const urlDrafter = { draftFromUrl: vi.fn() };
    const handler = createGenerateArticleDraftHandler({ guard, urlDrafter });
    const res = await handler(makeRequest({ url: 'https://a.example' }), {});
    expect(res).toEqual({ status: 403, body: 'no' });
    expect(urlDrafter.draftFromUrl).not.toHaveBeenCalled();
  });

  it('returns 200 { ok, draft } on success', async () => {
    const urlDrafter = { draftFromUrl: vi.fn(async () => ({ draft: { title: 'T' } })) };
    const handler = createGenerateArticleDraftHandler({ guard: okGuard, urlDrafter });
    const res = await handler(makeRequest({ url: 'https://a.example' }), {});
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, draft: { title: 'T' } });
  });

  it.each([
    ['BAD_URL', 400],
    ['SCRAPE_FAILED', 422],
    ['DRAFT_BUDGET_EXCEEDED', 504],
    [undefined, 502],
  ])('maps error code %s to HTTP %i', async (code, status) => {
    const err = new Error('boom');
    if (code) err.code = code;
    const urlDrafter = { draftFromUrl: vi.fn(async () => Promise.reject(err)) };
    const handler = createGenerateArticleDraftHandler({ guard: okGuard, urlDrafter });
    const res = await handler(makeRequest({ url: 'https://a.example' }), { error: vi.fn() });
    expect(res.status).toBe(status);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'boom' });
  });

  it('answers 504 when the draft outlives the budget, without waiting for it', async () => {
    const urlDrafter = { draftFromUrl: () => new Promise(() => {}) };
    const handler = createGenerateArticleDraftHandler({
      guard: okGuard,
      urlDrafter,
      budgetMs: 10,
    });
    const res = await handler(makeRequest({ url: 'https://a.example' }), { error: vi.fn() });
    expect(res.status).toBe(504);
    expect(JSON.parse(res.body).error).toMatch(/exceeded/);
  });
});

describe('buildUrlSourceDoc', () => {
  it('lands inspected with inspectTrigger off, provenance recorded, body dual-cased', () => {
    const source = {
      url: 'https://a.example/deep/post',
      markdown: '# Body',
      title: 'A Title',
      description: 'D',
      images: [{ src: 'https://img.example/h.png' }],
      scrapeMode: 'direct_html',
    };
    const doc = buildUrlSourceDoc({
      source,
      provider: 'Azure',
      now: () => new Date('2026-08-28T00:00:00Z'),
      uuid: () => 'id-1',
    });
    expect(doc).toMatchObject({
      id: 'id-1',
      Title: 'A Title',
      Content: '# Body',
      content: '# Body',
      'Cloud Provider': 'Azure',
      contentStatus: 'inspected',
      inspectTrigger: false,
      Live: false,
      source: 'forge-url',
      sourceUrl: 'https://a.example/deep/post',
      contentImageUrl: 'https://img.example/h.png',
      Slug: 'a-title',
    });
  });

  it('titles from the hostname when the page had none', () => {
    const doc = buildUrlSourceDoc({
      source: { url: 'https://blog.example/x', markdown: 'm', title: '', images: [] },
      provider: 'Multi',
      now: () => new Date(),
      uuid: () => 'id-2',
    });
    expect(doc.Title).toBe('Article from blog.example');
  });
});
