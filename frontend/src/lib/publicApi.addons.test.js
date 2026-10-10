/**
 * The AddOn status read (ADR 0035): a cached GET like the two labs reads,
 * keyed by the AddOn's id in the path, whose one hard rule is that the body
 * says `configured` one way or the other. A 404 (the route not published, or
 * an id the server's registry does not name) comes back null; anything else
 * without the flag is refused, so the pane page can never open on a shape
 * it was not promised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearPublicGetCache, fetchAddonStatus } from './publicApi.js';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test',
}));

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  clearPublicGetCache();
  vi.restoreAllMocks();
});
afterEach(() => {
  clearPublicGetCache();
  vi.unstubAllGlobals();
});

describe('fetchAddonStatus', () => {
  it('GETs the id’s route once and passes the body through', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ configured: false }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAddonStatus('migration')).toEqual({ configured: false });
    await fetchAddonStatus('migration');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.test/public/addons/migration/status'
    );
  });

  it('keeps one request per id, and encodes the id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ configured: false }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchAddonStatus('migration');
    await fetchAddonStatus('cloud-assessment');
    await fetchAddonStatus('a/b');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.test/public/addons/migration/status',
      'https://api.test/public/addons/cloud-assessment/status',
      'https://api.test/public/addons/a%2Fb/status',
    ]);
  });

  it('returns null when the route is not published or the id is unknown (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Unknown add-on' }, 404))
    );
    expect(await fetchAddonStatus('no-such-addon')).toBeNull();
  });

  it('throws the server sentence on a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Failed to read the add-on status' }, 500))
    );
    await expect(fetchAddonStatus('migration')).rejects.toThrow('Failed to read the add-on status');
  });

  it('refuses a body with no configured flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ reachable: true }))
    );
    await expect(fetchAddonStatus('migration')).rejects.toThrow(
      'Add-on status response carried no configured flag'
    );
  });
});
