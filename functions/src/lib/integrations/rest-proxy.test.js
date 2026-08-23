/**
 * The credentialed pass-through proxies (#180).
 *
 * Most of this file is about `assertSafePath`, because that function is the
 * security boundary rather than input tidying. These handlers attach a Key
 * Vault secret to an outbound request whose path the caller chooses — a
 * confused deputy — and the gate in front is `editor`, not `admin`, so "the
 * caller is trusted" does not survive an XSS bug in the portal or a stolen
 * session.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRestProxy, createIntegration, assertSafePath } from './rest-proxy.js';

const context = { log: vi.fn(), error: vi.fn() };
const allowGuard = { requireRole: vi.fn(async () => ({ role: 'editor', error: null })) };
const denyGuard = { requireRole: vi.fn(async () => ({ error: { status: 403, body: '{}' } })) };

const TEST = createIntegration({
  name: 'Test',
  baseUrl: 'https://api.example.test/v1',
  keyEnv: 'TEST_API_KEY',
  headers: ({ apiKey }) => ({ Authorization: `Bearer ${apiKey}` }),
});

const readKey = (env, name) => env?.[name] || '';
const makeRequest = (body) => ({ json: async () => body });

function build({ env = { TEST_API_KEY: 'secret' }, fetchImpl, guard = allowGuard } = {}) {
  const impl =
    fetchImpl ||
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ hi: true }) }));
  const handler = createRestProxy({ guard, env, fetch: impl, readKey })(TEST);
  return { handler, fetchImpl: impl };
}

describe('assertSafePath — the security boundary', () => {
  it('allows ordinary API paths', () => {
    for (const path of ['/accounts', '/api/lists/', '/profiles', '/v1/some-path_with.chars']) {
      expect(() => assertSafePath(path)).not.toThrow();
    }
  });

  it('rejects an absolute URL, which would send the key to another host', () => {
    expect(() => assertSafePath('https://evil.test/steal')).toThrow();
  });

  it('rejects a protocol-relative path — an absolute URL that does not look like one', () => {
    expect(() => assertSafePath('//evil.test/steal')).toThrow(/protocol-relative/);
  });

  it('rejects ".." segments that climb out of the versioned prefix', () => {
    expect(() => assertSafePath('/../../admin')).toThrow(/\.\./);
  });

  it('rejects backslashes, which some servers treat as separators and URL parsers do not', () => {
    // Deliberately no '..' here: the earlier rule would fire first and this
    // test would pass without ever proving the backslash rule exists.
    expect(() => assertSafePath('/a\\b')).toThrow(/backslash/);
  });

  it('rejects control characters, including a newline that could inject a header', () => {
    expect(() => assertSafePath('/x\nHost: evil.test')).toThrow(/control/);
    expect(() => assertSafePath('/x\r\nX: y')).toThrow(/control/);
  });

  it('requires a leading slash so the join cannot become a host', () => {
    expect(() => assertSafePath('evil.test/x')).toThrow(/must start/);
    expect(() => assertSafePath('')).toThrow(/must start/);
  });
});

describe('the proxy handler', () => {
  it('forwards to the integration base with the credential attached', async () => {
    const { handler, fetchImpl } = build();
    const response = await handler(makeRequest({ path: '/accounts', method: 'GET' }), context);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/v1/accounts',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      })
    );
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, status: 200, data: { hi: true } });
  });

  it('never calls fetch at all when the path is rejected', async () => {
    // The assertion that matters: a rejected path must not produce a request
    // with the key on it, not merely an error afterwards.
    const { handler, fetchImpl } = build();
    const response = await handler(makeRequest({ path: 'https://evil.test/x' }), context);

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes an upstream error body through instead of flattening it', async () => {
    // These pages show the operator what the upstream said; "request failed"
    // removes the only useful information.
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ errors: [{ detail: 'list id required' }] }),
    }));
    const { handler } = build({ fetchImpl });
    const body = JSON.parse((await handler(makeRequest({ path: '/api/lists/' }), context)).body);

    expect(body).toMatchObject({ ok: false, status: 422 });
    expect(body.data.errors[0].detail).toBe('list id required');
  });

  it('returns non-JSON upstream errors as text rather than discarding them', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway' }));
    const { handler } = build({ fetchImpl });
    const body = JSON.parse((await handler(makeRequest({ path: '/x' }), context)).body);
    expect(body.data.raw).toMatch(/bad gateway/);
  });

  it('names the missing variable when the integration is unconfigured', async () => {
    const { handler, fetchImpl } = build({ env: {} });
    const body = JSON.parse((await handler(makeRequest({ path: '/x' }), context)).body);

    expect(body).toMatchObject({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' });
    expect(body.error).toMatch(/TEST_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks every required variable, not just the primary key', async () => {
    const twoKeys = createIntegration({
      name: 'Two',
      baseUrl: 'https://api.example.test',
      keyEnv: 'TEST_API_KEY',
      extraEnv: ['TEST_WORKSPACE_ID'],
      headers: () => ({}),
    });
    const handler = createRestProxy({
      guard: allowGuard,
      env: { TEST_API_KEY: 'secret' },
      fetch: vi.fn(),
      readKey,
    })(twoKeys);
    const body = JSON.parse((await handler(makeRequest({ path: '/x' }), context)).body);
    expect(body.error).toMatch(/TEST_WORKSPACE_ID/);
  });

  it('rejects a method outside the allowlist', async () => {
    const { handler, fetchImpl } = build();
    const response = await handler(makeRequest({ path: '/x', method: 'TRACE' }), context);
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not send a body on GET', async () => {
    const { handler, fetchImpl } = build();
    await handler(makeRequest({ path: '/x', method: 'GET', body: { a: 1 } }), context);
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });

  it('requires a role', async () => {
    const { handler, fetchImpl } = build({ guard: denyGuard });
    const response = await handler(makeRequest({ path: '/x' }), context);
    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
