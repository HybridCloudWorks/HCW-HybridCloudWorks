/**
 * The two labs reads (#664, #680): cached GETs like the pricing read, whose
 * one hard rule is that the body says `configured` one way or the other.
 * A 404 is "the route is not published" and comes back null; anything else
 * without the flag is refused, so a card can never render a shape it was
 * not promised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearPublicGetCache, fetchCoderStatus, fetchLabsEstate } from './publicApi.js';

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

describe.each([
  ['fetchLabsEstate', fetchLabsEstate, 'public/labs/estate', 'Labs estate'],
  ['fetchCoderStatus', fetchCoderStatus, 'public/labs/coder-status', 'Coder status'],
])('%s', (_name, fetcher, path, what) => {
  it('GETs its route once and passes the body through', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ configured: false }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetcher()).toEqual({ configured: false });
    await fetcher();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://api.test/${path}`);
  });

  it('returns null when the route is not published (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 404))
    );
    expect(await fetcher()).toBeNull();
  });

  it('throws the server sentence on a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Resource Graph timed out' }, 502))
    );
    await expect(fetcher()).rejects.toThrow('Resource Graph timed out');
  });

  it('refuses a body with no configured flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true }))
    );
    await expect(fetcher()).rejects.toThrow(`${what} response carried no configured flag`);
  });
});

it('fetchLabsEstate returns the configured shape untouched', async () => {
  const estate = {
    configured: true,
    arc: {
      status: 'Connected',
      lastHeartbeatAt: '2026-09-25T10:00:00Z',
      agentVersion: '1.52.02988.2222',
      osName: 'Ubuntu 24.04.3 LTS',
    },
    policy: { compliant: 12, nonCompliant: 1 },
    agent: { online: true, queued: 0 },
    coder: { reachable: true, running: 1, max: 5 },
    asOf: '2026-09-25T10:04:00Z',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(estate))
  );
  expect(await fetchLabsEstate()).toEqual(estate);
});
