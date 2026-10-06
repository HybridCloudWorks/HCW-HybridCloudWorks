import { describe, expect, it, vi } from 'vitest';
import {
  createMcpHandlers,
  readMcpSecret,
  resolveMcpAuthHeaders,
  validateMcpUrl,
  validateMcpApiKeyEnvVar,
  validateMcpKeyBinding,
  INTEGRATION_KEY_HOSTS,
  KNOWN_INTEGRATION_KEY_NAMES,
} from './mcp.js';

const context = { error: vi.fn() };
const allowGuard = {
  requireRole: vi.fn(async () => ({ role: 'editor', error: null })),
};
const denyGuard = {
  requireRole: vi.fn(async () => ({
    error: { status: 403, body: JSON.stringify({ ok: false }) },
  })),
};

const request = (body) => ({ json: async () => body });
const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const fixedNow = () => new Date('2026-08-24T12:00:00.000Z');

function makeStore(server, overrides = {}) {
  return {
    readDoc: vi.fn(async () => server),
    patchDoc: vi.fn(async (_container, id, updates) => ({
      ...server,
      id,
      ...updates,
    })),
    ...overrides,
  };
}

describe('MCP secret and URL helpers', () => {
  it('reads resolved Azure settings and ignores unresolved Key Vault references', () => {
    expect(readMcpSecret({ KEY: '\uFEFF real-key ' }, 'KEY')).toBe('real-key');
    expect(
      readMcpSecret({ KEY: '@Microsoft.KeyVault(SecretUri=https://vault/secrets/key)' }, 'KEY')
    ).toBe('');
    expect(
      resolveMcpAuthHeaders({
        apiKeyEnvVar: 'MCP_KEY',
        env: { MCP_KEY: 'abc' },
      })
    ).toEqual({
      Authorization: 'Bearer abc',
    });
  });

  it('never sends an app setting outside the MCP_* / integration allowlist as a bearer (ADR 0033)', () => {
    // The finding: any app-setting name was accepted, so a custom server at
    // an attacker's URL could name the Cosmos connection string.
    expect(
      resolveMcpAuthHeaders({
        apiKeyEnvVar: 'COSMOS_CONNECTION_STRING',
        env: { COSMOS_CONNECTION_STRING: 'AccountEndpoint=...' },
      })
    ).toEqual({});
    expect(() => validateMcpApiKeyEnvVar('COSMOS_CONNECTION_STRING')).toThrow(/MCP_\* app setting/);
    expect(() => validateMcpApiKeyEnvVar('ANTHROPIC_API_KEY')).toThrow(/not allowed/);
    expect(() => validateMcpApiKeyEnvVar(42)).toThrow(/string/);
  });

  it('accepts the MCP_* namespace, the seeded integration keys, and no key at all', () => {
    expect(validateMcpApiKeyEnvVar('MCP_CONTEXT7_KEY')).toBe('MCP_CONTEXT7_KEY');
    for (const name of KNOWN_INTEGRATION_KEY_NAMES) {
      expect(validateMcpApiKeyEnvVar(name)).toBe(name);
    }
    expect(validateMcpApiKeyEnvVar(null)).toBeNull();
    expect(validateMcpApiKeyEnvVar('')).toBeNull();
    expect(validateMcpApiKeyEnvVar(undefined)).toBeNull();
    expect(
      resolveMcpAuthHeaders({
        apiKeyEnvVar: 'FIRECRAWL_API_KEY',
        url: 'https://mcp.firecrawl.dev/sse',
        env: { FIRECRAWL_API_KEY: 'fc' },
      })
    ).toEqual({ Authorization: 'Bearer fc' });
  });

  it('binds each shared integration key to its vendor host, and MCP_* keys to none (AP-B1)', () => {
    // Every shared key has a binding, and every seeded host is in it.
    for (const name of KNOWN_INTEGRATION_KEY_NAMES) {
      expect(INTEGRATION_KEY_HOSTS[name].length).toBeGreaterThan(0);
    }
    expect(
      validateMcpKeyBinding({ url: 'https://mcp.firecrawl.dev/sse', apiKeyEnvVar: 'FIRECRAWL_API_KEY' })
    ).toBe('FIRECRAWL_API_KEY');
    expect(
      validateMcpKeyBinding({ url: 'https://MCP.Replicate.com/sse', apiKeyEnvVar: 'REPLICATE_API_KEY' })
    ).toBe('REPLICATE_API_KEY');
    expect(validateMcpKeyBinding({ url: 'http://localhost:8100', apiKeyEnvVar: 'VPS_API_TOKEN' })).toBe(
      'VPS_API_TOKEN'
    );
    // The finding: a shared key named on a server at any other host.
    expect(() =>
      validateMcpKeyBinding({ url: 'https://attacker.example/mcp', apiKeyEnvVar: 'VPS_API_TOKEN' })
    ).toThrow(/VPS_API_TOKEN may only be sent to localhost/);
    expect(() =>
      validateMcpKeyBinding({ url: 'https://firecrawl.dev.attacker.example/', apiKeyEnvVar: 'FIRECRAWL_API_KEY' })
    ).toThrow(/may only be sent to mcp\.firecrawl\.dev/);
    expect(() => validateMcpKeyBinding({ url: undefined, apiKeyEnvVar: 'REPLICATE_API_KEY' })).toThrow(
      /may only be sent to/
    );
    // A per-server MCP_* secret and no key at all bind to no host.
    expect(validateMcpKeyBinding({ url: 'https://anything.example/', apiKeyEnvVar: 'MCP_CUSTOM' })).toBe(
      'MCP_CUSTOM'
    );
    expect(validateMcpKeyBinding({ url: 'https://anything.example/', apiKeyEnvVar: null })).toBeNull();
  });

  it('resolves no bearer for a shared key at an unbound host, or with no URL at all (AP-B1)', () => {
    const env = { FIRECRAWL_API_KEY: 'fc', VPS_API_TOKEN: 'vps' };
    expect(
      resolveMcpAuthHeaders({ apiKeyEnvVar: 'VPS_API_TOKEN', url: 'https://attacker.example/', env })
    ).toEqual({});
    expect(resolveMcpAuthHeaders({ apiKeyEnvVar: 'FIRECRAWL_API_KEY', env })).toEqual({});
    expect(
      resolveMcpAuthHeaders({ apiKeyEnvVar: 'MCP_CUSTOM', url: 'https://anything.example/', env: { MCP_CUSTOM: 'k' } })
    ).toEqual({ Authorization: 'Bearer k' });
  });

  it('prefers the stored OAuth token over the App Setting', () => {
    expect(
      resolveMcpAuthHeaders({
        oauthToken: 'oauth',
        apiKeyEnvVar: 'KEY',
        env: { KEY: 'api-key' },
      })
    ).toEqual({ Authorization: 'Bearer oauth' });
  });

  it('requires https (loopback http excepted) and rejects embedded credentials', () => {
    expect(validateMcpUrl('https://example.test/mcp')).toBe('https://example.test/mcp');
    expect(() => validateMcpUrl('ftp://example.test/mcp')).toThrow(/https/);
    // A bearer token over plain http is readable on the wire (ADR 0033).
    expect(() => validateMcpUrl('http://example.test/mcp')).toThrow(/must use https/);
    // The seeded Hostinger entry: no wire is crossed to localhost.
    expect(validateMcpUrl('http://localhost:8100')).toBe('http://localhost:8100/');
    expect(validateMcpUrl('http://127.0.0.1:8100/mcp')).toBe('http://127.0.0.1:8100/mcp');
    expect(() => validateMcpUrl('https://user:pass@example.test/mcp')).toThrow(/credentials/);
  });
});

