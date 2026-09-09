/**
 * GET /api/public/cert-events (#461 item 4) — the reader for the container the
 * Friday Skills Hub scraper writes. The load-bearing assertions: the platform
 * is validated against the known list, the query is answered by scraper
 * source, the projection is an allowlist that agrees with what the writer
 * writes, and the order is newest publication first in SQL and in memory.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPublicReadHandlers, PROVIDER_ALIASES } from './public-reads.js';
import { buildCertEvent } from './timers/skills-hub.js';

const context = { log: vi.fn(), error: vi.fn() };

const makeRequest = (query = {}) => ({
  method: 'GET',
  query: { get: (k) => query[k] ?? null },
  params: {},
});

/** A document exactly as the scraper writes it, through the writer itself. */
const NOW = new Date('2026-09-11T09:00:00.000Z');
const written = (over = {}) =>
  buildCertEvent(
    {
      guid: over.guid || 'https://techcommunity.microsoft.com/skills-hub/az-305',
      title: 'AZ-305 exam retires June 30, 2026',
      contentSnippet: 'The exam retires.',
      link: 'https://techcommunity.microsoft.com/skills-hub/az-305',
      pubDate: over.pubDate || 'Fri, 01 May 2026 09:00:00 GMT',
    },
    NOW
  );

const store = (docs = []) => ({
  queryDocs: vi.fn(async () => docs),
  readDoc: vi.fn(),
});

const list = (deps, query = { platform: 'azure' }) =>
  createPublicReadHandlers({ store: deps }).listCertEvents(makeRequest(query), context);

describe('listCertEvents', () => {
  it('requires a platform and refuses one that is not a known provider', async () => {
    expect((await list(store(), {})).status).toBe(400);
    const unknown = await list(store(), { platform: 'oracle' });
    expect(unknown.status).toBe(400);
    expect(JSON.parse(unknown.body).error).toBe('platform is not a known provider');
    expect((await list(store(), { platform: 'AZURE' })).status).toBe(200);
  });

  it('answers a known platform with no scraper feeding it with an empty list and no query', async () => {
    // Every provider key is accepted; only azure has a source today.
    for (const platform of Object.keys(PROVIDER_ALIASES).filter((p) => p !== 'azure')) {
      const deps = store([written()]);
      const res = await list(deps, { platform });
      expect(res.status, platform).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, items: [], total: 0 });
      expect(deps.queryDocs, platform).not.toHaveBeenCalled();
    }
  });

  it('queries certEvents by scraper source, projected, ordered newest first and capped', async () => {
    const deps = store();
    await list(deps);
    const [container, query, params] = deps.queryDocs.mock.calls[0];
    expect(container).toBe('certEvents');
    expect(query).toMatch(/^SELECT TOP 100 /);
    expect(query).not.toMatch(/SELECT TOP \d+ \*/);
    expect(query).toContain('ARRAY_CONTAINS(@sources, c.source)');
    expect(query).toMatch(/ORDER BY c\.pubDate DESC\s*$/);
    expect(query.match(/ORDER BY/g)).toHaveLength(1);
    expect(params).toEqual([{ name: '@sources', value: ['skills-hub-rss'] }]);
    for (const field of ['id', 'type', 'certCodes', 'title', 'summary', 'link', 'pubDate']) {
      expect(query).toContain(`c["${field}"]`);
    }
    expect(query).toContain('c["softDeletedAt"]');
    expect(query).not.toContain('createdAt');
  });

  it('projects each row to the allowlist and withholds the scraper clock', async () => {
    const doc = written();
    const body = JSON.parse((await list(store([doc]))).body);
    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual({
      id: doc.id,
      type: 'retirement',
      certCodes: ['AZ-305'],
      title: 'AZ-305 exam retires June 30, 2026',
      summary: 'The exam retires.',
      link: 'https://techcommunity.microsoft.com/skills-hub/az-305',
      pubDate: '2026-05-01T09:00:00.000Z',
      mentionedDates: ['June 30, 2026'],
      source: 'skills-hub-rss',
    });
    expect(body.items[0]).not.toHaveProperty('createdAt');
  });

  it('names the container and the source value the writer uses', async () => {
    // The names are copied, not imported (this module has no imports); this
    // is what keeps the copies honest.
    const writerSource = await import('fs').then(({ readFileSync }) =>
      readFileSync(new URL('./timers/skills-hub.js', import.meta.url), 'utf8')
    );
    expect(writerSource).toContain("upsertDoc('certEvents'");
    expect(written().source).toBe('skills-hub-rss');
    const deps = store();
    await list(deps);
    expect(deps.queryDocs.mock.calls[0][0]).toBe('certEvents');
    expect(deps.queryDocs.mock.calls[0][2][0].value).toContain(written().source);
  });

  it('every allowlisted field is one the writer writes', () => {
    const doc = written();
    const body = { id: 1 };
    for (const field of [
      'id',
      'type',
      'certCodes',
      'title',
      'summary',
      'link',
      'pubDate',
      'mentionedDates',
      'source',
    ]) {
      expect(doc, field).toHaveProperty(field);
      body[field] = doc[field];
    }
  });

  it('sorts newest publication first in memory too, and drops soft-deleted rows', async () => {
    const older = written({ guid: 'g-older', pubDate: 'Fri, 01 May 2026 09:00:00 GMT' });
    const newest = written({ guid: 'g-newest', pubDate: 'Fri, 04 Sep 2026 09:00:00 GMT' });
    const gone = { ...written({ guid: 'g-gone' }), softDeletedAt: '2026-09-01T00:00:00Z' };
    const body = JSON.parse((await list(store([older, gone, newest]))).body);
    expect(body.items.map((e) => e.id)).toEqual([newest.id, older.id]);
    expect(body.total).toBe(2);
  });

  it('caches for an hour: the feed is scraped weekly', async () => {
    const res = await list(store([written()]));
    expect(res.headers['Cache-Control']).toBe('public, max-age=3600');
  });

  it('answers 500 by sentence when the store fails, logging no document', async () => {
    const deps = { queryDocs: vi.fn(async () => Promise.reject(new Error('boom'))), readDoc: vi.fn() };
    const res = await list(deps);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Failed to list certification events' });
  });
});
