/**
 * How mcp.js treats a server that signs in with OAuth Connect: never called
 * without a live connection; refreshed first when its token has under two
 * minutes left; refreshed once and retried once on a 401; marked as needing
 * a connection (amber, "press Connect") when the refresh is refused. Plaud's
 * pasted token and API-key servers take none of these paths.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMcpHandlers, callMcpTool } from './mcp.js';
import { createOAuthHttp } from './mcp-oauth.js';

const NOW = new Date('2026-10-08T12:00:00.000Z');
const now = () => NOW;
const HOSTINGER_TOKEN = 'https://auth.hostinger.com/api/external/v1/oauth-server/token';
const context = { error: vi.fn() };
const editorGuard = { requireRole: vi.fn(async () => ({ user: { oid: 'e' }, role: 'editor', error: null })) };
const request = (body) => ({ json: async () => body });

const reply = (status, body = '', headers = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
};

const TOOLS = { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'list_vps', description: 'd', inputSchema: {} }] } };

function memStore(doc) {
  const data = new Map([[doc.id, { ...doc }]]);
  return {
    data,
    readDoc: vi.fn(async (_c, id) => data.get(id) ?? null),
    patchDoc: vi.fn(async (_c, id, updates) => {
      const next = { ...data.get(id), ...updates };
      data.set(id, next);
      return next;
    }),
  };
}

/** A fake internet: MCP and token endpoints answered by the handlers given. */
function network(routes) {
  const calls = [];
  const fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const authorization = init.headers?.Authorization || null;
    calls.push({ url, method, authorization, body: init.body });
    const handler = routes[`${method} ${url}`];
    if (!handler) return reply(404, {});
    return handler(init, authorization);
  });
  const http = createOAuthHttp({
    fetch,
    resolve: async () => ({ address: '93.184.216.34' }),
    dispatcherFor: () => ({ close: async () => {} }),
  });
  return { fetch, http, calls };
}

const hostinger = (over = {}) => ({
  id: 'hostinger-mcp',
  name: 'Hostinger MCP',
  url: 'https://mcp.hostinger.com',
  transport: 'http',
  authType: 'oauth',
  enabled: true,
  oauthToken: 'at-old',
  oauthRefreshToken: 'rt-old',
  oauth: {
    status: 'connected',
    issuer: 'https://auth.hostinger.com',
    tokenEndpoint: HOSTINGER_TOKEN,
    clientId: 'hst-client-1',
    tokenEndpointAuthMethod: 'none',
    resource: 'https://mcp.hostinger.com',
    scope: 'mcp:use',
    expiresAt: '2026-10-08T13:00:00.000Z',
  },
  ...over,
});

const handlersFor = (store, net) =>
  createMcpHandlers({ guard: editorGuard, store, env: {}, fetch: net.fetch, now, oauthHttp: net.http });

const mcpCalls = (net, url = 'https://mcp.hostinger.com/') => net.calls.filter((c) => c.url === url);
const tokenCalls = (net, url = HOSTINGER_TOKEN) => net.calls.filter((c) => c.url === url);