describe('syncMcpTools', () => {
  it('calls the configured server with a server-side bearer token and persists the manifest', async () => {
    const server = {
      id: 'context7',
      url: 'https://context7.test/mcp',
      transport: 'http',
      apiKeyEnvVar: 'MCP_KEY',
    };
    const store = makeStore(server);
    const fetch = vi.fn(async (_url, options) => {
      expect(options.headers.Authorization).toBe('Bearer secret');
      expect(JSON.parse(options.body)).toMatchObject({
        method: 'tools/list',
        id: 1,
      });
      return response({
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'search',
              description: 'Search docs',
              inputSchema: { type: 'object' },
            },
          ],
        },
      });
    });

    const handlers = createMcpHandlers({
      guard: allowGuard,
      store,
      env: { MCP_KEY: 'secret' },
      fetch,
      now: fixedNow,
    });
    const result = await handlers.syncMcpTools(request({ serverId: 'context7' }), context);

    expect(JSON.parse(result.body)).toEqual({
      ok: true,
      tools: [
        {
          name: 'search',
          description: 'Search docs',
          inputSchema: { type: 'object' },
        },
      ],
    });
    expect(store.patchDoc).toHaveBeenCalledWith('mcp_servers', 'context7', {
      tools: [
        {
          name: 'search',
          description: 'Search docs',
          inputSchema: { type: 'object' },
        },
      ],
      status: 'connected',
      lastTested: '2026-08-24T12:00:00.000Z',
      lastError: null,
    });
  });

  it('refuses to sync a server that names a shared key at an unbound host, without calling it (AP-B1)', async () => {
    const server = {
      id: 'rogue',
      url: 'https://attacker.example/mcp',
      transport: 'http',
      apiKeyEnvVar: 'VPS_API_TOKEN',
      enabled: true,
    };
    const store = makeStore(server);
    const fetch = vi.fn();
    const handlers = createMcpHandlers({
      guard: allowGuard,
      store,
      env: { VPS_API_TOKEN: 'the-lab-token' },
      fetch,
      now: fixedNow,
    });
    const result = await handlers.syncMcpTools(request({ serverId: 'rogue' }), context);
    const body = JSON.parse(result.body);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/VPS_API_TOKEN may only be sent to/);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.body).not.toContain('the-lab-token');

    const proxied = await handlers.mcpProxy(
      request({ serverId: 'rogue', tool: 'anything', arguments: {} }),
      context
    );
    expect(JSON.parse(proxied.body).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a server-side error without exposing a credential', async () => {
    const store = makeStore({
      id: 'bad',
      url: 'https://bad.test/mcp',
      transport: 'http',
    });
    const fetch = vi.fn(async () => response({ error: 'invalid_token' }, 401));
    const handlers = createMcpHandlers({
      guard: allowGuard,
      store,
      env: { BAD_KEY: 'secret-value' },
      fetch,
      now: fixedNow,
    });

    const result = JSON.parse(
      (await handlers.syncMcpTools(request({ serverId: 'bad' }), context)).body
    );
    expect(result).toMatchObject({
      ok: false,
      tools: [],
      code: 'UNAUTHENTICATED',
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
    expect(store.patchDoc).toHaveBeenCalledWith(
      'mcp_servers',
      'bad',
      expect.objectContaining({
        status: 'error',
        lastError: expect.any(String),
      })
    );
  });

  it('requires the editor role before reading Cosmos', async () => {
    const store = makeStore(null);
    const handlers = createMcpHandlers({
      guard: denyGuard,
      store,
      fetch: vi.fn(),
    });
    const result = await handlers.syncMcpTools(request({ serverId: 'context7' }), context);
    expect(result.status).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();
  });
});

