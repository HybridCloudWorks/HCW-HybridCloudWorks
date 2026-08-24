import { describe, expect, it, vi } from "vitest";
import {
  createMcpHandlers,
  readMcpSecret,
  resolveMcpAuthHeaders,
  validateMcpUrl,
} from "./mcp.js";

const context = { error: vi.fn() };
const allowGuard = {
  requireRole: vi.fn(async () => ({ role: "editor", error: null })),
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
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const fixedNow = () => new Date("2026-08-24T12:00:00.000Z");

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

describe("MCP secret and URL helpers", () => {
  it("reads resolved Azure settings and ignores unresolved Key Vault references", () => {
    expect(readMcpSecret({ KEY: "\uFEFF real-key " }, "KEY")).toBe("real-key");
    expect(
      readMcpSecret(
        { KEY: "@Microsoft.KeyVault(SecretUri=https://vault/secrets/key)" },
        "KEY",
      ),
    ).toBe("");
    expect(
      resolveMcpAuthHeaders({ apiKeyEnvVar: "KEY", env: { KEY: "abc" } }),
    ).toEqual({
      Authorization: "Bearer abc",
    });
  });

  it("prefers the stored OAuth token over the App Setting", () => {
    expect(
      resolveMcpAuthHeaders({
        oauthToken: "oauth",
        apiKeyEnvVar: "KEY",
        env: { KEY: "api-key" },
      }),
    ).toEqual({ Authorization: "Bearer oauth" });
  });

  it("allows http(s) MCP endpoints but rejects embedded credentials", () => {
    expect(validateMcpUrl("https://example.test/mcp")).toBe(
      "https://example.test/mcp",
    );
    expect(() => validateMcpUrl("ftp://example.test/mcp")).toThrow(
      /http or https/,
    );
    expect(() => validateMcpUrl("https://user:pass@example.test/mcp")).toThrow(
      /credentials/,
    );
  });
});

describe("syncMcpTools", () => {
  it("calls the configured server with a server-side bearer token and persists the manifest", async () => {
    const server = {
      id: "context7",
      url: "https://context7.test/mcp",
      transport: "http",
      apiKeyEnvVar: "MCP_KEY",
    };
    const store = makeStore(server);
    const fetch = vi.fn(async (_url, options) => {
      expect(options.headers.Authorization).toBe("Bearer secret");
      expect(JSON.parse(options.body)).toMatchObject({
        method: "tools/list",
        id: 1,
      });
      return response({
        jsonrpc: "2.0",
        result: {
          tools: [
            {
              name: "search",
              description: "Search docs",
              inputSchema: { type: "object" },
            },
          ],
        },
      });
    });

    const handlers = createMcpHandlers({
      guard: allowGuard,
      store,
      env: { MCP_KEY: "secret" },
      fetch,
      now: fixedNow,
    });
    const result = await handlers.syncMcpTools(
      request({ serverId: "context7" }),
      context,
    );

    expect(JSON.parse(result.body)).toEqual({
      ok: true,
      tools: [
        {
          name: "search",
          description: "Search docs",
          inputSchema: { type: "object" },
        },
      ],
    });
    expect(store.patchDoc).toHaveBeenCalledWith("mcp_servers", "context7", {
      tools: [
        {
          name: "search",
          description: "Search docs",
          inputSchema: { type: "object" },
        },
      ],
      status: "connected",
      lastTested: "2026-08-24T12:00:00.000Z",
      lastError: null,
    });
  });

  it("records a server-side error without exposing a credential", async () => {
    const store = makeStore({
      id: "bad",
      url: "https://bad.test/mcp",
      transport: "http",
    });
    const fetch = vi.fn(async () => response({ error: "invalid_token" }, 401));
    const handlers = createMcpHandlers({
      guard: allowGuard,
      store,
      env: { BAD_KEY: "secret-value" },
      fetch,
      now: fixedNow,
    });

    const result = JSON.parse(
      (await handlers.syncMcpTools(request({ serverId: "bad" }), context)).body,
    );
    expect(result).toMatchObject({
      ok: false,
      tools: [],
      code: "UNAUTHENTICATED",
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(store.patchDoc).toHaveBeenCalledWith(
      "mcp_servers",
      "bad",
      expect.objectContaining({
        status: "error",
        lastError: expect.any(String),
      }),
    );
  });

  it("requires the editor role before reading Cosmos", async () => {
    const store = makeStore(null);
    const handlers = createMcpHandlers({
      guard: denyGuard,
      store,
      fetch: vi.fn(),
    });
    const result = await handlers.syncMcpTools(
      request({ serverId: "context7" }),
      context,
    );
    expect(result.status).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();
  });
});

describe("mcpProxy", () => {
  it("calls an enabled tool and returns its text plus raw result", async () => {
    const store = makeStore({
      id: "context7",
      url: "https://context7.test/mcp",
      transport: "http",
      enabled: true,
    });
    const fetch = vi.fn(async () =>
      response({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: "documentation" }] },
      }),
    );
    const handlers = createMcpHandlers({ guard: allowGuard, store, fetch });
    const result = JSON.parse(
      (
        await handlers.mcpProxy(
          request({
            serverId: "context7",
            tool: "get-library-docs",
            arguments: { topic: "mcp" },
          }),
          context,
        )
      ).body,
    );

    expect(result).toEqual({
      ok: true,
      result: "documentation",
      raw: { content: [{ type: "text", text: "documentation" }] },
    });
  });

  it("does not call a disabled server", async () => {
    const fetch = vi.fn();
    const handlers = createMcpHandlers({
      guard: allowGuard,
      store: makeStore({
        id: "disabled",
        url: "https://disabled.test/mcp",
        enabled: false,
      }),
      fetch,
    });
    const result = await handlers.mcpProxy(
      request({ serverId: "disabled", tool: "noop", arguments: {} }),
      context,
    );
    expect(result.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