describe('an OAuth Connect server over Streamable HTTP', () => {
  it('refreshes before the call when the token has under two minutes left', async () => {
    const store = memStore(hostinger({ oauth: { ...hostinger().oauth, expiresAt: '2026-10-08T12:01:30.000Z' } }));
    const net = network({
      [`POST ${HOSTINGER_TOKEN}`]: () => reply(200, { access_token: 'at-new', expires_in: 3600 }),
      'POST https://mcp.hostinger.com/': (_init, auth) =>
        auth === 'Bearer at-new' ? reply(200, TOOLS) : reply(401, ''),
    });
    const res = await handlersFor(store, net).syncMcpTools(request({ serverId: 'hostinger-mcp' }), context);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(net.calls.map((c) => c.url)).toEqual([HOSTINGER_TOKEN, 'https://mcp.hostinger.com/']);
    expect(mcpCalls(net)[0].authorization).toBe('Bearer at-new');
    expect(store.data.get('hostinger-mcp')).toMatchObject({
      oauthToken: 'at-new',
      oauthRefreshToken: 'rt-old',
      status: 'connected',
      oauth: { expiresAt: '2026-10-08T13:00:00.000Z' },
    });
  });

  it('does not refresh a token with time left', async () => {
    const store = memStore(hostinger());
    const net = network({
      [`POST ${HOSTINGER_TOKEN}`]: () => reply(200, { access_token: 'at-new' }),
      'POST https://mcp.hostinger.com/': () => reply(200, TOOLS),
    });
    await handlersFor(store, net).syncMcpTools(request({ serverId: 'hostinger-mcp' }), context);
    expect(tokenCalls(net)).toHaveLength(0);
    expect(mcpCalls(net)[0].authorization).toBe('Bearer at-old');
  });

  it('refreshes once on a 401 and retries once with the new token', async () => {
    const store = memStore(hostinger());
    const net = network({
      [`POST ${HOSTINGER_TOKEN}`]: () => reply(200, { access_token: 'at-new', refresh_token: 'rt-new' }),
      'POST https://mcp.hostinger.com/': (_init, auth) =>
        auth === 'Bearer at-new' ? reply(200, TOOLS) : reply(401, '', { 'www-authenticate': 'Bearer error="invalid_token"' }),
    });
    const res = await handlersFor(store, net).syncMcpTools(request({ serverId: 'hostinger-mcp' }), context);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, tools: [{ name: 'list_vps' }] });
    expect(mcpCalls(net).map((c) => c.authorization)).toEqual(['Bearer at-old', 'Bearer at-new']);
    expect(tokenCalls(net)).toHaveLength(1);
    expect(store.data.get('hostinger-mcp').oauthRefreshToken).toBe('rt-new');
  });

  it('retries only once: a second 401 is reported as the auth failure it is', async () => {
    const store = memStore(hostinger());
    const net = network({
      [`POST ${HOSTINGER_TOKEN}`]: () => reply(200, { access_token: 'at-new' }),
      'POST https://mcp.hostinger.com/': () => reply(401, ''),
    });
    const res = await handlersFor(store, net).mcpProxy(
      request({ serverId: 'hostinger-mcp', tool: 'list_vps', arguments: {} }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(mcpCalls(net)).toHaveLength(2);
    expect(tokenCalls(net)).toHaveLength(1);
  });

  it('marks the server as needing a connection — not a red error — when the refresh is refused', async () => {
    const store = memStore(hostinger());
    const net = network({
      [`POST ${HOSTINGER_TOKEN}`]: () => reply(400, { error: 'invalid_grant' }),
      'POST https://mcp.hostinger.com/': () => reply(401, ''),
    });
    const res = await handlersFor(store, net).syncMcpTools(request({ serverId: 'hostinger-mcp' }), context);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', tools: [] });
    expect(body.error).toMatch(/^Sign-in to Hostinger MCP has expired\. Press Connect/);
    const doc = store.data.get('hostinger-mcp');
    expect(doc.status).toBe('needs_connection');
    expect(doc.lastError).toMatch(/Press Connect/);
    expect(doc.oauth.status).toBe('disconnected');
    expect(doc.oauthToken).toBeNull();
    expect(mcpCalls(net)).toHaveLength(1);
  });

  it('never calls a server that has no connection, and says to press Connect', async () => {
    const store = memStore(hostinger({ oauthToken: undefined, oauthRefreshToken: undefined, oauth: undefined }));
    const net = network({});
    const sync = await handlersFor(store, net).syncMcpTools(request({ serverId: 'hostinger-mcp' }), context);
    expect(JSON.parse(sync.body)).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
      error: 'Hostinger MCP is not connected. Press Connect on its card under AI Engine → MCP Servers and sign in.',
    });
    expect(store.data.get('hostinger-mcp').status).toBe('needs_connection');

    const call = await callMcpTool({ store, serverId: 'hostinger-mcp', tool: 'list_vps', env: {}, fetch: net.fetch, now, oauthHttp: net.http, log: {} });
    expect(call).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', httpStatus: 200 });
    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('refuses an expired sign-in with the sentence that says so', async () => {
    const store = memStore(hostinger({ oauthToken: null, oauth: { status: 'disconnected' } }));
    const net = network({});
    const sync = await handlersFor(store, net).syncMcpTools(request({ serverId: 'hostinger-mcp' }), context);
    expect(JSON.parse(sync.body).error).toMatch(/^Sign-in to Hostinger MCP has expired/);
    expect(net.fetch).not.toHaveBeenCalled();
  });
});

