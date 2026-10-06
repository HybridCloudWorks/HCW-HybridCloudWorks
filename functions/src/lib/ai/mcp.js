/**
 * Server-side MCP transport for the AI Engine admin tools.
 *
 * The browser calls these handlers with its Entra bearer token. MCP
 * credentials are resolved here from Azure Function App settings / Key Vault
 * references or from the write-only oauthToken field in Cosmos DB.
 */
import { parseMcpResponseBody } from '../cloud-tools/mcp-parse.js';
import {
  INTEGRATION_KEY_HOSTS,
  KNOWN_INTEGRATION_KEY_NAMES,
  MCP_KEY_ENV_PATTERN,
  readMcpSecret,
  resolveMcpAuthHeaders,
  validateMcpApiKeyEnvVar,
  validateMcpKeyBinding,
  validateMcpUrl,
} from './mcp-policy.js';

const MCP_CONTAINER = 'mcp_servers';
const SESSION_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const SSE_TIMEOUT_MS = 25_000;
const sessions = new Map();

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

class McpUpstreamError extends Error {
  constructor(message, { status = 0, responseBody = '' } = {}) {
    super(message);
    this.name = 'McpUpstreamError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * The URL rule, the key-name allowlist and the credential resolution are
 * mcp-policy.js; they are re-exported so every caller keeps importing them
 * from here.
 */
export {
  INTEGRATION_KEY_HOSTS,
  KNOWN_INTEGRATION_KEY_NAMES,
  MCP_KEY_ENV_PATTERN,
  readMcpSecret,
  resolveMcpAuthHeaders,
  validateMcpApiKeyEnvVar,
  validateMcpKeyBinding,
  validateMcpUrl,
};

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
    if (error?.name === 'AbortError') {
      throw new McpUpstreamError(`MCP request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getSessionId(serverId, url, authHeaders, { fetchImpl, log, timeoutMs }) {
  const cached = sessionFor(serverId);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...authHeaders,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'hcw-mcp-proxy', version: '1.0.0' },
          },
          id: -1,
        }),
      },
      timeoutMs
    );
    const sessionId =
      response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id') || null;
    if (sessionId) rememberSession(serverId, sessionId);
    return sessionId;
  } catch (error) {
    log.warn?.('[mcp] initialize handshake failed', {
      serverId,
      message: error.message,
    });
    return null;
  }
}

async function httpRpc(serverId, url, rpcBody, authHeaders, options) {
  const { fetchImpl, log, timeoutMs } = options;
  const makeHeaders = (sessionId) => ({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...authHeaders,
    ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
  });

  const post = async (sessionId) => {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers: makeHeaders(sessionId),
        body: JSON.stringify(rpcBody),
      },
      timeoutMs
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
    throw new McpUpstreamError(`MCP server returned HTTP ${result.response.status}`, {
      status: result.response.status,
      responseBody: result.responseBody,
    });
  }

  return parseMcpResponseBody(result.responseBody);
}

function drainSseFrames(buffer) {
  const lines = buffer.split('\n');
  const tail = lines.pop();
  const frames = [];
  let event = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) event = trimmed.slice(6).trim();
    if (trimmed.startsWith('data:')) frames.push({ event, data: trimmed.slice(5).trim() });
  }
  return { frames, tail };
}

function sseEndpoint(postUrl, frame, sseUrl) {
  if (
    postUrl ||
    !(frame.event === 'endpoint' || frame.data.startsWith('/') || frame.data.startsWith('http'))
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
  if (!data.startsWith('{')) return null;
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
      () => finish(null, new McpUpstreamError('SSE MCP request timed out')),
      Math.min(timeoutMs, SSE_TIMEOUT_MS)
    );
    let postUrl = null;
    let requestSent = false;
    let settled = false;
    let buffer = '';
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
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      await response.text();
      if (!response.ok)
        throw new McpUpstreamError(`SSE MCP POST returned HTTP ${response.status}`, {
          status: response.status,
        });
    };

    const sendRequest = async () => {
      if (requestSent || settled || !postUrl) return;
      requestSent = true;
      try {
        // The SSE transport requires initialize and initialized before the
        // requested tools/list or tools/call message.
        await post({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'hcw-mcp-proxy', version: '1.0.0' },
          },
          id: -1,
        });
        await post({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
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
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
            ...authHeaders,
          },
          signal: controller.signal,
        },
        timeoutMs
      );
      if (!response.ok) {
        return finish(
          null,
          new McpUpstreamError(`SSE GET returned HTTP ${response.status}`, {
            status: response.status,
          })
        );
      }
      if (!response.body?.getReader) {
        return finish(null, new McpUpstreamError('SSE server returned no readable event stream'));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (!settled) {
        const { value, done } = await reader.read();
        if (done)
          return finish(null, new McpUpstreamError('SSE stream ended before the MCP response'));
        buffer += decoder.decode(value, { stream: true });
        const drained = drainSseFrames(buffer);
        buffer = drained.tail;
        for (const frame of drained.frames) {
          postUrl = sseEndpoint(postUrl, frame, sseUrl);
          if (postUrl && !readyTimer) readyTimer = setTimeout(sendRequest, 1_000);
          if (postUrl && frame.data.includes('SSE Connection established')) {
            if (readyTimer) clearTimeout(readyTimer);
            readyTimer = setTimeout(sendRequest, 50);
          }
          const matched = matchingSseResponse(frame.data, rpcBody.id);
          if (matched) finish(matched, null);
        }
      }
    } catch (error) {
      if (!settled && error?.name !== 'AbortError') finish(null, error);
    }
  });
}

function callMcpRpc({ serverId, url, transport, authHeaders, rpcBody, options }) {
  if (transport === 'sse') return sseRpc(url, authHeaders, rpcBody, options);
  return httpRpc(serverId, url, rpcBody, authHeaders, options);
}

function extractMcpText(rawResult) {
  if (typeof rawResult === 'string') return rawResult;
  if (Array.isArray(rawResult?.content)) {
    return rawResult.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
  }
  return JSON.stringify(rawResult ?? {});
}

function normalizeMcpTools(rpcResult) {
  const tools = Array.isArray(rpcResult?.result?.tools) ? rpcResult.result.tools : [];
  return tools.map((tool) => ({
    name: tool.name || '',
    description: tool.description || '',
    inputSchema: tool.inputSchema || {},
  }));
}

function errorFields(error) {
  let upstream = {};
  try {
    upstream = parseMcpResponseBody(error.responseBody || '') || {};
  } catch {
    upstream = {};
  }
  return {
    status: error.status,
    upstreamError: upstream.error,
    upstreamDescription: upstream.error_description,
    message: error.message || '',
  };
}

function mcpAuthError(error, fallback) {
  const fields = errorFields(error);
  if ([401, 402, 403].includes(fields.status) || fields.upstreamError === 'invalid_token') {
    return {
      error:
        fields.upstreamDescription ||
        'MCP authentication failed. Check the Azure Function App setting or stored OAuth token for this server.',
      code: 'UNAUTHENTICATED',
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
      status: 'error',
      lastTested: now().toISOString(),
      lastError: message,
    });
  } catch {
    // The upstream failure is the useful result; do not mask it with a status-write failure.
  }
}

/**
 * The configured server, or the outcome refusing the call: 500 when the
 * configuration could not be read (`onReadError` gets the error, so each
 * caller logs it its own way), 404 when there is no such server.
 */
async function loadMcpServer(store, serverId, onReadError) {
  let server;
  try {
    server = await store.readDoc(MCP_CONTAINER, serverId, serverId);
  } catch (error) {
    onReadError(error);
    return {
      failure: {
        ok: false,
        error: 'Failed to read MCP server configuration',
        httpStatus: 500,
      },
    };
  }
  if (!server) return { failure: { ok: false, error: 'MCP server not found', httpStatus: 404 } };
  return { server };
}

/** The server's URL under the URL rule and the key-name allowlist, or the message refusing it. */
function validatedMcpUrl(server) {
  try {
    const url = validateMcpUrl(server.url);
    validateMcpKeyBinding({ url, apiKeyEnvVar: server.apiKeyEnvVar });
    return { url };
  } catch (error) {
    return { error: error.message };
  }
}

const isJsonObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * What stands between a found server and a tool call: the server must be
 * enabled, its URL and key name must pass policy, and the arguments must be
 * a JSON object. The URL on success, the outcome on refusal.
 */
function prepareToolCall(server, toolArguments) {
  if (server.enabled !== true) {
    return { failure: { ok: false, error: 'MCP server is disabled', httpStatus: 403 } };
  }
  const { url, error } = validatedMcpUrl(server);
  if (error) return { failure: { ok: false, error, httpStatus: 400 } };
  if (!isJsonObject(toolArguments)) {
    return {
      failure: {
        ok: false,
        error: 'arguments must be a JSON object',
        httpStatus: 400,
      },
    };
  }
  return { url };
}

/** One JSON-RPC call to a configured server, with the credential it stores. */
function rpcOnServer({ serverId, server, url, rpcBody, env, options }) {
  return callMcpRpc({
    serverId,
    url,
    transport: server.transport || 'http',
    authHeaders: resolveMcpAuthHeaders({
      oauthToken: server.oauthToken,
      apiKeyEnvVar: server.apiKeyEnvVar,
      url,
      env,
    }),
    rpcBody,
    options,
  });
}

/** A tools/call reply as the outcome callMcpTool reports; every shape is a 200. */
function toolCallOutcome(rpcResult) {
  if (rpcResult?.error) {
    return {
      ok: false,
      error: rpcResult.error.message || 'MCP error',
      code: rpcResult.error.code,
      httpStatus: 200,
    };
  }
  if (!rpcResult || !Object.hasOwn(rpcResult, 'result')) {
    return {
      ok: false,
      error: 'MCP server returned no tool result',
      httpStatus: 200,
    };
  }
  const rawResult = rpcResult.result;
  const result = extractMcpText(rawResult);
  if (rawResult?.isError) {
    return { ok: false, error: result || 'MCP tool error', httpStatus: 200 };
  }
  return { ok: true, result, raw: rawResult, httpStatus: 200 };
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
  const serverId = String(rawServerId || '').trim();
  const tool = String(rawTool || '').trim();
  if (!serverId || !tool) {
    return {
      ok: false,
      error: 'serverId and tool are required',
      httpStatus: 400,
    };
  }

  const loaded = await loadMcpServer(store, serverId, (error) =>
    log.error?.(
      `[mcp] configuration read failed: server=${serverId} code=${error?.code ?? error?.statusCode ?? 'n/a'} ${error?.message || error}`
    )
  );
  if (loaded.failure) return loaded.failure;
  const { server } = loaded;

  const prepared = prepareToolCall(server, toolArguments);
  if (prepared.failure) return prepared.failure;

  try {
    const rpcResult = await rpcOnServer({
      serverId,
      server,
      url: prepared.url,
      rpcBody: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: tool, arguments: toolArguments },
        id: 2,
      },
      env,
      options: { fetchImpl, log, timeoutMs },
    });
    return toolCallOutcome(rpcResult);
  } catch (error) {
    // Content-free on purpose: a McpUpstreamError carries `responseBody`,
    // which for a tool call can be the tool's output — a transcript — and
    // logging the error object whole would put that in Function logs. The
    // server, the tool, the HTTP status and the error's own message are all
    // an operator needs; the body reaches only the caller, through
    // `mcpAuthError`, and only as an OAuth error description.
    log.error?.(
      `[mcp] upstream call failed: server=${serverId} tool=${tool} status=${error?.status ?? 'n/a'} ${error?.message || error}`
    );
    return {
      ...failureBody(mcpAuthError(error, 'MCP tool call failed')),
      httpStatus: 200,
    };
  }
}

/** A sync that could not reach a tool list: the server marked, the 200 saying why. */
async function syncFailed({ store, now }, serverId, message) {
  await markServerError(store, serverId, message, now);
  return json(200, { ok: false, error: message, tools: [] });
}

/** A tools/list reply as the tools it carries, or the message refusing it. */
function toolListOutcome(rpcResult) {
  if (rpcResult?.error) return { error: rpcResult.error.message || 'MCP error' };
  if (!rpcResult || !Object.hasOwn(rpcResult, 'result')) {
    return { error: 'MCP server returned no tool list' };
  }
  return { tools: normalizeMcpTools(rpcResult) };
}

/** tools/list on a validated server, the result stored on its document. */
async function syncToolList(ctx, context, { serverId, server, url }) {
  const { store, env, now, transportOptions } = ctx;
  try {
    const rpcResult = await rpcOnServer({
      serverId,
      server,
      url,
      rpcBody: { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 },
      env,
      options: transportOptions,
    });
    const outcome = toolListOutcome(rpcResult);
    if (outcome.error) return syncFailed(ctx, serverId, outcome.error);

    await store.patchDoc(MCP_CONTAINER, serverId, {
      tools: outcome.tools,
      status: 'connected',
      lastTested: now().toISOString(),
      lastError: null,
    });
    return json(200, { ok: true, tools: outcome.tools });
  } catch (error) {
    const message = error.message || 'MCP tool sync failed';
    context.error?.('[syncMcpTools] upstream call failed:', error);
    await markServerError(store, serverId, message, now);
    return json(200, {
      ...failureBody(mcpAuthError(error, message)),
      tools: [],
    });
  }
}

/** POST syncMcpTools: parse, find the server, check its URL, then list its tools. */
async function syncMcpTools(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const serverId = String(body?.serverId || '').trim();
  if (!serverId) return json(400, { ok: false, error: 'serverId is required' });

  const loaded = await loadMcpServer(ctx.store, serverId, (error) =>
    context.error?.('[syncMcpTools] configuration read failed:', error)
  );
  if (loaded.failure) {
    const { httpStatus, ...failure } = loaded.failure;
    return json(httpStatus, failure);
  }

  const { url, error } = validatedMcpUrl(loaded.server);
  if (error) return syncFailed(ctx, serverId, error);
  return syncToolList(ctx, context, { serverId, server: loaded.server, url });
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
  const ctx = { guard, store, env, now, transportOptions: { fetchImpl, log, timeoutMs } };

  return {
    async mcpProxy(request, context) {
      const auth = await guard.requireRole(request, 'editor');
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
          error: (...args) => context.error?.('[mcpProxy]', ...args),
        },
        timeoutMs,
      });
      return json(httpStatus, outcome);
    },

    syncMcpTools: (request, context) => syncMcpTools(ctx, request, context),
  };
}
