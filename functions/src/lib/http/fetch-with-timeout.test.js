import { describe, it, expect, vi } from 'vitest';
import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from './fetch-with-timeout.js';

describe('fetchWithTimeout', () => {
  it('passes the request through and returns the response untouched', async () => {
    const response = { ok: true, status: 200 };
    const fetchImpl = vi.fn(async () => response);
    const out = await fetchWithTimeout(fetchImpl, 'https://x/y', {
      method: 'POST',
      headers: { a: 'b' },
      body: '{}',
      timeoutMs: 1000,
    });
    expect(out).toBe(response);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x/y');
    expect(init).toMatchObject({ method: 'POST', headers: { a: 'b' }, body: '{}' });
    // timeoutMs is ours, not fetch's — it must not reach the implementation.
    expect(init.timeoutMs).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts past the deadline and reports it as a timeout, not an AbortError', async () => {
    // Resolves only when aborted, which is what a hung socket looks like.
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      });
    await expect(fetchWithTimeout(fetchImpl, 'https://x', { timeoutMs: 10 })).rejects.toThrow(
      /timeout after 10 ms/
    );
    // Callers distinguish a deadline from a transport failure by code.
    await fetchWithTimeout(fetchImpl, 'https://x', { timeoutMs: 10 }).catch((e) =>
      expect(e.code).toBe('FETCH_TIMEOUT')
    );
  });

  it('lets a non-abort error through unchanged', async () => {
    const boom = new Error('ECONNREFUSED');
    const fetchImpl = vi.fn(async () => {
      throw boom;
    });
    await expect(fetchWithTimeout(fetchImpl, 'https://x', { timeoutMs: 50 })).rejects.toBe(boom);
  });

  it('clears its timer so a fast call cannot keep the process alive', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await fetchWithTimeout(async () => ({ ok: true }), 'https://x', { timeoutMs: 5000 });
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('applies a default deadline when the caller names none', async () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    await fetchWithTimeout(fetchImpl, 'https://x');
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