describe('Replicate over SSE', () => {
  /** An SSE server: the GET stream announces the POST endpoint, and answers id 1 on it. */
  function replicateSse(token) {
    let push = () => {};
    return {
      'GET https://mcp.replicate.com/sse': (_init, auth) => {
        if (auth !== `Bearer ${token}`) return reply(401, '', { 'www-authenticate': 'Bearer realm="OAuth", error="invalid_token"' });
        const body = new ReadableStream({
          start(controller) {
            push = (text) => controller.enqueue(new TextEncoder().encode(text));
            push('event: endpoint\ndata: /messages?sessionId=s1\n\n');
            push('data: SSE Connection established\n\n');
          },
        });
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body };
      },
      'POST https://mcp.replicate.com/messages?sessionId=s1': (init) => {
        const message = JSON.parse(init.body);
        if (message.id === 1) push(`data: ${JSON.stringify({ ...TOOLS, result: { tools: [{ name: 'search_models' }] } })}\n\n`);
        return reply(202, 'Accepted');
      },
    };
  }
  const replicate = (over = {}) =>
    hostinger({
      id: 'replicate-mcp',
      name: 'Replicate MCP',
      url: 'https://mcp.replicate.com/sse',
      transport: 'sse',
      oauth: { ...hostinger().oauth, issuer: 'https://mcp.replicate.com/', tokenEndpoint: 'https://mcp.replicate.com/token', resource: 'https://mcp.replicate.com/', scope: null },
      ...over,
    });

  it('refreshes once when the stream answers 401, and reads the tools over the new token', async () => {
    const store = memStore(replicate());
    const net = network({
      ...replicateSse('at-new'),
      'POST https://mcp.replicate.com/token': () => reply(200, { access_token: 'at-new', expires_in: 3600 }),
    });
    const res = await handlersFor(store, net).syncMcpTools(request({ serverId: 'replicate-mcp' }), context);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, tools: [{ name: 'search_models' }] });
    const gets = net.calls.filter((c) => c.method === 'GET');
    expect(gets.map((c) => c.authorization)).toEqual(['Bearer at-old', 'Bearer at-new']);
    expect(tokenCalls(net, 'https://mcp.replicate.com/token')).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(tokenCalls(net, 'https://mcp.replicate.com/token')[0].body))).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rt-old',
      resource: 'https://mcp.replicate.com/',
    });
  });

  it('never sends REPLICATE_API_KEY to an OAuth server still carrying the old key name', async () => {
    const store = memStore(replicate({ apiKeyEnvVar: 'REPLICATE_API_KEY', oauthToken: undefined, oauth: undefined }));
    const net = network(replicateSse('never'));
    const res = await createMcpHandlers({
      guard: editorGuard,
      store,
      env: { REPLICATE_API_KEY: 'r8_secret' },
      fetch: net.fetch,
      now,
      oauthHttp: net.http,
    }).syncMcpTools(request({ serverId: 'replicate-mcp' }), context);
    expect(JSON.parse(res.body).code).toBe('UNAUTHENTICATED');
    expect(net.fetch).not.toHaveBeenCalled();
  });
});

