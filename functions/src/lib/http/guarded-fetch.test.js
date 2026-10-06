import { describe, it, expect, vi } from 'vitest';
import { guardedFetch, isPrivateIp, validateFetchUrl } from './guarded-fetch.js';

const publicAddr = async () => ({ address: '93.184.216.34' });
const res = (status, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => 'body',
});

describe('isPrivateIp', () => {
  it('refuses loopback, RFC 1918, link-local and the zero network', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.9', '169.254.169.254', '0.0.0.0'])
      expect(isPrivateIp(ip)).toBe(true);
  });
  it('accepts public addresses and ignores non-IPv4 strings', () => {
    for (const ip of ['93.184.216.34', '172.32.0.1', '8.8.8.8']) expect(isPrivateIp(ip)).toBe(false);
    expect(isPrivateIp('::1')).toBe(false);
    expect(isPrivateIp('not-an-ip')).toBe(false);
  });
});

describe('validateFetchUrl', () => {
  it('refuses non-http protocols and localhost by name before resolving', async () => {
    const resolve = vi.fn(publicAddr);
    await expect(validateFetchUrl('ftp://x', { resolve })).rejects.toThrow(/protocol/i);
    await expect(validateFetchUrl('http://localhost/x', { resolve })).rejects.toThrow(/localhost/i);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('refuses a public name that resolves to a private address, flagged as a refusal', async () => {
    await expect(
      validateFetchUrl('https://kb.example/doc', { resolve: async () => ({ address: '10.0.0.5' }) })
    ).rejects.toMatchObject({ refused: true, code: 'URL_REFUSED', message: expect.stringMatching(/Private IP/) });
  });
});

describe('guardedFetch', () => {
  it('validates, then fetches with manual redirects and the given headers', async () => {
    const fetch = vi.fn(async () => res(200));
    const r = await guardedFetch('https://a.example/x', {
      fetch,
      resolve: publicAddr,
      headers: { 'User-Agent': 'ua' },
      timeoutMs: 1000,
    });
    expect(r.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { 'User-Agent': 'ua' } });
  });

  it('never calls fetch for a private, link-local or localhost target', async () => {
    const fetch = vi.fn(async () => res(200));
    for (const [url, address] of [
      ['http://10.0.0.5/', '10.0.0.5'],
      ['http://169.254.169.254/metadata', '169.254.169.254'],
    ]) {
      await expect(guardedFetch(url, { fetch, resolve: async () => ({ address }) })).rejects.toThrow(/Private IP/);
    }
    await expect(guardedFetch('http://localhost:7071/', { fetch, resolve: publicAddr })).rejects.toThrow(/localhost/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('follows a redirect only after re-validating the new host', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(302, { location: 'https://b.example/y' }))
      .mockResolvedValueOnce(res(200));
    const resolve = vi.fn(publicAddr);
    const r = await guardedFetch('https://a.example/x', { fetch, resolve });
    expect(r.status).toBe(200);
    expect(fetch.mock.calls[1][0]).toBe('https://b.example/y');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect that lands on the private network', async () => {
    const fetch = vi.fn(async () => res(301, { location: 'http://10.0.0.5/internal' }));
    const resolve = vi.fn(async (host) => ({ address: host === 'a.example' ? '93.184.216.34' : '10.0.0.5' }));
    await expect(guardedFetch('https://a.example/x', { fetch, resolve })).rejects.toThrow(/Private IP/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves a relative Location against the current URL', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(307, { location: '/moved' }))
      .mockResolvedValueOnce(res(200));
    await guardedFetch('https://a.example/dir/x', { fetch, resolve: publicAddr });
    expect(fetch.mock.calls[1][0]).toBe('https://a.example/moved');
  });

  it('stops at the redirect limit and on a redirect with no Location', async () => {
    const loop = vi.fn(async () => res(302, { location: 'https://a.example/again' }));
    await expect(guardedFetch('https://a.example/x', { fetch: loop, resolve: publicAddr, maxRedirects: 2 })).rejects.toMatchObject({
      code: 'REDIRECT_LIMIT',
    });
    expect(loop).toHaveBeenCalledTimes(3);
    const blank = vi.fn(async () => res(302));
    await expect(guardedFetch('https://a.example/x', { fetch: blank, resolve: publicAddr })).rejects.toMatchObject({
      code: 'REDIRECT_NO_LOCATION',
    });
  });

  it('returns a non-2xx response to the caller rather than deciding for it', async () => {
    const fetch = vi.fn(async () => res(403));
    const r = await guardedFetch('https://a.example/x', { fetch, resolve: publicAddr });
    expect(r.status).toBe(403);
  });

  it('reports a hung socket as a timeout', async () => {
    const fetch = vi.fn((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    );
    await expect(guardedFetch('https://a.example/x', { fetch, resolve: publicAddr, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'FETCH_TIMEOUT',
    });
  });
});
