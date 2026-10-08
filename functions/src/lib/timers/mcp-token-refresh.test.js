/**
 * The `refreshPlaudToken` timer since 2026-10-08: Plaud's own refresh, then
 * the standard refresh grant for each OAuth Connect server whose token
 * expires within 30 minutes. Plaud never goes through the standard grant,
 * and one server's failure never stops another's refresh.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMcpTokenRefresh, TIMER_REFRESH_WINDOW_MS } from './mcp-token-refresh.js';
import { PLAUD_REFRESH_URL } from './plaud-token.js';
import { createOAuthHttp } from '../ai/mcp-oauth.js';

const NOW = new Date('2026-10-08T12:00:00.000Z');
const now = () => NOW;
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const reply = (status, body) => {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
};

const oauthServer = (id, tokenEndpoint, expiresAt, over = {}) => ({
  id,
  name: id,
  url: `https://${id}.example/mcp`,
  authType: 'oauth',
  oauthToken: `${id}-at`,
  oauthRefreshToken: `${id}-rt`,
  oauth: { status: 'connected', tokenEndpoint, clientId: `${id}-client`, tokenEndpointAuthMethod: 'none', expiresAt },
  ...over,
});

function memStore(docs) {
  const data = new Map(docs.map((doc) => [doc.id, { ...doc }]));
  return {
    data,
    readDoc: vi.fn(async (_c, id) => data.get(id) ?? null),
    patchDoc: vi.fn(async (_c, id, updates) => {
      const next = { ...data.get(id), ...updates };
      data.set(id, next);
      return next;
    }),
    queryDocs: vi.fn(async () => [...data.values()].filter((doc) => doc.oauth?.status === 'connected')),
  };
}

function network(routes) {
  const fetch = vi.fn(async (url, init = {}) => {
    const handler = routes[`${init.method || 'GET'} ${url}`];
    return handler ? handler(init) : reply(404, {});
  });
  return {
    fetch,
    http: createOAuthHttp({
      fetch,
      resolve: async () => ({ address: '93.184.216.34' }),
      dispatcherFor: () => ({ close: async () => {} }),
    }),
  };
}

describe('the MCP OAuth token refresh timer', () => {
  it('refreshes Plaud its own way and each due Connect server with the standard grant', async () => {
    const store = memStore([
      {
        id: 'plaud',
        authType: 'oauth',
        oauthToken: 'p-at',
        oauthRefreshToken: 'p-rt',
        // Even shaped like a Connect server, Plaud is not refreshed by the standard grant.
        oauth: { status: 'connected', tokenEndpoint: 'https://plaud.example/token', expiresAt: at(1) },
      },
      oauthServer('due', 'https://due.example/token', at(20)),
      oauthServer('expired', 'https://expired.example/token', at(-300)),
      oauthServer('later', 'https://later.example/token', at(120)),
      oauthServer('keyed', 'https://keyed.example/token', at(1), { authType: undefined }),
    ]);
    const plaudFetch = vi.fn(async () => reply(200, { access_token: 'p-new', expires_in: 86400 }));
    const net = network({
      'POST https://due.example/token': () => reply(200, { access_token: 'due-new', expires_in: 3600 }),
      'POST https://expired.example/token': () => reply(200, { access_token: 'expired-new', expires_in: 3600 }),
      'POST https://later.example/token': () => reply(200, { access_token: 'never' }),
      'POST https://plaud.example/token': () => reply(200, { access_token: 'never' }),
    });

    const result = await createMcpTokenRefresh({ store, fetch: plaudFetch, oauthHttp: net.http, now }).run();

    expect(result).toEqual({
      plaud: { ok: true, expiresInSec: 86400 },
      oauth: { checked: 3, refreshed: 2, notDue: 1, disconnected: 0, failed: 0 },
    });
    expect(plaudFetch).toHaveBeenCalledWith(PLAUD_REFRESH_URL, expect.anything());
    expect(net.fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://due.example/token',
      'https://expired.example/token',
    ]);
    expect(store.data.get('due').oauthToken).toBe('due-new');
    expect(store.data.get('later').oauthToken).toBe('later-at');
    expect(store.data.get('plaud').oauthToken).toBe('p-new');
    expect(TIMER_REFRESH_WINDOW_MS).toBe(30 * 60_000);
  });

  it('marks a server whose grant is refused and carries on with the next', async () => {
    const store = memStore([
      oauthServer('dead', 'https://dead.example/token', at(5)),
      oauthServer('live', 'https://live.example/token', at(5)),
    ]);
    const net = network({
      'POST https://dead.example/token': () => reply(400, { error: 'invalid_grant' }),
      'POST https://live.example/token': () => reply(200, { access_token: 'live-new' }),
    });
    const result = await createMcpTokenRefresh({
      store,
      fetch: vi.fn(),
      oauthHttp: net.http,
      now,
    }).run();
    expect(result.oauth).toEqual({ checked: 2, refreshed: 1, notDue: 0, disconnected: 1, failed: 0 });
    expect(store.data.get('dead')).toMatchObject({ status: 'needs_connection', oauth: { status: 'disconnected' } });
    expect(store.data.get('live').oauthToken).toBe('live-new');
  });

  it('still sweeps the Connect servers when Plaud’s half throws', async () => {
    const store = memStore([oauthServer('due', 'https://due.example/token', at(5))]);
    store.readDoc.mockRejectedValueOnce(new Error('cosmos down'));
    const net = network({ 'POST https://due.example/token': () => reply(200, { access_token: 'new' }) });
    const log = { error: vi.fn() };
    const result = await createMcpTokenRefresh({ store, fetch: vi.fn(), oauthHttp: net.http, now, log }).run();
    expect(result.plaud).toEqual({ ok: false, reason: 'exception' });
    expect(result.oauth.refreshed).toBe(1);
    expect(log.error).toHaveBeenCalled();
  });
});