describe('the paths OAuth Connect does not take', () => {
  it('leaves Plaud’s pasted token alone: a 401 earns no standard refresh', async () => {
    const store = memStore({
      id: 'plaud',
      name: 'Plaud',
      url: 'https://mcp.plaud.ai/mcp',
      transport: 'http',
      authType: 'oauth',
      enabled: true,
      oauthToken: 'pasted',
      oauthRefreshToken: 'plaud-rt',
      oauth: { status: 'connected', tokenEndpoint: 'https://mcp.plaud.ai/token' },
    });
    const net = network({ 'POST https://mcp.plaud.ai/mcp': () => reply(401, '') });
    const res = await handlersFor(store, net).mcpProxy(
      request({ serverId: 'plaud', tool: 'list_files', arguments: {} }),
      context
    );
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(net.calls.map((c) => c.url)).toEqual(['https://mcp.plaud.ai/mcp']);
    expect(net.calls[0].authorization).toBe('Bearer pasted');
  });

  it('sends an API-key server its app setting, as before', async () => {
    const store = memStore({
      id: 'firecrawl',
      url: 'https://mcp.firecrawl.dev/mcp',
      transport: 'http',
      apiKeyEnvVar: 'FIRECRAWL_API_KEY',
      enabled: true,
    });
    const net = network({ 'POST https://mcp.firecrawl.dev/mcp': () => reply(401, '') });
    await createMcpHandlers({ guard: editorGuard, store, env: { FIRECRAWL_API_KEY: 'fc' }, fetch: net.fetch, now, oauthHttp: net.http })
      .syncMcpTools(request({ serverId: 'firecrawl' }), context);
    expect(net.calls.map((c) => c.authorization)).toEqual(['Bearer fc']);
    expect(store.data.get('firecrawl').status).toBe('error');
  });
});

describe('who may use an OAuth Connect server’s token (security review, 2026-10-08)', () => {
  const guardFor = (role) => ({
    requireRole: vi.fn(async (_request, minimum) =>
      minimum === 'super_admin' && role !== 'super_admin'
        ? { user: null, role: null, error: { status: 403, body: '{"error":"Requires super_admin or higher"}' } }
        : { user: { oid: role }, role, error: null }
    ),
  });
  const proxy = (role, store, net) =>
    createMcpHandlers({ guard: guardFor(role), store, env: {}, fetch: net.fetch, now, oauthHttp: net.http }).mcpProxy(
      request({ serverId: store.data.keys().next().value, tool: 'list_vps', arguments: {} }),
      context
    );
  const toolReply = () => reply(200, { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'vps-1' }] } });

  it('refuses an editor’s tool call before anything is sent, and lets a super_admin through', async () => {
    const net = network({ 'POST https://mcp.hostinger.com/': () => toolReply() });
    const refused = await proxy('editor', memStore(hostinger()), net);
    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(JSON.parse(refused.body).error).toMatch(/needs super_admin/);
    expect(net.fetch).not.toHaveBeenCalled();

    const allowed = await proxy('super_admin', memStore(hostinger()), net);
    expect(JSON.parse(allowed.body)).toMatchObject({ ok: true, result: 'vps-1' });
  });

  it('keeps the editor gate for every other server', async () => {
    const store = memStore({ id: 'context7', url: 'https://mcp.context7.com/mcp', transport: 'http', enabled: true });
    const net = network({ 'POST https://mcp.context7.com/mcp': () => toolReply() });
    const res = await proxy('editor', store, net);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('never sends the token to an SSE message endpoint on another host', async () => {
    const store = memStore(
      hostinger({
        id: 'replicate-mcp',
        name: 'Replicate MCP',
        url: 'https://mcp.replicate.com/sse',
        transport: 'sse',
      })
    );
    const net = network({
      'GET https://mcp.replicate.com/sse': () => {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: https://collector.example/messages\n\n'));
          },
        });
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body };
      },
      'POST https://collector.example/messages': () => reply(202, 'Accepted'),
    });
    const res = await handlersFor(store, net).syncMcpTools(request({ serverId: 'replicate-mcp' }), context);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false });
    expect(JSON.parse(res.body).error).toMatch(/message endpoint on another host/);
    expect(net.calls.some((c) => new URL(c.url).host === 'collector.example')).toBe(false);
  });
});
