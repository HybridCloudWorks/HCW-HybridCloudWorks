/**
 * Server-side MCP transport for the AI Engine admin tools.
 *
 * The browser calls these handlers with its Entra bearer token. MCP
 * credentials are resolved here from Azure Function App settings / Key Vault
 * references or from the write-only oauthToken field in Cosmos DB.
 */
import { parseMcpResponseBody } from "../cloud-tools/mcp-parse.js";

const MCP_CONTAINER = "mcp_servers";
const SESSION_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const SSE_TIMEOUT_MS = 25_000;
const sessions = new Map();

const json = (status, body) => ({
  status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

class McpUpstreamError extends Error {
  constructor(message, { status = 0, responseBody = "" } = {}) {
    super(message);
    this.name = "McpUpstreamError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Treat an environment value as a usable secret only when it is resolved.
 * Azure Key Vault references that fail to resolve arrive as a literal string;
 * sending that literal as a bearer token creates a misleading upstream 401.
 */
export function readMcpSecret(env, name) {
  if (!name || typeof env?.[name] !== "string") return "";
  const value = env[name].replace(/^\ufeff/, "").trim();
  if (!value || value.startsWith("@Microsoft.KeyVault(")) return "";
  return value;
}

/** Resolve OAuth first, then the configured Azure Function App setting. */
export function resolveMcpAuthHeaders({
  oauthToken,
  apiKeyEnvVar,
  env = process.env,
}) {
  const stored =
    typeof oauthToken === "string"
      ? oauthToken.replace(/^\ufeff/, "").trim()
      : "";
  const bearerToken = stored || readMcpSecret(env, apiKeyEnvVar);
  return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
}

/** Reject malformed or credential-bearing URLs before making an outbound call. */
export function validateMcpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("MCP server URL must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("MCP server URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("MCP server URL must not contain embedded credentials");
  }
  return parsed.toString();
}

function sessionFor(serverId) {
  const entry = sessions.get(serverId);
  if (entry && entry.expiresAt > Date.now()) return entry.sessionId;
  if (entry) sessions.delete(serverId);
  return null;
}

function rememberSession(serverId, sessionId) {
  if (sessionId)
    sessions.set(serverId, {
      sessionId,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
}

function clearSession(serverId) {
  sessions.delete(serverId);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new McpUpstreamError(
        `MCP request timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getSessionId(
  serverId,
  url,
  authHeaders,
  { fetchImpl, log, timeoutMs },
) {
  const cached = sessionFor(serverId);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...authHeaders,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "hcw-mcp-proxy", version: "1.0.0" },
          },
          id: -1,
        }),
      },
      timeoutMs,
    );
    const sessionId =
      response.headers.get("mcp-session-id") ||
      response.headers.get("Mcp-Session-Id") ||
      null;
    if (sessionId) rememberSession(serverId, sessionId);
    return sessionId;
  } catch (error) {
    log.warn?.("[mcp] initialize handshake failed", {
      serverId,
      message: error.message,
    });
    return null;
  }
}

async function httpRpc(serverId, url, rpcBody, authHeaders, options) {
  const { fetchImpl, log, timeoutMs } = options;
  const makeHeaders = (sessionId) => ({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...authHeaders,
    ...(sessionId ? { "MCP-Session-Id": sessionId } : {}),
  });

  const post = async (sessionId) => {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: "POST",
        headers: makeHeaders(sessionId),
        body: JSON.stringify(rpcBody),
      },
      timeoutMs,
    );
    const responseBody = await response.text();
    return { response, responseBody };
  };

  let sessionId = sessionFor(serverId);
  let result = await post(sessionId);

  // Stateless servers work on the first request. Session-based servers often
  // signal that they need initialize with 400/404/406; retry once with the
  // negotiated session, matching the behavior of the previous implementation.
  if ([400, 404, 406].includes(result.response.status)) {
    clearSession(serverId);
    sessionId = await getSessionId(serverId, url, authHeaders, {
      fetchImpl,
      log,
      timeoutMs,
    });
    result = await post(sessionId);
  }

  if (!result.response.ok) {
    throw new McpUpstreamError(
      `MCP server returned HTTP ${result.response.status}`,
      { status: result.response.status, responseBody: result.responseBody },
    );
  }

  return parseMcpResponseBody(result.responseBody);
}

function drainSseFrames(buffer) {
  const lines = buffer.split("\n");
  const tail = lines.pop();
  const frames = [];
  let event = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) event = trimmed.slice(6).trim();
    if (trimmed.startsWith("data:"))
      frames.push({ event, data: trimmed.slice(5).trim() });
  }
  return { frames, tail };
}

function sseEndpoint(postUrl, frame, sseUrl) {
  if (
    postUrl ||
    !(
      frame.event === "endpoint" ||
      frame.data.startsWith("/") ||
      frame.data.startsWith("http")
    )
  ) {
    return postUrl;
  }
  try {
    return new URL(frame.data, sseUrl).toString();
  } catch {
    return frame.data;
  }
}

function matchingSseResponse(data, targetId) {
  if (!data.startsWith("{")) return null;
  try {
    const message = JSON.parse(data);
    return message.id === targetId ? message : null;
  } catch {
    return null;
  }
}

/**
 * Relay an SSE MCP connection. Firecrawl and Replicate still use the legacy
 * SSE transport in the seeded configuration, while custom servers default to
 * Streamable HTTP.
 */
function sseRpc(sseUrl, authHeaders, rpcBody, { fetchImpl, timeoutMs }) {
  return new Promise(async (resolve, reject) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => finish(null, new McpUpstreamError("SSE MCP request timed out")),
      Math.min(timeoutMs, SSE_TIMEOUT_MS),
    );
    let postUrl = null;
    let requestSent = false;
    let settled = false;
    let buffer = "";
    let readyTimer = null;

    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (readyTimer) clearTimeout(readyTimer);
      controller.abort();
      if (error) reject(error);
      else resolve(result);
    };

    const post = async (body) => {
      const response = await fetchWithTimeout(
        fetchImpl,
        postUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...authHeaders,
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );
      await response.text();
      if (!response.ok)
        throw new McpUpstreamError(
          `SSE MCP POST returned HTTP ${response.status}`,
          { status: response.status },
        );
    };

    const sendRequest = async () => {
      if (requestSent || settled || !postUrl) return;
      requestSent = true;
      try {
        // The SSE transport requires initialize and initialized before the
        // requested tools/list or tools/call message.
        await post({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "hcw-mcp-proxy", version: "1.0.0" },
          },
          id: -1,
        });
        await post({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        });
        await post(rpcBody);
      } catch (error) {
        finish(null, error);
      }
    };

    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        sseUrl,
        {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            ...authHeaders,
          },
          signal: controller.signal,
        },
        timeoutMs,
      );
      if (!response.ok) {
        return finish(
          null,
          new McpUpstreamError(`SSE GET returned HTTP ${response.status}`, {
            status: response.status,
          }),
        );
      }
      if (!response.body?.getReader) {
        return finish(
          null,
          new McpUpstreamError("SSE server returned no readable event stream"),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (!settled) {
        const { value, done } = await reader.read();
        if (done)
          return finish(
            null,
            new McpUpstreamError("SSE stream ended before the MCP response"),
          );
        buffer += decoder.decode(value, { stream: true });
        const drained = drainSseFrames(buffer);
        buffer = drained.tail;
        for (const frame of drained.frames) {
          postUrl = sseEndpoint(postUrl, frame, sseUrl);
          if (postUrl && !readyTimer)
            readyTimer = setTimeout(sendRequest, 1_000);
          if (postUrl && frame.data.includes("SSE Connection established")) {
            if (readyTimer) clearTimeout(readyTimer);
            readyTimer = setTimeout(sendRequest, 50);
          }
          const matched = matchingSseResponse(frame.data, rpcBody.id);
          if (matched) finish(matched, null);
        }
      }
    } catch (error) {
      if (!settled && error?.name !== "AbortError") finish(null, error);
    }
  });
}

function callMcpRpc({
  serverId,
  url,
  transport,
  authHeaders,
  rpcBody,
  options,
}) {
  if (transport === "sse") return sseRpc(url, authHeaders, rpcBody, options);
  return httpRpc(serverId, url, rpcBody, authHeaders, options);
}

function extractMcpText(rawResult) {
  if (typeof rawResult === "string") return rawResult;
  if (Array.isArray(rawResult?.content)) {
    return rawResult.content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n");
  }
  return JSON.stringify(rawResult ?? {});
}

function normalizeMcpTools(rpcResult) {
  const tools = Array.isArray(rpcResult?.result?.tools)
    ? rpcResult.result.tools
    : [];
  return tools.map((tool) => ({
    name: tool.name || "",
    description: tool.description || "",
    inputSchema: tool.inputSchema || {},
  }));
}

function errorFields(error) {
  let upstream = {};
  try {
    upstream = parseMcpResponseBody(error.responseBody || "") || {};
  } catch {
    upstream = {};
  }
  return {
    status: error.status,
    upstreamError: upstream.error,
    upstreamDescription: upstream.error_description,
    message: error.message || "",
  };
}

function mcpAuthError(error, fallback) {
  const fields = errorFields(error);
  if (
    [401, 402, 403].includes(fields.status) ||
    fields.upstreamError === "invalid_token"
  ) {
    return {
      error:
        fields.upstreamDescription ||
        "MCP authentication failed. Check the Azure Function App setting or stored OAuth token for this server.",
      code: "UNAUTHENTICATED",
    };
  }
  return {
    error: fields.upstreamDescription || fields.message || fallback,
    code: null,
  };
}

function failureBody(authFailure, extra = {}) {
  return {
    ok: false,
    error: authFailure.error,
    ...(authFailure.code ? { code: authFailure.code } : {}),
    ...extra,
  };
}

async function markServerError(store, serverId, message, now) {
  try {
    await store.patchDoc(MCP_CONTAINER, serverId, {
      status: "error",
      lastTested: now().toISOString(),
      lastError: message,
    });
  } catch {
    // The upstream failure is the useful result; do not mask it with a status-write failure.
  }
}

/**
 * Call one tool on one configured MCP server, server-side, with the stored
 * credential — the same transport, auth resolution and error mapping
 * `mcpProxy` uses, without the HTTP request around it.
 *
 * Extracted so a platform job can read a Plaud transcript with the token the
 * Connect tab stored (lib/podcast/recording-generate.js) instead of routing
 * through the browser proxy it cannot call. `mcpProxy` is a thin wrapper over
 * this, so the two cannot drift.
 *
 * Returns an outcome rather than throwing: `{ ok: true, result, raw }` on a
 * tool result, or `{ ok: false, error, code?, httpStatus }` where `httpStatus`
 * is what the proxy answers for that failure (404 unknown server, 403
 * disabled, 400 bad URL or arguments, 500 configuration read failed) and 200
 * for an upstream failure the proxy reports in the body. `code` is
 * `UNAUTHENTICATED` when the upstream rejected the credential (401/402/403 or
 * `invalid_token`), which is the signal a caller uses to say "reconnect"
 * rather than "retry".
 *
 * @param {object} params
 * @param {{ readDoc: Function }} params.store
 * @param {string} params.serverId
 * @param {string} params.tool
 * @param {object} [params.arguments]
 * @param {object} [params.env]
 * @param {Function} [params.fetch]
 * @param {{ warn?: Function, error?: Function }} [params.log]
 * @param {number} [params.timeoutMs]
 */
export async function callMcpTool({
  store,
  serverId: rawServerId,
  tool: rawTool,
  arguments: toolArguments = {},
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  log = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const serverId = String(rawServerId || "").trim();
  const tool = String(rawTool || "").trim();
  if (!serverId || !tool) {
    return { ok: false, error: "serverId and tool are required", httpStatus: 400 };
  }

  let server;
  try {
    server = await store.readDoc(MCP_CONTAINER, serverId, serverId);
  } catch (error) {
    log.error?.(
      `[mcp] configuration read failed: server=${serverId} code=${error?.code ?? error?.statusCode ?? "n/a"} ${error?.message || error}`,
    );
    return {
      ok: false,
      error: "Failed to read MCP server configuration",
      httpStatus: 500,
    };
  }
  if (!server) return { ok: false, error: "MCP server not found", httpStatus: 404 };
  if (server.enabled !== true) {
    return { ok: false, error: "MCP server is disabled", httpStatus: 403 };
  }

  let url;
  try {
    url = validateMcpUrl(server.url);
  } catch (error) {
    return { ok: false, error: error.message, httpStatus: 400 };
  }

  if (
    !toolArguments ||
    typeof toolArguments !== "object" ||
    Array.isArray(toolArguments)
  ) {
    return { ok: false, error: "arguments must be a JSON object", httpStatus: 400 };
  }

  try {
    const rpcResult = await callMcpRpc({
      serverId,
      url,
      transport: server.transport || "http",
      authHeaders: resolveMcpAuthHeaders({
        oauthToken: server.oauthToken,
        apiKeyEnvVar: server.apiKeyEnvVar,
        env,
      }),
      rpcBody: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: tool, arguments: toolArguments },
        id: 2,
      },
      options: { fetchImpl, log, timeoutMs },
    });

    if (rpcResult?.error) {
      return {
        ok: false,
        error: rpcResult.error.message || "MCP error",
        code: rpcResult.error.code,
        httpStatus: 200,
      };
    }
    if (!rpcResult || !Object.hasOwn(rpcResult, "result")) {
      return { ok: false, error: "MCP server returned no tool result", httpStatus: 200 };
    }

    const rawResult = rpcResult.result;
    const result = extractMcpText(rawResult);
    if (rawResult?.isError) {
      return { ok: false, error: result || "MCP tool error", httpStatus: 200 };
    }
    return { ok: true, result, raw: rawResult, httpStatus: 200 };
  } catch (error) {
    // Content-free on purpose: a McpUpstreamError carries `responseBody`,
    // which for a tool call can be the tool's output — a transcript — and
    // logging the error object whole would put that in Function logs. The
    // server, the tool, the HTTP status and the error's own message are all
    // an operator needs; the body reaches only the caller, through
    // `mcpAuthError`, and only as an OAuth error description.
    log.error?.(
      `[mcp] upstream call failed: server=${serverId} tool=${tool} status=${error?.status ?? "n/a"} ${error?.message || error}`,
    );
    return {
      ...failureBody(mcpAuthError(error, "MCP tool call failed")),
      httpStatus: 200,
    };
  }
}

/** Create the two admin MCP handlers with injectable dependencies for tests. */
export function createMcpHandlers({
  guard,
  store,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const transportOptions = { fetchImpl, log, timeoutMs };

  return {
    async mcpProxy(request, context) {
      const auth = await guard.requireRole(request, "editor");
      if (auth.error) return auth.error;

      const body = await request.json().catch(() => null);
      const { httpStatus, ...outcome } = await callMcpTool({
        store,
        serverId: body?.serverId,
        tool: body?.tool,
        arguments: body?.arguments ?? {},
        env,
        fetch: fetchImpl,
        log: {
          warn: (...args) => log.warn?.(...args),
          error: (...args) => context.error?.("[mcpProxy]", ...args),
        },
        timeoutMs,
      });
      return json(httpStatus, outcome);
    },

    async syncMcpTools(request, context) {
      const auth = await guard.requireRole(request, "editor");
      if (auth.error) return auth.error;

      const body = await request.json().catch(() => null);
      const serverId = String(body?.serverId || "").trim();
      if (!serverId)
        return json(400, { ok: false, error: "serverId is required" });

      let server;
      try {
        server = await store.readDoc(MCP_CONTAINER, serverId, serverId);
      } catch (error) {
        context.error?.("[syncMcpTools] configuration read failed:", error);
        return json(500, {
          ok: false,
          error: "Failed to read MCP server configuration",
        });
      }
      if (!server)
        return json(404, { ok: false, error: "MCP server not found" });

      let url;
      try {
        url = validateMcpUrl(server.url);
      } catch (error) {
        await markServerError(store, serverId, error.message, now);
        return json(200, { ok: false, error: error.message, tools: [] });
      }

      try {
        const rpcResult = await callMcpRpc({
          serverId,
          url,
          transport: server.transport || "http",
          authHeaders: resolveMcpAuthHeaders({
            oauthToken: server.oauthToken,
            apiKeyEnvVar: server.apiKeyEnvVar,
            env,
          }),
          rpcBody: { jsonrpc: "2.0", method: "tools/list", params: {}, id: 1 },
          options: transportOptions,
        });

        if (rpcResult?.error) {
          const message = rpcResult.error.message || "MCP error";
          await markServerError(store, serverId, message, now);
          return json(200, { ok: false, error: message, tools: [] });
        }
        if (!rpcResult || !Object.hasOwn(rpcResult, "result")) {
          const message = "MCP server returned no tool list";
          await markServerError(store, serverId, message, now);
          return json(200, { ok: false, error: message, tools: [] });
        }

        const tools = normalizeMcpTools(rpcResult);
        await store.patchDoc(MCP_CONTAINER, serverId, {
          tools,
          status: "connected",
          lastTested: now().toISOString(),
          lastError: null,
        });
        return json(200, { ok: true, tools });
      } catch (error) {
        const message = error.message || "MCP tool sync failed";
        context.error?.("[syncMcpTools] upstream call failed:", error);
        await markServerError(store, serverId, message, now);
        return json(200, {
          ...failureBody(mcpAuthError(error, message)),
          tools: [],
        });
      }
    },
  };
}
