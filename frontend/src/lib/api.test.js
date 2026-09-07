/**
 * authedFetch's `token` option: a caller that has already acquired a bearer
 * token can hand it over and no acquisition happens. Added for the Admin
 * Diagnostics page, which must decode and send the same acquisition; the
 * default path — acquire here, forced refresh for getCurrentAdminStatus — is
 * pinned alongside so the option cannot quietly become the default.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const acquireApiToken = vi.fn();
vi.mock('@/lib/entraAuth', () => ({ acquireApiToken: (...args) => acquireApiToken(...args) }));
vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.example.test/api',
  getFunctionsBase: () => 'https://api.example.test/api',
}));

const okResponse = () => ({ ok: true, status: 200, json: async () => ({}) });

beforeEach(() => {
  acquireApiToken.mockReset().mockResolvedValue('acquired-here');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse())
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authedFetch', () => {
  it('sends a pre-acquired token as-is and does not acquire another', async () => {
    const { authedFetch } = await import('@/lib/api');
    await authedFetch('getCurrentAdminStatus', { method: 'GET', token: 'pre-acquired' });

    expect(acquireApiToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetch.mock.calls;
    expect(url).toBe('https://api.example.test/api/getCurrentAdminStatus');
    expect(init.headers.Authorization).toBe('Bearer pre-acquired');
    // The option is consumed, not forwarded to fetch as a stray field.
    expect('token' in init).toBe(false);
  });

  it('acquires when no token is given, with the forced refresh only for getCurrentAdminStatus', async () => {
    const { authedFetch } = await import('@/lib/api');

    await authedFetch('getCurrentAdminStatus', { method: 'GET' });
    expect(acquireApiToken).toHaveBeenLastCalledWith({ forceRefresh: true });

    await authedFetch('getLabsSnapshot', { method: 'POST', body: '{}' });
    expect(acquireApiToken).toHaveBeenLastCalledWith({ forceRefresh: false });

    expect(acquireApiToken).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer acquired-here');
  });

  it('treats an empty token as absent rather than sending "Bearer "', async () => {
    const { authedFetch } = await import('@/lib/api');
    await authedFetch('getLabsSnapshot', { method: 'POST', body: '{}', token: '' });
    expect(acquireApiToken).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer acquired-here');
  });
});
