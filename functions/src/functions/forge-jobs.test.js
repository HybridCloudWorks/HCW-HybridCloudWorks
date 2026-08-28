/**
 * forge-from-url worker logic (Blog Machine T-602) and the target resolver
 * the /forge Telegram command depends on — its payload key mismatch shipped
 * once already (T-601), so the resolver's contract is pinned here too.
 */
import { describe, it, expect, vi } from 'vitest';

// The module registers job types on import, and registerJobType throws on a
// duplicate — so the registry is faked rather than shared across test files.
vi.mock('../lib/jobs.js', () => ({ registerJobType: vi.fn() }));
vi.mock('../lib/cosmos-client.js', () => ({
  readDoc: vi.fn(),
  queryDocs: vi.fn(),
  patchDoc: vi.fn(),
  upsertDoc: vi.fn(),
}));
vi.mock('../lib/ai/router.js', () => ({
  generateJsonResponse: vi.fn(),
  generateTextResponse: vi.fn(),
  getActiveAiProvider: vi.fn(),
}));

const { resolveForgeTargets, runForgeFromUrl, FORGE_MAX_BATCH } = await import('./forge-jobs.js');

describe('resolveForgeTargets', () => {
  it('accepts sourceContentId and sourceContentIds, deduped and trimmed', () => {
    expect(resolveForgeTargets({ sourceContentId: ' a ' })).toEqual(['a']);
    expect(resolveForgeTargets({ sourceContentIds: ['a', 'b', 'a', ''] })).toEqual(['a', 'b']);
  });

  it('rejects an empty payload and an oversized batch', () => {
    expect(() => resolveForgeTargets({})).toThrow(/sourceContentId/);
    expect(() =>
      resolveForgeTargets({ sourceContentIds: Array.from({ length: FORGE_MAX_BATCH + 1 }, (_, i) => `c${i}`) })
    ).toThrow(/At most/);
  });
});

describe('runForgeFromUrl', () => {
  const PAGE = `<html><head><title>Scraped Page</title></head></html>`;
  const deps = (over = {}) => ({
    scrape: vi.fn(async () => ({
      success: true,
      markdown: '# Source',
      html: PAGE,
      images: [],
      wordCount: 10,
      scrapeMode: 'direct_html',
    })),
    forge: {
      runForgePipeline: vi.fn(async () => ({
        ok: true,
        result: { success: true, contentId: 'new-1', status: 'forge_ready' },
      })),
    },
    store: { upsertDoc: vi.fn() },
    now: () => new Date('2026-08-28T00:00:00Z'),
    uuid: () => 'new-1',
    log: {},
    actor: { email: 'owner@hcw' },
    ...over,
  });

  it('scrapes, writes the source doc, forges it, and reports the staging status', async () => {
    const d = deps();
    const out = await runForgeFromUrl({ url: 'https://learn.microsoft.com/azure/x' }, d);
    expect(d.store.upsertDoc).toHaveBeenCalledWith(
      'content',
      expect.objectContaining({
        id: 'new-1',
        Title: 'Scraped Page',
        'Cloud Provider': 'Azure', // inferred from the URL when payload has none
        contentStatus: 'inspected',
        inspectTrigger: false,
        source: 'forge-url',
      })
    );
    expect(d.forge.runForgePipeline).toHaveBeenCalledWith({
      contentId: 'new-1',
      actor: { email: 'owner@hcw' },
    });
    expect(out).toMatchObject({ status: 'forge_ready', sourceUrl: 'https://learn.microsoft.com/azure/x' });
  });

  it('honours an explicit provider over inference', async () => {
    const d = deps();
    await runForgeFromUrl({ url: 'https://learn.microsoft.com/azure/x', provider: 'Finops' }, d);
    expect(d.store.upsertDoc.mock.calls[0][1]['Cloud Provider']).toBe('Finops');
  });

  it('fails the job on a bad URL or failed scrape, before any write', async () => {
    const d = deps({ scrape: vi.fn(async () => ({ success: false, error: '403' })) });
    await expect(runForgeFromUrl({ url: 'https://a.example/x' }, d)).rejects.toThrow(/403/);
    await expect(runForgeFromUrl({ url: 'nope' }, d)).rejects.toMatchObject({ code: 'BAD_URL' });
    expect(d.store.upsertDoc).not.toHaveBeenCalled();
  });

  it('reports a duplicate (409) as skipped instead of failing the job', async () => {
    const d = deps({
      forge: {
        runForgePipeline: vi.fn(async () => ({
          ok: false,
          httpStatus: 409,
          error: 'Skipped as likely duplicate of published "X"',
          duplicateOf: 'X',
        })),
      },
    });
    const out = await runForgeFromUrl({ url: 'https://a.example/x' }, d);
    expect(out).toMatchObject({ success: false, skipped: true, duplicateOf: 'X' });
  });

  it('fails the job when the pipeline fails for any non-duplicate reason', async () => {
    const d = deps({
      forge: {
        runForgePipeline: vi.fn(async () => ({ ok: false, httpStatus: 502, error: 'Generation failed' })),
      },
    });
    await expect(runForgeFromUrl({ url: 'https://a.example/x' }, d)).rejects.toThrow(
      /Generation failed/
    );
  });
});