describe('mcpProxy', () => {
  it('calls an enabled tool and returns its text plus raw result', async () => {
    const store = makeStore({
      id: 'context7',
      url: 'https://context7.test/mcp',
      transport: 'http',
      enabled: true,
    });
    const fetch = vi.fn(async () =>
      response({
        jsonrpc: '2.0',
        result: { content: [{ type: 'text', text: 'documentation' }] },
      })
    );
    const handlers = createMcpHandlers({ guard: allowGuard, store, fetch });
    const result = JSON.parse(
      (
        await handlers.mcpProxy(
          request({
            serverId: 'context7',
            tool: 'get-library-docs',
            arguments: { topic: 'mcp' },
          }),
          context
        )
      ).body
    );

    expect(result).toEqual({
      ok: true,
      result: 'documentation',
      raw: { content: [{ type: 'text', text: 'documentation' }] },
    });
  });

  it('does not call a disabled server', async () => {
    const fetch = vi.fn();
    const handlers = createMcpHandlers({
      guard: allowGuard,
      store: makeStore({
        id: 'disabled',
        url: 'https://disabled.test/mcp',
        enabled: false,
      }),
      fetch,
    });
    const result = await handlers.mcpProxy(
      request({ serverId: 'disabled', tool: 'noop', arguments: {} }),
      context
    );
    expect(result.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
