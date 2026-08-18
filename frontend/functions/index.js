const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('./lib/firebase-admin');
const https = require('https');
const http = require('http');
const RssParser = require('rss-parser');
const dns = require('dns');
const util = require('util');
const { URL } = require('url');

const lookup = util.promisify(dns.lookup);

let sharp = null;
try {
  sharp = require('sharp');
} catch (error) {
  logger.warn(
    `sharp module not available in local runtime; image generation functions may be limited during local analysis (${error?.message || String(error)})`
  );
}
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const {
  generateJsonResponse,
  generateTextResponse,
  getActiveAiProvider,
  callProvider,
  getCostEstimate,
} = require('./lib/ai-model-router');
const { requireAdminClaims, ADMIN_ROLES } = require('./lib/admin-auth');
const { loadKeywordMatrix, applyMatrix } = require('./lib/promptKeywords');
const FirecrawlApp = require('@mendable/firecrawl-js').default;

// Define secrets — bound to Cloud Functions runtime via Secret Manager.
// Listed in `secrets: [...]` on each function below so values are populated
// into process.env at invocation time (no plaintext in env vars).
const replicateApiKey = defineSecret('REPLICATE_API_KEY');
const firecrawlApiKey = defineSecret('FIRECRAWL_API_KEY');
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');
const openaiApiKey = defineSecret('OPENAI_API_KEY');
const perplexityApiKey = defineSecret('PERPLEXITY_API_KEY');
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const vpsApiToken = defineSecret('VPS_API_TOKEN');

// Shared bundle for any function that may invoke the ai-model-router
// (generateJsonResponse / generateTextResponse / callProvider). Routing
// decisions happen at runtime, so attach all providers wherever any could fire.
const aiSecrets = [anthropicApiKey, openaiApiKey, perplexityApiKey, geminiApiKey];

const BUCKET = 'hybridcloudworks-61e8d.appspot.com';
const ADMIN_ALLOWED_ORIGINS = (process.env.CMS_ADMIN_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://hybridcloudworks.com',
  'https://www.hybridcloudworks.com',
  ...ADMIN_ALLOWED_ORIGINS,
];

function applyAdminCors(req, res, allowedMethods = 'POST, OPTIONS') {
  const { origin } = req.headers;
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return false;
    }
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }

  res.set('Access-Control-Allow-Methods', allowedMethods);
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }

  return true;
}

function applyPublicCors(req, res, allowedMethods = 'GET, OPTIONS') {
  const { origin } = req.headers;
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return false;
    }
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }

  res.set('Access-Control-Allow-Methods', allowedMethods);
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }

  return true;
}

const PLATFORM_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
let platformHealthCache = null;

function normalizeStatus(isOperational) {
  return isOperational ? 'OPERATIONAL' : 'DEGRADED';
}

function getAwsStatusFromEvents(activeEvents) {
  if (activeEvents.length === 0) return 'OPERATIONAL';

  const hasGlobalImpact = activeEvents.some((event) =>
    ['Global', 'GLOBAL'].includes(event.region_name || '')
  );
  return hasGlobalImpact ? 'DEGRADED' : 'REGIONAL IMPACT';
}

async function fetchProviderStatus(provider, url, parseFn) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'HybridCloudWorks-PlatformHealth/1.0' },
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (response.status < 200 || response.status >= 300) {
      return { provider, status: 'UNKNOWN', statusCode: response.status };
    }

    return { provider, status: parseFn(response.data), statusCode: response.status };
  } catch (error) {
    logger.warn(`[platformHealth] ${provider} status check failed`, {
      message: error?.message || String(error),
    });
    return { provider, status: 'UNKNOWN' };
  }
}

function decodeUtf16JsonBuffer(buffer) {
  const bytes = Buffer.from(buffer);
  const encoding = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-16le';
  return new util.TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, '');
}

async function fetchAwsStatus() {
  try {
    const response = await axios.get('https://status.aws.amazon.com/data.json', {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: { 'User-Agent': 'HybridCloudWorks-PlatformHealth/1.0' },
    });
    const events = JSON.parse(decodeUtf16JsonBuffer(response.data));
    const activeEvents = Array.isArray(events)
      ? events.filter((event) => event.status !== '0')
      : [];

    return {
      provider: 'aws',
      status: getAwsStatusFromEvents(activeEvents),
      statusCode: response.status,
    };
  } catch (error) {
    logger.warn('[platformHealth] aws status check failed', {
      message: error?.message || String(error),
    });
    return { provider: 'aws', status: 'UNKNOWN' };
  }
}

async function fetchAzureStatus() {
  try {
    const parser = new RssParser({
      timeout: 8000,
      headers: { 'User-Agent': 'HybridCloudWorks-PlatformHealth/1.0' },
    });
    const feed = await parser.parseURL('https://rssfeed.azure.status.microsoft/en-us/status/feed/');

    return {
      provider: 'azure',
      status: feed.items?.length > 0 ? 'DEGRADED' : 'OPERATIONAL',
    };
  } catch (error) {
    logger.warn('[platformHealth] azure status check failed', {
      message: error?.message || String(error),
    });
    return { provider: 'azure', status: 'UNKNOWN' };
  }
}

async function getProviderStatuses() {
  const checks = await Promise.all([
    fetchAwsStatus(),
    fetchAzureStatus(),
    fetchProviderStatus('gcp', 'https://status.cloud.google.com/incidents.json', (data) =>
      normalizeStatus(Array.isArray(data) && data.filter((incident) => !incident.end).length === 0)
    ),
    fetchProviderStatus('github', 'https://www.githubstatus.com/api/v2/status.json', (data) =>
      normalizeStatus(data?.status?.indicator === 'none')
    ),
  ]);

  return checks.reduce((statuses, check) => {
    statuses[check.provider] = check.status;
    return statuses;
  }, {});
}

exports.getPlatformHealth = onRequest(
  { region: 'us-central1', timeoutSeconds: 15, memory: '256MiB' },
  async (req, res) => {
    if (!applyPublicCors(req, res)) return;
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }

    const now = Date.now();
    if (platformHealthCache && now - platformHealthCache.fetchedAt < PLATFORM_HEALTH_CACHE_TTL_MS) {
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      res.json({ ok: true, cached: true, ...platformHealthCache.payload });
      return;
    }

    try {
      const statuses = await getProviderStatuses();
      const payload = {
        statuses,
        checkedAt: new Date(now).toISOString(),
      };
      platformHealthCache = { fetchedAt: now, payload };
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      res.json({ ok: true, cached: false, ...payload });
    } catch (error) {
      logger.error('[platformHealth] Failed to build platform health response', error);
      res.status(500).json({ ok: false, error: 'Failed to fetch platform health' });
    }
  }
);

// An expired or revoked token is reported inconsistently across MCP servers:
// sometimes as a structured error code, sometimes only in free text, and in
// either the description or the message. Both spellings are checked against
// both fields — the same four tests as before, expressed as a matrix.
const INVALID_TOKEN_PATTERNS = [/invalid[_\s-]?token/i, /expired token/i];

function isInvalidTokenError({ upstreamError, upstreamDescription, message }) {
  if (upstreamError === 'invalid_token') return true;
  const fields = [upstreamDescription || '', message];
  return INVALID_TOKEN_PATTERNS.some((pattern) => fields.some((field) => pattern.test(field)));
}

// Every optional-chain hop and every || fallback is a branch, so lifting the
// field reads and the token heuristic out leaves getMcpAuthError as just the
// status/serverId decision it is meant to be.
function readMcpErrorFields(err) {
  return {
    status: err?.response?.status,
    upstreamError: err?.response?.data?.error,
    upstreamDescription: err?.response?.data?.error_description,
    message: err?.message || '',
  };
}

function getMcpAuthError(err, fallbackMessage, serverId = null) {
  const fields = readMcpErrorFields(err);
  const { status, upstreamDescription, message } = fields;

  if (status === 401 || status === 402 || isInvalidTokenError(fields)) {
    // Only surface Plaud-specific reconnect instructions for the Plaud server.
    if (serverId === 'plaud') {
      return {
        error:
          'Plaud access token is invalid or expired. Re-run the Plaud MCP login/install flow, copy the new access_token from ~/.plaud/tokens-mcp.json, then paste it into /admin/recordings -> Connect and click Save & Test.',
        code: 'UNAUTHENTICATED',
      };
    }
    return {
      error:
        upstreamDescription ||
        'Authentication failed. Check the API key or OAuth token configured for this server.',
      code: 'UNAUTHENTICATED',
    };
  }

  return {
    error: upstreamDescription || message || fallbackMessage,
    code: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Transport Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory session cache for Streamable-HTTP MCP servers that require
 * an initialize handshake (e.g. Draw.io, Context7).
 * Cloud Function instances reuse sessions within their warm lifetime.
 * Map: serverId → { sessionId: string, expiresAt: number }
 */
const mcpSessionCache = new Map();

/**
 * Parses an MCP HTTP response body that is either:
 *   • Plain JSON:           { "jsonrpc":"2.0", "result":{...} }
 *   • SSE-wrapped JSON:     "event: message\ndata: {...}\n\n"
 * Returns the decoded JSON-RPC object, or {} on failure.
 */
function parseMcpResponseBody(bodyText) {
  const text = (bodyText || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  // SSE wire format — collect all data: lines
  const dataLines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  const joined = dataLines.join('\n');
  if (joined) {
    try {
      return JSON.parse(joined);
    } catch {
      /* ignore */
    }
  }
  return {};
}

/**
 * Performs the MCP initialize handshake for session-based servers.
 * Caches the returned Mcp-Session-Id for 5 minutes per serverId.
 *
 * @param {string} serverId
 * @param {string} url
 * @param {Object} authHeaders   e.g. { Authorization: 'Bearer ...' }
 * @returns {Promise<string|null>}  sessionId or null if not required
 */
async function mcpGetSessionId(serverId, url, authHeaders) {
  const cached = mcpSessionCache.get(serverId);
  if (cached && cached.expiresAt > Date.now()) return cached.sessionId;

  try {
    const resp = await fetch(url, {
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
    });
    const sessionId =
      resp.headers.get('mcp-session-id') || resp.headers.get('Mcp-Session-Id') || null;
    if (sessionId) {
      mcpSessionCache.set(serverId, { sessionId, expiresAt: Date.now() + 5 * 60_000 });
    }
    return sessionId;
  } catch (e) {
    logger.warn('[mcpGetSessionId] handshake failed', { serverId, error: e.message });
    return null;
  }
}

/**
 * Sends a JSON-RPC request to a Streamable-HTTP MCP server.
 * Handles both stateless (AWS, MS Learn) and session-based (Draw.io, Context7) servers.
 * On 400/404/406 responses it automatically performs an initialize handshake and retries.
 *
 * @param {string} serverId
 * @param {string} url
 * @param {Object} rpcBody       JSON-RPC request body
 * @param {Object} authHeaders   { Authorization?: string }
 * @returns {Promise<Object>}    Parsed JSON-RPC response envelope
 */
async function mcpHttpRpc(serverId, url, rpcBody, authHeaders) {
  const cachedSession = mcpSessionCache.get(serverId);
  const buildHeaders = (sessionId) => ({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...authHeaders,
    ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
  });

  const doPost = async (sessionId) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(sessionId),
      body: JSON.stringify(rpcBody),
    });
    return { status: resp.status, bodyText: await resp.text() };
  };

  // First attempt — use cached session if available
  let { status, bodyText } = await doPost(cachedSession?.sessionId ?? null);

  // On session-related errors, perform initialize handshake and retry once
  if ([400, 404, 406].includes(status)) {
    mcpSessionCache.delete(serverId);
    const sessionId = await mcpGetSessionId(serverId, url, authHeaders);
    ({ status, bodyText } = await doPost(sessionId));
  }

  return parseMcpResponseBody(bodyText);
}

// ── SSE frame parsing, split out of the mcpSseRpc executor ────────────────────
//
// The executor below is a state machine over a byte stream; inlining the frame
// parsing put every parse branch on the same function as the connection
// lifecycle. These four helpers are the parsing half, and being pure they are
// directly testable in a way the executor is not.

/**
 * Split an SSE buffer into { event, data } frames, returning the unconsumed
 * tail. `event:` applies to the frames that follow it within the same buffer,
 * which is the behaviour of the inline loop this replaces.
 */
function drainSseFrames(buffer) {
  const bufferLines = buffer.split('\n');
  const tail = bufferLines.pop();
  const frames = [];
  let currentEvent = '';
  for (const line of bufferLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      currentEvent = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:')) {
      frames.push({ event: currentEvent, data: trimmed.slice(5).trim() });
    }
  }
  return { frames, tail };
}

/** The frame that advertises where to POST — only meaningful before one is known. */
function isSseEndpointFrame(postUrl, { event, data }) {
  return (
    !postUrl && (event === 'endpoint' || data.startsWith('/') || data.startsWith('http'))
  );
}

/** The welcome/keepalive frame that signals the endpoint is ready to accept the POST. */
function isSseReadyFrame(postUrl, requestSent, { data }) {
  return (
    Boolean(postUrl) &&
    !requestSent &&
    (data.includes('SSE Connection established') || data.includes('notifications/message'))
  );
}

/** Absolute POST URL for a frame, falling back to the raw value if it will not parse. */
function resolveSsePostUrl(data, sseUrl) {
  try {
    return new URL(data, sseUrl).toString();
  } catch {
    return data;
  }
}

/** The JSON-RPC envelope for our request id, or null for any other frame. */
function matchSseRpcResponse(data, targetId) {
  if (!data.startsWith('{')) return null;
  try {
    const msg = JSON.parse(data);
    return msg.id === targetId ? msg : null;
  } catch {
    return null;
  }
}

/**
 * Executes an MCP JSON-RPC call over SSE transport (Firecrawl, Replicate).
 *
 * Uses the global fetch() API for BOTH the SSE GET and the subsequent POSTs
 * so they share the same undici HTTP/2 connection pool — required by servers
 * that tie session validity to the connection layer.
 *
 * Protocol:
 *   1. GET /sse        → opens event stream, receives `endpoint` event with POST URL
 *   2. server ready    → server emits a notifications/message ("SSE Connection established")
 *   3. POST initialize → client confirms protocol version (202 Accepted)
 *   4. POST notifications/initialized → client declares it is ready (MCP spec requirement)
 *   5. POST rpcBody    → actual request (tools/list or tools/call)
 *   6. Collect response from SSE stream (matched by JSON-RPC id)
 *
 * @param {string} sseUrl        SSE endpoint (e.g. https://mcp.firecrawl.dev/sse)
 * @param {Object} authHeaders   { Authorization?: string }
 * @param {Object} rpcBody       JSON-RPC body — MUST include a unique numeric `id`
 * @returns {Promise<Object>}    Parsed JSON-RPC response envelope
 */
function mcpSseRpc(sseUrl, authHeaders, rpcBody) {
  return new Promise(async (resolve, reject) => {
    const targetId = rpcBody.id;
    const controller = new AbortController();
    let postUrl = null;
    let requestSent = false;
    let resolved = false;
    let sseBuffer = '';
    let readyTimer = null;

    const timeoutHandle = setTimeout(() => {
      done(null, new Error('SSE MCP request timed out (25 s)'));
    }, 25000);

    const done = (result, err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      if (readyTimer) clearTimeout(readyTimer);
      try {
        controller.abort();
      } catch (_) {}
      if (err) reject(err);
      else resolve(result);
    };

    const sendRequest = async () => {
      if (requestSent || resolved) return;
      requestSent = true;
      try {
        const resp = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify(rpcBody),
        });
        await resp.text();
      } catch (err) {
        done(null, err);
      }
    };

    try {
      const getRes = await fetch(sseUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...authHeaders,
        },
        signal: controller.signal,
      });

      if (!getRes.ok) {
        return done(null, new Error(`SSE GET failed: ${getRes.status} ${getRes.statusText}`));
      }

      const reader = getRes.body.getReader();
      const decoder = new TextDecoder();

      while (!resolved) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) {
          return done(null, new Error('SSE stream ended before receiving response'));
        }

        sseBuffer += decoder.decode(value, { stream: true });
        const { frames, tail } = drainSseFrames(sseBuffer);
        sseBuffer = tail;

        for (const frame of frames) {
          // Discover the POST endpoint
          if (isSseEndpointFrame(postUrl, frame)) {
            postUrl = resolveSsePostUrl(frame.data, sseUrl);
            if (!readyTimer) {
              readyTimer = setTimeout(sendRequest, 1500);
            }
          }

          // Connection established / Welcome message
          if (isSseReadyFrame(postUrl, requestSent, frame)) {
            if (readyTimer) clearTimeout(readyTimer);
            readyTimer = setTimeout(sendRequest, 1000);
          }

          // Match target response by ID
          const matched = matchSseRpcResponse(frame.data, targetId);
          if (matched) {
            done(matched, null);
          }
        }
      }
    } catch (err) {
      done(null, err);
    }
  });
}

// Map HTTP Content-Type to file extensions (includes SVG)
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
};

function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  // 127.0.0.0/8
  if (parts[0] === 127) return true;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8
  if (parts[0] === 0) return true;

  return false;
}

/**
 * Validates that a URL is safe to fetch (prevents SSRF).
 * Checks protocol, hostname, and forces IPv4 resolution to ensure no private IPs or IPv6 bypass.
 */
async function validateUrl(urlString) {
  try {
    const url = new URL(urlString);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }

    if (url.hostname === 'localhost') {
      throw new Error('Localhost access denied');
    }

    // Force IPv4 resolution to prevent IPv6 bypass and ensure consistent behavior
    const { address } = await lookup(url.hostname, { family: 4 });

    if (isPrivateIP(address)) {
      throw new Error(`Private IP access denied: ${address}`);
    }

    return true;
  } catch (error) {
    throw error;
  }
}

/**
 * Fetches image bytes from an external URL, following up to 5 redirects.
 * Handles both absolute and relative Location headers on redirects.
 * Returns { buffer, contentType }.
 */
async function fetchImage(url, redirectsLeft = 5) {
  // Validate URL to prevent SSRF
  await validateUrl(url);

  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    // Force IPv4 family to match validation logic (prevents DNS rebinding to IPv6)
    const req = lib.get(
      url,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 HybridCloudWorks-Bot/1.0' },
        family: 4,
      },
      (res) => {
        const { statusCode, headers } = res;

        if ([301, 302, 307, 308].includes(statusCode) && headers.location && redirectsLeft > 0) {
          res.resume(); // Drain the response so the connection is freed
          // Resolve relative Location headers against the original URL
          const nextUrl = headers.location.startsWith('http')
            ? headers.location
            : new URL(headers.location, url).href;
          return fetchImage(nextUrl, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} fetching ${url}`));
        }

        const rawType = headers['content-type'] || '';
        const contentType = rawType.split(';')[0].trim() || 'image/png';

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Request timed out fetching ${url}`));
    });
  });
}

/**
 * Returns true if the value is a plain external URL string (not already in
 * Firebase/GCS Storage and not a Rowy image object/array).
 */
function isExternalUrlString(val) {
  if (!val || typeof val !== 'string') return false;
  if (!val.startsWith('http')) return false;
  let host;
  try {
    host = new URL(val).hostname;
  } catch {
    return true;
  }
  if (
    host === 'firebasestorage.googleapis.com' ||
    host === 'storage.googleapis.com' ||
    host.endsWith('.firebasestorage.googleapis.com') ||
    host.endsWith('.storage.googleapis.com')
  )
    return false;
  return true;
}

/**
 * Uploads a buffer to Firebase Storage and returns the public download URL
 * plus the Rowy-compatible image array entry.
 */
async function uploadToStorage(buffer, contentType, storagePath, sourceUrl) {
  const file = admin.storage().bucket(BUCKET).file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { sourceUrl },
    },
  });

  const encodedPath = encodeURIComponent(storagePath);
  const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media`;
  const filename = storagePath.split('/').pop();

  return {
    downloadURL,
    rowyField: [
      { downloadURL, name: filename, type: contentType, size: buffer.length, ref: storagePath },
    ],
  };
}

// ============================================================================
// Speaking Events — download image from eventImageUrl → store in images field
// ============================================================================

/**
 * Firestore trigger: speakerevents/{eventId}
 *
 * When `eventImageUrl` is set or changed to an external URL, this function:
 *   1. Downloads the image (supports PNG, JPG, WebP, SVG, GIF, AVIF)
 *   2. Uploads to Firebase Storage: speakerevents/{eventId}/images/event-image.{ext}
 *      with the correct Content-Type (critical for SVG rendering)
 *   3. Updates the `images` field in Rowy-compatible array format
 *
 * Frontend reads `images[0].downloadURL` first, falling back to `eventImageUrl`.
 */
exports.downloadSpeakerEventImage = onDocumentWritten(
  { document: 'speakerevents/{eventId}', region: 'us-central1' },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const before = event.data?.before;
    const afterData = after.data();
    const beforeData = before?.exists ? before.data() : {};

    const newUrl = afterData.eventImageUrl;
    const oldUrl = beforeData.eventImageUrl;

    if (!newUrl || newUrl === oldUrl) return;
    if (!isExternalUrlString(newUrl)) return;

    const { eventId } = event.params;

    try {
      logger.info(`[speakerEventImage] Downloading for event ${eventId}: ${newUrl}`);

      const { buffer, contentType } = await fetchImage(newUrl);
      const ext = MIME_TO_EXT[contentType] ?? 'png';
      const storagePath = `speakerevents/${eventId}/images/event-image.${ext}`;

      const { rowyField, downloadURL } = await uploadToStorage(
        buffer,
        contentType,
        storagePath,
        newUrl
      );

      await admin
        .firestore()
        .collection('speakerevents')
        .doc(eventId)
        .update({ images: rowyField });

      logger.info(`[speakerEventImage] Stored image for event ${eventId}: ${downloadURL}`);
    } catch (err) {
      console.error(`[speakerEventImage] Failed for event ${eventId}:`, err.message);
    }
  }
);

// ============================================================================
// Certifications — download image from credentialImage URL → store in-place
// ============================================================================

/**
 * Firestore trigger: certifications/{certId}
 *
 * When `imageUrl` is set or changed to a plain external URL string,
 * this function mirrors the speaker-events image flow:
 *   1. Downloads the image from that URL (supports PNG, JPG, WebP, SVG, GIF, AVIF)
 *   2. Uploads to Firebase Storage: certifications/{certId}/images/badge-image.{ext}
 *      with the correct Content-Type (critical for SVG rendering)
 *   3. Updates the `image` field with the Rowy-compatible array format so it takes
 *      priority A over the plain `imageUrl` string in the frontend's resolveImageUrl()
 *
 * Infinite-loop prevention: updating `image` does not change `imageUrl`,
 * so the trigger only fires once per unique `imageUrl` value.
 */
exports.downloadCertBadgeImage = onDocumentWritten(
  { document: 'certifications/{certId}', region: 'us-central1' },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const before = event.data?.before;
    const afterData = after.data();
    const beforeData = before?.exists ? before.data() : {};

    const newUrl = afterData.imageUrl;
    const oldUrl = beforeData.imageUrl;

    // Only act when imageUrl is a new plain external URL string
    if (!isExternalUrlString(newUrl)) return;
    if (newUrl === oldUrl) return;

    const { certId } = event.params;

    try {
      logger.info(`[certBadgeImage] Downloading for cert ${certId}: ${newUrl}`);

      const { buffer, contentType } = await fetchImage(newUrl);
      const ext = MIME_TO_EXT[contentType] ?? 'png';
      const storagePath = `certifications/${certId}/images/badge-image.${ext}`;

      const { rowyField, downloadURL } = await uploadToStorage(
        buffer,
        contentType,
        storagePath,
        newUrl
      );

      // Write to `image` field (Rowy array format) — takes priority A over imageUrl string
      await admin.firestore().collection('certifications').doc(certId).update({
        image: rowyField,
      });

      logger.info(`[certBadgeImage] Stored badge for cert ${certId}: ${downloadURL}`);
    } catch (err) {
      console.error(`[certBadgeImage] Failed for cert ${certId}:`, err.message);
    }
  }
);

// ============================================================================
// News Pipeline — RSS Feed Fetcher (Scheduled every 2 hours)
// ============================================================================

/**
 * Provider RSS feed configuration.
 * Each provider has one or more official RSS/Atom feeds.
 */
const PROVIDER_FEEDS = {
  azure: [
    { name: 'Azure Blog', url: 'https://azure.microsoft.com/en-us/blog/feed/' },
    { name: 'Azure Updates', url: 'https://azurecomcdn.azureedge.net/en-us/updates/feed/' },
    { name: 'Microsoft Partner Blog', url: 'https://partner.microsoft.com/en-us/blog/feed/' },
    {
      name: 'Microsoft Azure Updates API',
      url: 'https://www.microsoft.com/releasecommunications/api/v2/azure/rss',
    },
    {
      name: 'Microsoft 365 Roadmap',
      url: 'https://www.microsoft.com/releasecommunications/api/v2/m365/rss',
    },
    {
      name: 'Azure Migration Blog',
      url: 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AzureMigrationBlog',
    },
    {
      name: 'Azure Arc Blog',
      url: 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AzureArcBlog',
    },
    {
      name: 'Microsoft Foundry Blog',
      url: 'https://devblogs.microsoft.com/foundry/feed/',
    },
    {
      name: 'Azure Stackfeed',
      url: 'https://stackfeed.io/feed?provider=azure',
    },
    {
      name: 'Microsoft Learn Skills Hub',
      url: 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=skills-hub-blog',
    },
  ],
  aws: [
    { name: 'AWS Blog', url: 'https://aws.amazon.com/blogs/aws/feed/' },
    { name: 'AWS Whats New', url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/' },
    { name: 'AWS APN Partner Network', url: 'https://aws.amazon.com/blogs/apn/feed/' },
    { name: 'AWS Stackfeed', url: 'https://stackfeed.io/feed?provider=aws' },
  ],
  gcp: [
    { name: 'Google Cloud Blog', url: 'https://cloud.google.com/blog/feed' },
    { name: 'GCP Release Notes', url: 'https://cloud.google.com/feeds/gcp-release-notes.xml' },
    { name: 'Google Cloud Partners', url: 'https://cloud.google.com/blog/topics/partners/feed' },
    { name: 'GCP Stackfeed', url: 'https://stackfeed.io/feed?provider=gcp' },
  ],
  github: [
    { name: 'GitHub Blog', url: 'https://github.blog/feed/' },
    { name: 'GitHub Changelog', url: 'https://github.blog/changelog/feed/' },
    { name: 'GitHub Developer Skills', url: 'https://github.blog/developer-skills/github/feed/' },
    { name: 'GitHub Copilot', url: 'https://github.blog/ai-and-ml/github-copilot/feed/' },
  ],
  terraform: [
    { name: 'HashiCorp Blog', url: 'https://www.hashicorp.com/blog/feed.xml' },
    // TF Weekly (weekly.tf) has no RSS feed — scraped via Firecrawl in BLOG_SCRAPE_SOURCES
  ],
  finops: [{ name: 'FinOps Foundation', url: 'https://www.finops.org/feed/' }],
};

/**
 * Strip HTML tags, applying the removal repeatedly until the string is stable.
 * A single pass of `<[^>]*>` is incomplete: overlapping constructs such as
 * `<scr<script>ipt>` would leave a live tag behind. Looping to a fixed point
 * removes those residues.
 */
function stripHtmlTags(text) {
  let prev;
  let out = String(text);
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== prev);
  return out;
}

/**
 * Truncate text to a max length, preserving word boundaries.
 */
function truncateText(text, maxLength = 200) {
  if (!text) return '';
  const cleaned = stripHtmlTags(text).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.substring(0, maxLength).replace(/\s\S*$/, '')}...`;
}

/**
 * Estimate read time from content length.
 */
function estimateReadTime(content) {
  if (!content) return '3 min';
  const wordCount = stripHtmlTags(content).split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(wordCount / 200));
  return `${minutes} min`;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Generate a URL-safe slug from a title.
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60);
}

const CATEGORY_MATCHERS = [
  {
    category: 'Security',
    terms: ['security', 'vulnerability', 'compliance'],
  },
  {
    category: 'AI/ML',
    terms: ['ai', 'machine learning', 'openai', 'copilot'],
  },
  {
    category: 'Containers',
    terms: ['kubernetes', 'container', 'docker', 'aks', 'eks', 'gke'],
  },
  {
    category: 'Serverless',
    terms: ['serverless', 'lambda', 'functions'],
  },
  {
    category: 'Database',
    terms: ['database', 'sql', 'cosmos', 'dynamo'],
  },
  {
    category: 'Networking',
    terms: ['network', 'vpc', 'cdn', 'dns'],
  },
  {
    category: 'Cost',
    terms: ['cost', 'pricing', 'finops', 'budget'],
  },
  {
    category: 'DevOps',
    terms: ['devops', 'ci/cd', 'pipeline', 'deploy'],
  },
  {
    category: 'Preview',
    terms: ['preview', 'beta'],
  },
  {
    category: 'GA',
    terms: ['generally available', 'ga '],
  },
];

/**
 * Categorize an RSS item based on its title/content/categories.
 */
function categorizeItem(item) {
  const text =
    `${item.title || ''} ${item.contentSnippet || ''} ${(item.categories || []).join(' ')}`.toLowerCase();

  const matched = CATEGORY_MATCHERS.find(({ terms }) => terms.some((term) => text.includes(term)));
  if (matched) {
    return matched.category;
  }
  return 'Update';
}

async function cacheFeedItems(db, provider, feed, cacheItems) {
  const cacheDocId = `${provider}_${feed.name.toLowerCase().replace(/\s+/g, '_')}`;
  await db.collection('rss_cache').doc(cacheDocId).set({
    provider,
    feedUrl: feed.url,
    feedName: feed.name,
    items: cacheItems,
    lastFetched: admin.firestore.FieldValue.serverTimestamp(),
    itemCount: cacheItems.length,
  });
}

// Build the Firestore content doc for an RSS-ingested item. Pure function,
// no I/O — extracted from upsertRssItemsAsBlogs to keep that loop simple.
function buildRssContentDoc({ item, sourceUrl, title, summary, provider, feed, dedupFields }) {
  const sts = admin.firestore.FieldValue.serverTimestamp();
  const publishedAtField = item.isoDate ? new Date(item.isoDate) : sts;
  const bodyText = item.content || item.contentSnippet || '';
  return {
    ...dedupFields,
    'Created At': sts,
    Author: item.creator || item.author || feed.name,
    'Cloud Provider': provider.charAt(0).toUpperCase() + provider.slice(1),
    Title: title,
    Content: bodyText,
    'CD Url': sourceUrl,
    Summary: summary,
    Slug: generateSlug(title),
    Live: false,
    'Published At': publishedAtField,
    Status: 'Draft',
    Tags: item.categories || [],
    source: 'rss',
    sourceTrustLevel: 'trusted',
    trustedSource: true,
    sourceUrl,
    sourceFeed: feed.url,
    storageCollection: 'content',
    category: categorizeItem(item),
    approvedForNews: false,
    approvedForBlog: false,
    contentStatus: 'ingested',
    inspectTrigger: true,
    aiSummary: '',
    aiTags: [],
    readTime: estimateReadTime(bodyText),
    contentImageUrl: item.enclosure?.url || '',
    fetchedAt: sts,
  };
}

async function upsertRssItemsAsBlogs(db, provider, feed, items, results) {
  const cmsFunctions = require('./cms-functions');
  for (const item of items.slice(0, 10)) {
    const sourceUrl = item.link || '';
    if (!sourceUrl) continue;

    const title = item.title || 'Untitled';
    const publishedDate = item.isoDate ? new Date(item.isoDate) : null;
    const dup = await cmsFunctions.findDuplicateContent(db, {
      url: sourceUrl,
      title,
      publishedMs: publishedDate ? publishedDate.getTime() : Date.now(),
    });
    if (dup.duplicate) continue;

    const summary = truncateText(item.contentSnippet || item.content || '', 300);
    const dedupFields = cmsFunctions.buildDedupFields({ url: sourceUrl, title });

    await db
      .collection('content')
      .add(buildRssContentDoc({ item, sourceUrl, title, summary, provider, feed, dedupFields }));
    results.newContent++;
  }
}

async function processSingleFeed(db, parser, provider, feed, results) {
  logger.info(`[rssFetcher] Fetching ${feed.name} (${provider}): ${feed.url}`);

  let parsed;
  try {
    parsed = await parser.parseURL(feed.url);
  } catch (err) {
    // Refuse to silently bypass TLS validation. If a feed presents an invalid or
    // expired certificate, skip it and surface the error so the source can be
    // fixed or removed (OWASP A02 — Cryptographic Failures).
    if (err.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || err.code === 'CERT_HAS_EXPIRED') {
      logger.error(
        `[rssFetcher] TLS validation failed for ${feed.name} (${err.code}) — skipping feed.`
      );
      results.errors.push(`${provider}/${feed.name}: TLS validation failed (${err.code})`);
      return;
    }
    throw err;
  }

  const items = (parsed.items || []).slice(0, 20);

  const cacheItems = items.map((item) => ({
    title: item.title || 'Untitled',
    link: item.link || '',
    pubDate: item.pubDate || item.isoDate || '',
    summary: truncateText(item.contentSnippet || item.content || ''),
    category: categorizeItem(item),
    author: item.creator || item.author || feed.name,
  }));

  await cacheFeedItems(db, provider, feed, cacheItems);
  results.cached++;
  await upsertRssItemsAsBlogs(db, provider, feed, items, results);
  results.processed++;
  logger.info(`[rssFetcher] ${feed.name}: cached ${cacheItems.length} items`);
}

/**
 * Core RSS fetching logic — shared between scheduled and HTTP triggers.
 * Fetches all provider feeds, caches to rss_cache, and creates new blog entries.
 */
async function processRssFeeds() {
  const db = admin.firestore();

  // Create HTTPS agent that handles Microsoft Partner Blog's SSL cert issue
  const httpsAgent = new https.Agent({
    rejectUnauthorized: true, // Default strict validation
  });

  const parser = new RssParser({
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 HybridCloudWorks-Bot/1.0' },
    requestOptions: {
      agent: httpsAgent,
    },
    // Custom request function to handle SSL issues per-feed
    customFields: {
      item: [
        ['content:encoded', 'contentFull'],
        ['media:content', 'mediaContent'],
      ],
    },
  });

  const results = { processed: 0, cached: 0, newBlogs: 0, newContent: 0, errors: [] };

  for (const [provider, feeds] of Object.entries(PROVIDER_FEEDS)) {
    for (const feed of feeds) {
      try {
        await processSingleFeed(db, parser, provider, feed, results);
      } catch (err) {
        console.error(`[rssFetcher] Failed ${feed.name} (${provider}):`, err.message);
        results.errors.push(`${provider}/${feed.name}: ${err.message}`);
      }
    }
  }

  logger.info(
    `[rssFetcher] Complete: ${results.processed} feeds, ${results.cached} cached, ${results.newBlogs} new blogs, ${results.errors.length} errors`
  );
  return results;
}

async function generateReviewerDigestSnapshot() {
  const db = admin.firestore();
  const now = new Date();
  const digestDate = now.toISOString().slice(0, 10);

  const statusesToReview = ['ingested', 'inspected', 'in_review', 'approved_blog'];
  const queueByStatus = {};
  let totalQueued = 0;

  for (const status of statusesToReview) {
    const snapshot = await db
      .collection('content')
      .where('contentStatus', '==', status)
      .limit(200)
      .get();
    queueByStatus[status] = snapshot.size;
    totalQueued += snapshot.size;
  }

  const recentSnapshot = await db
    .collection('content')
    .where('source', '==', 'rss')
    .limit(200)
    .get();

  const recentDocs = [...recentSnapshot.docs]
    .sort((a, b) => toMillis(b.data()?.fetchedAt) - toMillis(a.data()?.fetchedAt))
    .slice(0, 30);

  const byProvider = {};
  const topItems = [];
  for (const docSnap of recentDocs) {
    const data = docSnap.data();
    const provider = data.cloudProvider || data['Cloud Provider'] || 'Unknown';
    byProvider[provider] = (byProvider[provider] || 0) + 1;

    if (topItems.length < 10) {
      topItems.push({
        id: docSnap.id,
        title: data.Title || data.title || 'Untitled',
        provider,
        status: data.contentStatus || 'ingested',
        sourceFeed: data.sourceFeed || '',
        sourceUrl: data.sourceUrl || '',
      });
    }
  }

  const payload = {
    digestDate,
    generatedBy: 'scheduler',
    queueByStatus,
    totalQueued,
    recentRssCount: recentDocs.length,
    byProvider,
    topItems,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('workflow_digests').doc(digestDate).set(payload, { merge: true });

  logger.info(
    `[reviewerDigest] Generated ${digestDate}: queued=${totalQueued}, recentRss=${recentDocs.length}`
  );

  return {
    success: true,
    digestDate,
    totalQueued,
    recentRssCount: recentDocs.length,
    queueByStatus,
  };
}

/**
 * Scheduled function: Runs every 2 hours to fetch RSS feeds from all providers,
 * cache them in rss_cache collection, and create new blog entries for curation.
 */
exports.fetchRssFeeds = onSchedule(
  {
    schedule: 'every 2 hours',
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    await processRssFeeds();
  }
);

/**
 * HTTP trigger: Manual RSS fetch for testing/on-demand use.
 * Call via: https://{region}-{project}.cloudfunctions.net/fetchRssFeedsManual
 */
exports.fetchRssFeedsManual = onRequest(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'POST only' });
    }
    // OWASP A01 — require a verified admin claim before triggering a write path.
    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    try {
      const results = await processRssFeeds();
      res.json({ success: true, ...results });
    } catch (err) {
      console.error('[rssFetcher] Manual trigger failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

exports.generateReviewerDigest = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    timeoutSeconds: 180,
    memory: '256MiB',
  },
  async () => {
    await generateReviewerDigestSnapshot();
  }
);

exports.generateReviewerDigestManual = onRequest(
  { region: 'us-central1', timeoutSeconds: 180, memory: '256MiB' },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'POST only' });
    }
    // OWASP A01 — require a verified admin claim before triggering a write path.
    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    try {
      const results = await generateReviewerDigestSnapshot();
      res.json(results);
    } catch (err) {
      logger.error('[reviewerDigest] Manual trigger failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ============================================================================
// Blog Cover Image Generator — auto-generate branded template images
// ============================================================================

/**
 * Provider branding for generated cover images.
 */
const PROVIDER_BRANDING = {
  Azure: { primary: '#00a4ef', dark: '#0f2942', accent: '#0078D4', label: 'AZURE' },
  Aws: { primary: '#ff9900', dark: '#232f3e', accent: '#FF9900', label: 'AWS' },
  Gcp: { primary: '#4285f4', dark: '#202124', accent: '#4285F4', label: 'GCP' },
  Github: { primary: '#6e7681', dark: '#1c2128', accent: '#3d444d', label: 'GITHUB' },
  Terraform: { primary: '#7B42BC', dark: '#2d1e3d', accent: '#4040b2', label: 'TERRAFORM' },
  Finops: { primary: '#1ea482', dark: '#064e3b', accent: '#1ea482', label: 'FINOPS' },
};

/**
 * Category accent colors for badges on generated covers.
 */
const CATEGORY_BADGE_COLORS = {
  'AI/ML': '#a855f7',
  Security: '#f43f5e',
  Containers: '#f97316',
  Serverless: '#f59e0b',
  Database: '#06b6d4',
  Networking: '#14b8a6',
  Cost: '#10b981',
  DevOps: '#6366f1',
  GA: '#22c55e',
  Preview: '#f59e0b',
  Update: '#64748b',
};

/**
 * Wrap title text into lines that fit within a max character width.
 * Returns an array of lines (max 3).
 */
function wrapText(text, maxCharsPerLine = 35) {
  if (!text) return ['Untitled'];
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (lines.length >= 3) break;
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine && lines.length < 3) {
    // If there are more words remaining, add ellipsis
    if (words.length > currentLine.split(/\s+/).length + lines.join(' ').split(/\s+/).length) {
      lines.push(`${currentLine}...`);
    } else {
      lines.push(currentLine);
    }
  }
  return lines.length > 0 ? lines : ['Untitled'];
}

/**
 * Escape text for safe SVG embedding.
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build an SVG string for a blog cover image.
 * Produces a 1200x630 OG-image-sized branded card.
 */
function buildCoverSvg(provider, title, category) {
  const branding = PROVIDER_BRANDING[provider] || PROVIDER_BRANDING.Azure;
  const badgeColor = CATEGORY_BADGE_COLORS[category] || '#64748b';
  const titleLines = wrapText(title, 32);

  // Title text y-positions (centered vertically in the main area)
  const titleStartY = 280;
  const lineHeight = 52;

  // Build grid pattern dots
  let dots = '';
  for (let x = 0; x < 1200; x += 40) {
    for (let y = 0; y < 630; y += 40) {
      dots += `<circle cx="${x}" cy="${y}" r="1" fill="white" opacity="0.04"/>`;
    }
  }

  // Build title text elements
  const titleElements = titleLines
    .map(
      (line, i) =>
        `<text x="80" y="${titleStartY + i * lineHeight}" fill="white" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="40" font-weight="700" letter-spacing="-0.5">${escapeXml(line)}</text>`
    )
    .join('\n    ');

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background gradient -->
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${branding.dark}"/>
      <stop offset="60%" stop-color="${branding.dark}"/>
      <stop offset="100%" stop-color="${branding.accent}"/>
    </linearGradient>
    <!-- Accent glow -->
    <radialGradient id="glow" cx="85%" cy="80%" r="50%">
      <stop offset="0%" stop-color="${branding.primary}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${branding.primary}" stop-opacity="0"/>
    </radialGradient>
    <!-- Top accent line gradient -->
    <linearGradient id="topline" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${branding.primary}"/>
      <stop offset="50%" stop-color="${branding.accent}"/>
      <stop offset="100%" stop-color="${branding.primary}" stop-opacity="0.3"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Subtle dot grid pattern -->
  ${dots}

  <!-- Top accent bar -->
  <rect x="0" y="0" width="1200" height="4" fill="url(#topline)"/>

  <!-- Provider label (large watermark, bottom-right) -->
  <text x="1120" y="580" fill="${branding.primary}" opacity="0.08" font-family="'Segoe UI', Arial, sans-serif" font-size="120" font-weight="900" text-anchor="end" letter-spacing="6">${branding.label}</text>

  <!-- Category badge -->
  <rect x="80" y="60" width="${Math.max(category.length * 12 + 28, 80)}" height="32" rx="16" fill="${badgeColor}" opacity="0.9"/>
  <text x="${80 + Math.max(category.length * 12 + 28, 80) / 2}" y="82" fill="white" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle" letter-spacing="1.5">${escapeXml(category.toUpperCase())}</text>

  <!-- Provider icon accent (geometric shape) -->
  <rect x="80" y="130" width="48" height="48" rx="12" fill="${branding.primary}" opacity="0.15"/>
  <rect x="88" y="138" width="32" height="32" rx="8" fill="${branding.primary}" opacity="0.3"/>

  <!-- Provider name -->
  <text x="145" y="163" fill="${branding.primary}" font-family="'Segoe UI', Arial, sans-serif" font-size="16" font-weight="600" letter-spacing="2" opacity="0.7">${branding.label} PLATFORM</text>

  <!-- Divider line -->
  <line x1="80" y1="210" x2="400" y2="210" stroke="${branding.primary}" stroke-opacity="0.2" stroke-width="1"/>

  <!-- Article title -->
  ${titleElements}

  <!-- Bottom section -->
  <!-- HCW branding -->
  <text x="80" y="570" fill="white" opacity="0.4" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="600" letter-spacing="2">HYBRIDCLOUDWORKS</text>
  <text x="80" y="590" fill="white" opacity="0.25" font-family="'Segoe UI', Arial, sans-serif" font-size="11" letter-spacing="1">CLOUD ARCHITECTURE &amp; ENGINEERING</text>

  <!-- Decorative corner accent -->
  <rect x="1150" y="0" width="50" height="630" fill="${branding.primary}" opacity="0.05"/>
  <rect x="1170" y="0" width="30" height="630" fill="${branding.primary}" opacity="0.08"/>
</svg>`;
}

// ============================================================================
// Blog Cover Image Downloader — download from contentImageUrl → Cover Image
// ============================================================================

/**
 * Firestore trigger: blogs/{blogId}
 *
 * When `contentImageUrl` is set or changed to an external URL, this function:
 *   1. Downloads the image
 *   2. Uploads to Firebase Storage: blogs/{blogId}/images/cover.{ext}
 *   3. Updates the `Cover Image` field with Rowy-compatible array format
 *
 * Infinite-loop prevention: updating `Cover Image` does not change `contentImageUrl`.
 */
exports.downloadBlogCoverImage = onDocumentWritten(
  { document: 'blogs/{blogId}', region: 'us-central1' },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const before = event.data?.before;
    const afterData = after.data();
    const beforeData = before?.exists ? before.data() : {};

    const newUrl = afterData.contentImageUrl;
    const oldUrl = beforeData.contentImageUrl;

    if (!isExternalUrlString(newUrl)) return;
    if (newUrl === oldUrl) return;

    const { blogId } = event.params;

    try {
      logger.info(`[blogCoverImage] Downloading for blog ${blogId}: ${newUrl}`);

      const { buffer, contentType } = await fetchImage(newUrl);
      const ext = MIME_TO_EXT[contentType] ?? 'png';
      const storagePath = `blogs/${blogId}/images/cover.${ext}`;

      const { rowyField, downloadURL } = await uploadToStorage(
        buffer,
        contentType,
        storagePath,
        newUrl
      );

      await admin.firestore().collection('blogs').doc(blogId).update({
        'Cover Image': rowyField,
      });

      logger.info(`[blogCoverImage] Stored cover for blog ${blogId}: ${downloadURL}`);
    } catch (err) {
      console.error(`[blogCoverImage] Failed for blog ${blogId}:`, err.message);
    }
  }
);

// ============================================================================
// Blog Cover Image Generator — auto-generate branded template for articles
// without an external image source
// ============================================================================

/**
 * Firestore trigger: blogs/{blogId}
 *
 * When a blog document has a Title but NO cover image and NO contentImageUrl,
 * this function generates a branded template image using the provider's colors:
 *   1. Builds an SVG template with provider branding, title text, and category badge
 *   2. Renders SVG → PNG using sharp
 *   3. Uploads to Firebase Storage: blogs/{blogId}/images/generated-cover.png
 *   4. Updates `Cover Image` field + sets `generatedCover: true`
 *
 * Priority: downloadBlogCoverImage handles articles WITH contentImageUrl.
 *           This function handles articles WITHOUT any image source.
 *
 * Infinite-loop prevention:
 *   - Skips if `Cover Image` already exists
 *   - Skips if `generatedCover` is already true
 *   - Skips if `contentImageUrl` exists (let downloadBlogCoverImage handle it)
 */
exports.generateBlogCoverImage = onDocumentWritten(
  { document: 'blogs/{blogId}', region: 'us-central1', memory: '512MiB' },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const afterData = after.data();

    // Skip if no title (nothing to render)
    const title = afterData.Title || afterData.title;
    if (!title) return;

    // Skip if contentImageUrl exists — downloadBlogCoverImage will handle it
    if (afterData.contentImageUrl && afterData.contentImageUrl.startsWith('http')) return;

    // Skip if Cover Image already exists
    const coverImage = afterData['Cover Image'];
    if (Array.isArray(coverImage) && coverImage.length > 0) return;
    if (coverImage && typeof coverImage === 'object' && coverImage.downloadURL) return;

    // Skip if we already generated a cover (prevent re-trigger loop)
    if (afterData.generatedCover === true) return;

    const { blogId } = event.params;
    const provider = afterData['Cloud Provider'] || 'Azure';
    const category = afterData.category || 'Update';

    try {
      logger.info(`[generateCover] Generating template cover for blog ${blogId}: "${title}"`);

      // Build SVG and render to PNG
      const svgString = buildCoverSvg(provider, title, category);
      const pngBuffer = await sharp(Buffer.from(svgString)).png({ quality: 90 }).toBuffer();

      const storagePath = `blogs/${blogId}/images/generated-cover.png`;
      const { rowyField, downloadURL } = await uploadToStorage(
        pngBuffer,
        'image/png',
        storagePath,
        'generated'
      );

      // Write Cover Image + generatedCover flag
      await admin.firestore().collection('blogs').doc(blogId).update({
        'Cover Image': rowyField,
        generatedCover: true,
      });

      logger.info(`[generateCover] Generated cover for blog ${blogId}: ${downloadURL}`);
    } catch (err) {
      console.error(`[generateCover] Failed for blog ${blogId}:`, err.message);
    }
  }
);

// ==============================================================================
// CONTENT INSPECTION & POPULATION (AXIOS + GEMINI — ALL GOOGLE, ZERO API KEYS)
// ==============================================================================

// ----- scrapeArticle helpers -----

// Try the r.jina.ai reader as a last-resort scraper. Returns a result object
// matching scrapeArticle's contract on success, or null when the fallback is
// either disabled or didn't produce enough text.
async function tryReaderFallback(url, startedAt) {
  const fallbackEnabled = String(process.env.CONTENTFORGE_SCRAPE_FALLBACK_ENABLED || 'false')
    .toLowerCase()
    .trim();
  if (fallbackEnabled !== 'true') return null;
  try {
    const normalized = String(url).replace(/^https?:\/\//i, '');
    const fallbackUrl = `https://r.jina.ai/http://${normalized}`;
    logger.info('[scraper] Trying reader fallback:', fallbackUrl);
    const fallbackResponse = await axios.get(fallbackUrl, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HCW-Bot/1.0)' },
    });
    const fallbackText = String(fallbackResponse.data || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (fallbackText.length <= 400) return null;
    logger.info(`[scraper] ✅ Reader fallback succeeded (${fallbackText.length} chars)`);
    return {
      success: true,
      markdown: fallbackText.slice(0, 24000),
      html: '',
      plainText: fallbackText.slice(0, 24000),
      images: [],
      wordCount: fallbackText.split(/\s+/).length,
      error: null,
      scrapeMode: 'reader_fallback',
      scrapeLatencyMs: Date.now() - startedAt,
      scrapeFailureReason: null,
    };
  } catch (fallbackErr) {
    logger.warn(`[scraper] Reader fallback failed: ${fallbackErr.message}`);
    return null;
  }
}

// Try a configured headless-browser endpoint. Returns a result object on
// success or null when disabled / endpoint unset / response too thin.
async function tryHeadlessFallback(url, startedAt) {
  const headlessEnabled = String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_ENABLED || 'false')
    .toLowerCase()
    .trim();
  const headlessEndpoint = String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_URL || '').trim();
  if (headlessEnabled !== 'true' || !headlessEndpoint) return null;
  try {
    logger.info('[scraper] Trying headless fallback:', headlessEndpoint);
    const headlessResponse = await axios.post(
      headlessEndpoint,
      { url, timeoutMs: 30000, userAgent: 'Mozilla/5.0 (compatible; HCW-Bot/1.0)' },
      { timeout: 45000, headers: { 'Content-Type': 'application/json' } }
    );
    const payload = headlessResponse.data || {};
    const plainText = String(payload.plainText || payload.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    const markdown = String(payload.markdown || plainText).trim();
    const html = String(payload.html || '');
    const images = Array.isArray(payload.images) ? payload.images : [];
    if (markdown.length <= 400 && plainText.length <= 400) return null;
    logger.info(
      `[scraper] ✅ Headless fallback succeeded (${Math.max(markdown.length, plainText.length)} chars)`
    );
    return {
      success: true,
      markdown: markdown.slice(0, 24000),
      html: html.slice(0, 24000),
      plainText: plainText.slice(0, 24000),
      images: images.slice(0, 20),
      wordCount: plainText.split(/\s+/).length,
      error: null,
      scrapeMode: 'headless_fallback',
      scrapeLatencyMs: Date.now() - startedAt,
      scrapeFailureReason: null,
    };
  } catch (headlessErr) {
    logger.warn(`[scraper] Headless fallback failed: ${headlessErr.message}`);
    return null;
  }
}

/**
 * Scrape article content using Axios + Cheerio (simple, no paid API needed)
 * Returns: { success, markdown, html, plainText, images[], wordCount, error }
 */
async function scrapeArticle(url) {
  logger.info('[scraper] Fetching:', url);
  const startedAt = Date.now();

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 30000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    // 🔍 Keep FULL HTML for date extraction (meta tags, JSON-LD are in head)
    const fullHtml = response.data;

    // Strip noise (for content extraction only, not affecting metadata extraction)
    $(
      'script, style, nav, header, footer, aside, iframe, .advertisement, .ad, .cookie-banner, .sidebar, .related-posts, .comments, .social-share, .newsletter-signup'
    ).remove();

    // Find best content block
    const selectors = [
      '.markdown-body',
      '.post-content',
      '.blog-post-content',
      '.article-body',
      'article',
      'main article',
      '[role="main"]',
      '.article-content',
      '.entry-content',
      '.content-body',
      'main',
      '#content',
      '.content',
    ];

    let articleHtml = null;
    let contentText = '';

    for (const sel of selectors) {
      const elem = $(sel);
      if (elem.length) {
        const text = elem.text().trim();
        if (text.length > contentText.length && text.length > 200) {
          articleHtml = elem.html();
          contentText = text;
        }
      }
    }

    if (!articleHtml || contentText.length < 500) {
      articleHtml = $('body').html();
      contentText = $('body').text().trim();
    }

    // Extract images
    const images = [];
    $('img').each((i, elem) => {
      let src = $(elem).attr('src');
      const alt = $(elem).attr('alt') || '';
      if (src && !src.startsWith('http')) {
        const u = new URL(url);
        if (src.startsWith('//')) {
          src = u.protocol + src;
        } else if (src.startsWith('/')) {
          src = u.origin + src;
        } else {
          src = `${u.origin}/${src}`;
        }
      }
      if (src && src.startsWith('http')) {
        images.push({ url: src, alt, index: i });
      }
    });

    // HTML → Markdown
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const markdown = turndown.turndown(articleHtml);

    logger.info(`[scraper] ✅ ${markdown.length} chars markdown, ${images.length} images`);

    return {
      success: true,
      markdown,
      html: fullHtml, // ← Pass FULL HTML (with head/meta tags) for date extraction
      plainText: contentText,
      images,
      wordCount: contentText.split(/\s+/).length,
      error: null,
      scrapeMode: 'direct_html',
      scrapeLatencyMs: Date.now() - startedAt,
      scrapeFailureReason: null,
    };
  } catch (err) {
    console.error(`[scraper] ❌ Direct scrape failed: ${err.message}`);

    const readerResult = await tryReaderFallback(url, startedAt);
    if (readerResult) return readerResult;

    const headlessResult = await tryHeadlessFallback(url, startedAt);
    if (headlessResult) return headlessResult;

    return {
      success: false,
      markdown: null,
      html: null,
      plainText: null,
      images: [],
      wordCount: 0,
      error: err.message,
      scrapeMode: 'failed',
      scrapeLatencyMs: Date.now() - startedAt,
      scrapeFailureReason: err.message,
    };
  }
}

/**
 * Download image and store in Firebase Storage
 * Returns public URL or null on failure
 */
async function downloadAndStoreImage(imageUrl, blogId, imageIndex) {
  try {
    const imageBuffer = await downloadImageFromUrl(imageUrl);
    const bucket = admin.storage().bucket(BUCKET);

    // Determine extension from URL or default to jpg
    const urlExt = imageUrl.split('.').pop().split('?')[0].toLowerCase();
    const ext = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(urlExt) ? urlExt : 'jpg';

    const filename = `articles/${blogId}/image-${imageIndex}.${ext}`;
    const file = bucket.file(filename);

    await file.save(imageBuffer, {
      metadata: {
        contentType: `image/${ext === 'svg' ? 'svg+xml' : ext}`,
        metadata: {
          firebaseStorageDownloadTokens: crypto.randomUUID(),
          sourceUrl: imageUrl,
        },
      },
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${BUCKET}/${filename}`;

    logger.info(`[scraper] Stored image ${imageIndex}: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    logger.warn(`[scraper] Failed to store image ${imageIndex}: ${error.message}`);
    return null;
  }
}

/**
 * Generate URL-safe slug from title
 * Example: "How to Build Apps" → "how-to-build-apps"
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .slice(0, 80); // Limit length
}

/**
 * Extract published date from article HTML (DATE ONLY, no time)
 * Looks for: schema.org Article.datePublished, og:published_time, article:published_time, etc.
 * Returns date at 00:00:00 UTC (strips time component)
 */
function extractPublishedDate(html, _plainText) {
  if (!html) return null;

  const $ = cheerio.load(html);
  let bestDate = null;

  // Try structured data (JSON-LD)
  const jsonLd = $('script[type="application/ld+json"]').first().text();
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd);
      if (data.datePublished) {
        const date = new Date(data.datePublished);
        if (!isNaN(date)) {
          bestDate = date;
        }
      }
    } catch {
      // Continue to next method
    }
  }

  // Try meta tags
  const metaTags = [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="published"]',
    'meta[name="DC.date"]',
    'meta[name="publish_date"]',
    'meta[name="published_date"]',
    'meta[itemprop="datePublished"]',
  ];

  for (const tag of metaTags) {
    const dateStr = $(tag).attr('content');
    if (dateStr && dateStr.trim()) {
      const date = new Date(dateStr.trim());
      if (!isNaN(date)) {
        bestDate = date;
        break; // Use first valid date found
      }
    }
  }

  // Try time/datetime elements
  if (!bestDate) {
    const timeElem = $('time').first().attr('datetime');
    if (timeElem && timeElem.trim()) {
      const date = new Date(timeElem.trim());
      if (!isNaN(date)) {
        bestDate = date;
      }
    }
  }

  // Return date at midnight UTC (strips time component)
  if (bestDate) {
    return new Date(
      Date.UTC(bestDate.getUTCFullYear(), bestDate.getUTCMonth(), bestDate.getUTCDate())
    );
  }

  return null;
}

/**
 * Analyze article content with the configured AI provider.
 * Provider is selected via CONTENTFORGE_AI_PROVIDER (vertex|openai|anthropic).
 */
// R5: static system prompt for article analysis — extracted from the user
// message so it can be cached by Anthropic (cache_control) and used as
// systemInstruction on Vertex. Must stay ≥1,024 tokens for Anthropic caching.
const ANALYSIS_SYSTEM_PROMPT = `You are a technical content analyst for Hybrid Cloud Works (HCW), a publication targeting senior cloud practitioners — architects, DevOps leads, FinOps analysts, and platform engineers — at enterprises operating multi-cloud or hybrid environments. Every article you produce must be technical, concrete, and actionable. Do not write introductory-level content.

Output schema (return ONLY valid JSON, no markdown fences, no prose):
{
  "title": "Article headline, max 100 chars. Be specific and search-optimised: prefer 'How to Optimize EKS Node Groups for Cost' over 'AWS Kubernetes Cost Tips'. Include the primary technology and action or outcome.",
  "summary": "Detailed overview, minimum 5-6 sentences (~600 characters). Identify: (1) the specific problem or trend the article addresses, (2) the primary technology or service discussed, (3) the key insight or takeaway, (4) who this is most relevant for, and (5) any important caveats or prerequisites. Do NOT repeat the title verbatim. Do NOT end with ellipsis (...).",
  "cloudProvider": "Primary cloud provider. MUST be exactly one of: Azure, AWS, GCP, GitHub, Terraform, FinOps, Multi. Use 'Multi' only when the article explicitly compares two or more providers with roughly equal coverage. If primarily AWS but mentions Azure once, it is 'AWS'. GitHub Actions, Copilot, and GitHub-native CI/CD are 'GitHub'. Pulumi and CDK are 'Terraform' (IaC category).",
  "keyTopics": ["Array of 3-5 specific technology tags. Use precise names: 'AWS EKS' not 'Kubernetes'; 'Azure Cost Management' not 'cloud cost'; 'Terraform modules' not 'IaC'. Each tag should be independently searchable and usable as an article label."],
  "targetAudience": "Primary reader persona. MUST be exactly one of: Cloud Architect, DevOps Engineer, FinOps Analyst, Platform Engineer, Developer.",
  "visualTheme": "Describe a specific, concrete Lego-character scene in 20-30 words for the cover image. Good: 'A Lego cloud architect connecting modular database and compute blocks on a rack server with AWS orange accents'. Bad: 'cloud infrastructure concepts'. The description drives the image generation prompt, so specificity directly improves output quality.",
  "postContent": "A comprehensive technical blog post, 1,200-1,500 words, formatted in clean Markdown. Structure: (1) open with the problem or context — not background history; (2) use ## for major sections, ### for subsections; (3) include at least one code block, CLI example, or config snippet where relevant to the topic; (4) close with a concrete 'Key Takeaways' or 'Next Steps' section. Do NOT pad with generic cloud explanations. Write as if the reader is already a practitioner."
}

Classification rules:
- cloudProvider: see schema above. When in doubt between two providers, pick the one with more service-specific mentions.
- keyTopics: avoid generic terms. 'Cost optimisation' is too broad; 'Reserved Instances rightsizing' is correct. Cap at 5 topics.
- targetAudience: pick the role that benefits most from the article's primary action or insight, not the broadest possible audience.
- postContent: must be ready-to-publish Markdown with no placeholder text, no [INSERT X HERE] markers, and no incomplete sections.`;

async function analyzeWithGemini(url, markdownContent) {
  // R8: when CONTENTFORGE_METADATA_ONLY=true, skip postContent generation at
  // ingest time. postContent is deferred to generatePostContent() which fires
  // on manual editor trigger or at publish time. This aligns with the
  // "draft vs published" cost rubric and saves ~2K output tokens per ingest.
  const metadataOnly = process.env.CONTENTFORGE_METADATA_ONLY === 'true';

  const schemaForMode = metadataOnly
    ? `Extract the following fields and return ONLY valid JSON:
title, summary, cloudProvider, keyTopics, targetAudience, visualTheme.
Do NOT include a postContent field.`
    : `Extract all fields including postContent and return ONLY valid JSON.`;

  const analysisPrompt = `${schemaForMode}

Article URL: ${url}
Article Content:
${markdownContent.substring(0, 15000)}`;

  const aiProvider = getActiveAiProvider();
  const modelOverride = process.env.CONTENTFORGE_ANALYSIS_MODEL || null;

  logger.info(`[ai-model] Sending article analysis request via ${aiProvider}`, { metadataOnly });

  const metadata = await generateJsonResponse({
    prompt: analysisPrompt,
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    model: modelOverride,
    purpose: 'analysis',
  });

  // F5 — log metadata fingerprint, not the full payload. The full JSON
  // (incl. ~1000-word postContent) used to ship to Cloud Logging on every
  // ingest at ~5KB per write. Title + provider + model is enough to trace
  // any individual analysis from log search.
  logger.info('[ai-model] ✅ Analysis complete', {
    title: metadata?.title,
    cloudProvider: metadata?.cloudProvider,
    category: metadata?.category,
    wordCount: typeof metadata?.postContent === 'string' ? metadata.postContent.length : undefined,
    model: modelOverride || `${aiProvider}:default`,
  });

  return {
    metadata,
    prompt: analysisPrompt,
    model: modelOverride || `${aiProvider}:default`,
    aiProvider,
  };
}

/**
 * Analyze Architecture Diagram with the configured AI provider (multimodal).
 */
// R5: static system prompt for architecture analysis — extracted so it can be
// cached by Anthropic and used as systemInstruction on Vertex. Must stay
// ≥1,024 tokens for Anthropic caching eligibility.
const ARCHITECTURE_SYSTEM_PROMPT = `You are a Senior Cloud Architect and technical writer producing "Deep Dive" blueprint content for Hybrid Cloud Works (HCW). Your audience is senior cloud practitioners who will use your output to evaluate, replicate, or adapt architectures in their own environments.

Analysis methodology:
1. Identify every named service or component visible in the diagram. Include version numbers or tier designations where visible (e.g. "Amazon RDS for PostgreSQL 15", not just "RDS").
2. Infer data flow direction and control plane vs. data plane paths. Describe the primary request or event path from entry point to storage or response.
3. Assess architectural patterns present: Event-Driven, Fan-Out, CQRS, Sidecar, Service Mesh, Saga, etc. A diagram may exhibit multiple patterns.
4. Evaluate complexity holistically: Low = fewer than 5 services, single region, no managed orchestration; Medium = 5-12 services or multi-AZ; High = 12+ services, multi-region, or complex orchestration (Step Functions, Kafka, service mesh).
5. Cost estimation: use current list pricing for the identified tier and region (us-east-1 / us-central1 / eastus as default). State assumptions explicitly in the breakdown note field. Ranges should reflect realistic low and high monthly usage for a medium-traffic production workload.

Terraform code standards:
- Use the correct provider block for the identified cloud (aws, azurerm, google).
- Include resource blocks for the 3-5 most central components only. Do not enumerate every IAM policy or security group rule.
- Use variables for region, environment, and any cost-sensitive parameters (instance size, tier).
- Comments should explain the architectural decision, not restate the resource type.
- Code must be syntactically valid HCL — no placeholder pseudocode, no ellipsis (...), no TODO markers.

Output schema (return ONLY valid JSON, no markdown fences):
{
  "title": "Professional Architecture Title (e.g., 'Serverless Event Processing Pipeline'). Specific enough to distinguish from similar patterns.",
  "summary": "Executive summary, 4-5 sentences. What problem does this architecture solve? What are the key design decisions? What are the main trade-offs?",
  "category": "MUST be exactly one of: Compute, Storage, Database, Networking, Security, Analytics, AI/ML, Serverless, IoT, Migration.",
  "complexity": "MUST be exactly one of: Low, Medium, High. See methodology above.",
  "cloudProvider": "The provider passed in context.",
  "tags": ["3-5 specific architectural keywords. Examples: 'Event-Driven', 'Multi-AZ', 'Serverless', 'CQRS', 'Zero-Trust'. Avoid generic terms like 'scalable' or 'cloud-native'."],
  "technicalSpecs": {
    "components": ["Full service names with tier where visible, e.g. 'Amazon SQS (Standard Queue)', 'Azure App Service (P2v3)'"],
    "patterns": ["Architectural patterns identified, e.g. 'Event-Driven', 'Fan-Out', 'CQRS'"]
  },
  "overviewHtml": "Detailed technical overview in HTML (use <h3>, <p>, <ul>, <code>). Cover: (1) entry point and request path, (2) key architectural decisions and their rationale, (3) scalability and resilience characteristics, (4) notable trade-offs.",
  "costAnalysis": {
    "estimatedMonthly": "$XXX - $XXX",
    "breakdown": [{ "service": "Service Name + tier", "cost": "$XX/mo", "note": "Assumption: X req/s, Y GB storage" }],
    "optimizationTips": ["3 specific, actionable cost optimisation tips for this architecture"]
  },
  "terraformCode": "Syntactically valid HCL for the 3-5 core components. See Terraform standards above.",
  "deploymentSteps": ["Ordered step-by-step deployment guide, 6-10 steps, specific to this architecture"]
}`;

async function analyzeArchitectureDiagram(imageUrl, provider) {
  // Download image for multimodal input
  const imageBuffer = await downloadImageFromUrl(imageUrl);
  const imageBase64 = imageBuffer.toString('base64');

  const analysisPrompt = `Diagram Context: Cloud Provider = ${provider || 'AWS'}

Analyze the attached architecture diagram and return ONLY the JSON object defined in your instructions.`;

  const aiProvider = getActiveAiProvider();
  const modelOverride = process.env.CONTENTFORGE_MULTIMODAL_MODEL || null;

  logger.info(`[ai-model] Sending architecture analysis request via ${aiProvider}`);

  const metadata = await generateJsonResponse({
    parts: [{ text: analysisPrompt }, { inlineData: { mimeType: 'image/png', data: imageBase64 } }],
    systemPrompt: ARCHITECTURE_SYSTEM_PROMPT,
    model: modelOverride,
    purpose: 'multimodal',
  });

  // F5 — see analyzeWithGemini above for rationale.
  logger.info('[ai-model] ✅ Architecture Analysis complete', {
    title: metadata?.title,
    cloudProvider: metadata?.cloudProvider,
    category: metadata?.category,
    complexity: metadata?.complexity,
    componentCount: Array.isArray(metadata?.technicalSpecs?.components)
      ? metadata.technicalSpecs.components.length
      : undefined,
    model: modelOverride || `${aiProvider}:default`,
  });

  return {
    metadata,
    prompt: analysisPrompt,
    model: modelOverride || `${aiProvider}:default`,
    aiProvider,
  };
}

async function archiveScrapedImages(images, docId) {
  const storedImages = [];
  for (let i = 0; i < Math.min(images.length, 10); i++) {
    const img = images[i];
    const storedUrl = await downloadAndStoreImage(img.url, docId, i);
    if (storedUrl) {
      storedImages.push({ original: img.url, stored: storedUrl, alt: img.alt, index: i });
    }
  }
  return storedImages;
}

// F2 — Archive on publish. Takes refs-only shape (original/alt/index)
// produced by referenceScrapedImages at inspection time, downloads each
// image to Storage under articles/{docId}/image-{i}.{ext}, and returns the
// full shape with `stored` filled in. Idempotent: re-running over already
// archived items just re-uploads to the same paths.
async function archiveScrapedImageRefs(refs, docId) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  return archiveScrapedImages(
    refs.map((r) => ({ url: r.original || r.url || r.src, alt: r.alt })),
    docId
  );
}

// Re-export for use by cms-functions.js publish flow (lazy-required there
// to keep the existing circular import dance with index.js intact).
exports._internal_archiveScrapedImageRefs = archiveScrapedImageRefs;
exports._internal_uploadCoverWithResponsiveVariants = uploadCoverWithResponsiveVariants;

// F2 — Lightweight reference shape used during inspection. Skips the
// Cloud Storage download (saved for publish-time). The editor renders these
// directly via the `original` URL; archived `stored` URLs are filled in
// later by archiveScrapedImages on publish.
function referenceScrapedImages(images) {
  return images.slice(0, 10).map((img, i) => ({ original: img.url, alt: img.alt, index: i }));
}

async function inspectArchitectureSource(targetUrl, cloudProvider, docId, archiveDiagram = false) {
  if (archiveDiagram) {
    await downloadAndStoreImage(targetUrl, docId, 'diagram');
  }

  const analysis = await analyzeArchitectureDiagram(targetUrl, cloudProvider);
  const { metadata, prompt, model } = analysis;

  return {
    scraped: {
      success: true,
      markdown: metadata.overviewHtml || metadata.summary,
      html: '',
      plainText: metadata.summary || '',
      images: [],
      wordCount: (metadata.summary || '').split(/\s+/).length,
    },
    metadata,
    analysisPrompt: prompt,
    analysisModel: model,
    publishedAt: null,
  };
}

async function inspectArticleSource(targetUrl, cloudProvider, docId, existingPublishedAt) {
  const scraped = await scrapeArticle(targetUrl);
  if (!scraped.success) {
    throw new Error(scraped.error || 'Scraping failed');
  }

  // F2 — Defer Storage upload until publish. Drafts keep URL references only.
  scraped.images = referenceScrapedImages(scraped.images);

  let publishedAt = existingPublishedAt;
  if (!publishedAt) {
    const extractedDate = extractPublishedDate(scraped.html, scraped.plainText);
    if (extractedDate) {
      publishedAt = admin.firestore.Timestamp.fromDate(extractedDate);
    }
  }

  const analysis = await analyzeWithGemini(targetUrl, scraped.markdown);
  const { metadata, prompt, model } = analysis;

  // G5 — generate alt-text for scraped images (gated by CONTENTFORGE_ALT_TEXT_ENABLED).
  const imageUrls = (scraped.images || []).map((img) => img.original || img.url).filter(Boolean);
  const imageAltTexts = await generateAltTexts(imageUrls);

  return {
    scraped,
    metadata,
    analysisPrompt: prompt,
    analysisModel: model,
    publishedAt,
    imageAltTexts,
  };
}

function buildInspectionUpdateData({
  newData,
  targetUrl,
  scraped,
  metadata,
  analysisPrompt,
  analysisModel,
  publishedAt,
  imageAltTexts = {},
}) {
  const hasGeneratedPostContent =
    typeof metadata.postContent === 'string' && metadata.postContent.trim().length > 0;

  const updateData = {
    inspectTrigger: false,
    inspectCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    contentStatus: 'inspected',
    inspectError: null,
    type: newData.type || 'blog',
    slug: newData.slug || generateSlug(metadata.title),
    content: scraped.markdown.substring(0, 50000),
    contentHtml: scraped.html ? scraped.html.substring(0, 100000) : null,
    contentPlainText: scraped.plainText ? scraped.plainText.substring(0, 50000) : null,
    wordCount: scraped.wordCount,
    scrapedMethod: newData.type === 'architecture' ? 'gemini-multimodal' : 'axios-cheerio',
    scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
    scrapedImages: scraped.images || [],
    scrapedImagesCount: (scraped.images || []).length,
    imageAltTexts: Object.keys(imageAltTexts).length > 0 ? imageAltTexts : null,
    title: metadata.title,
    summary: metadata.summary,
    cloudProvider: newData.cloudProvider || metadata.cloudProvider,
    keyTopics: metadata.keyTopics || metadata.tags || [],
    targetAudience: metadata.targetAudience || 'Cloud Architect',
    visualTheme: metadata.visualTheme,
    ...(hasGeneratedPostContent && { postContent: metadata.postContent }),
    ...(newData.type === 'architecture' && {
      diagramUrl: targetUrl,
      category: metadata.category,
      complexity: metadata.complexity,
      technicalSpecs: metadata.technicalSpecs,
      costAnalysis: metadata.costAnalysis,
      terraformCode: metadata.terraformCode,
      deploymentSteps: metadata.deploymentSteps,
      overview: metadata.overviewHtml,
    }),
    analysisPrompt,
    analysisModel,
  };

  if (publishedAt) {
    updateData.publishedAt = publishedAt;
  }
  // R1 (May 11, 2026) — Imagen-4 cover generation deferred from inspection
  // (draft time) to publish time. Most ingested URLs never publish; firing
  // Imagen-4 on every ingest was the single largest waste in the AI stack
  // per documentation/AI-Integration-Inventory.md §9.4 R1.
  //
  // Default behavior is now NO auto-fire. The publish flow (publishNewBlog
  // in cms-functions.js) sets altCoverImageTrigger=true when an item
  // transitions to published_blog. Two explicit opt-ins preserved for the
  // admin "regenerate cover during review" workflow:
  //   - newData.generateAiCoverOnInspect === true → fire at inspection
  //   - newData.skipImageGeneration === true     → suppress everywhere
  //     (legacy field kept for inflight-doc backward compatibility)
  const generateOnInspect = newData.generateAiCoverOnInspect === true;
  const explicitlySuppressed = newData.skipImageGeneration === true;
  if (generateOnInspect && !explicitlySuppressed) {
    updateData.altCoverImageTrigger = true;
  }

  return updateData;
}

async function executeInspectionTrigger({
  collectionName,
  docId,
  newData,
  logPrefix,
  archiveArchitectureDiagram = false,
}) {
  const docRef = admin.firestore().collection(collectionName).doc(docId);
  const targetUrl = newData.url || newData.sourceUrl || newData['CD Url'];

  if (!targetUrl) {
    throw new Error('No URL provided in document (checked url, sourceUrl, CD Url)');
  }

  logger.info(`[${logPrefix}] ▶ Starting for ${docId} — ${targetUrl}`);

  const inspection =
    newData.type === 'architecture'
      ? await inspectArchitectureSource(
          targetUrl,
          newData.cloudProvider,
          docId,
          archiveArchitectureDiagram
        )
      : await inspectArticleSource(targetUrl, newData.cloudProvider, docId, newData.publishedAt);

  const updateData = buildInspectionUpdateData({
    newData,
    targetUrl,
    scraped: inspection.scraped,
    metadata: inspection.metadata,
    analysisPrompt: inspection.analysisPrompt,
    analysisModel: inspection.analysisModel,
    publishedAt: inspection.publishedAt,
    imageAltTexts: inspection.imageAltTexts || {},
  });

  await docRef.update(updateData);
  logger.info(`[${logPrefix}] ✅ Complete for ${docId}`);
}

// F6 (May 11, 2026) — inspectAndPopulateArticle (blogs collection) removed.
// It was unreachable from any deployed code path: no live writer sets
// inspectTrigger:true on blogs/, publishNewBlog spreads content data which
// always carries inspectTrigger:false post-inspection, and the admin
// "Re-Inspect" button targets content/. Only dev scripts in
// documentation/archive/legacy-scripts/ ever fired it. Decommissioned via
// `firebase functions:delete inspectAndPopulateArticle --region=us-central1`.
// See documentation/Firebase-GCP-Cost-Inventory.md §7 F6 for full audit.

exports.inspectAndPopulateContent = onDocumentWritten(
  {
    document: 'content/{contentId}',
    region: 'us-central1',
    // F7 (May 11, 2026) — Memory dropped 1GiB → 512MiB. The inspection workload
    // is scrape (~50-200KB HTML) + Gemini call + ~50KB doc write; profiling
    // showed no allocation pressure. Halves GB-second cost. Bump back to 1GiB
    // if Cloud Logging shows OOM kills.
    memory: '512MiB',
    timeoutSeconds: 180,
    secrets: [...aiSecrets, firecrawlApiKey],
  },
  async (event) => {
    const { contentId } = event.params;
    const newData = event.data?.after?.data();
    if (!newData) return null;
    if (!newData.inspectTrigger) return null;

    try {
      await executeInspectionTrigger({
        collectionName: 'content',
        docId: contentId,
        newData,
        logPrefix: 'inspect:content',
      });
      return null;
    } catch (error) {
      console.error(`[inspect:content] ❌ ${contentId}: ${error.message}`);
      await admin.firestore().collection('content').doc(contentId).update({
        inspectTrigger: false,
        inspectError: error.message,
        inspectErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
  }
);

// ==============================================================================
// AI COVER IMAGE GENERATION (REPLICATE IMAGEN-4 TRIGGER)
// ==============================================================================

const Replicate = require('replicate');

/**
 * Provider color schemes and themes for AI prompts
 */
const PROVIDER_THEMES = {
  Azure: { color: 'blue and white', vibe: 'modern and corporate' },
  AWS: { color: 'orange and dark blue', vibe: 'professional and energetic' },
  GCP: { color: 'multicolor (blue, red, yellow, green)', vibe: 'playful and innovative' },
  GitHub: { color: 'purple and dark gray', vibe: 'developer-focused and sleek' },
  Terraform: { color: 'purple', vibe: 'technical and structured' },
  FinOps: { color: 'teal and green', vibe: 'financial and analytical' },
  Multi: { color: 'multicolor gradient', vibe: 'versatile and integrated' },
};

/**
 * Build Imagen-4 prompt based on article metadata
 * Uses contextual metadata from Stage 1 inspection if available
 */
function buildImagePrompt(article) {
  const provider = article.cloudProvider || article.provider || article.Provider || 'Azure';
  const theme = PROVIDER_THEMES[provider] || PROVIDER_THEMES.Azure;

  // Enhanced contextual prompt if we have rich metadata from inspection
  if (article.keyTopics && article.visualTheme && article.summary) {
    const topics = article.keyTopics.join(', ');

    return `Create a professional technical illustration in ${theme.color} color scheme with a ${theme.vibe} aesthetic.

Scene: 2-3 cute Lego minifigure-style characters collaborating to build cloud infrastructure.

They are constructing and working on: ${topics}

Visual metaphor: ${article.visualTheme}

Context: ${article.summary}

Style requirements:
- Isometric 3D illustration, clean and modern design
- Modular building blocks with Lego brick aesthetic
- Characters actively building/connecting/deploying components
- Subtle ${provider} branding elements (colors, logo hints)
- Tech-focused and professional yet playful
- No text overlays, labels, or written words in the image
- Focus on the collaborative building activity

The scene should visually represent the article's core concepts through the Lego characters' construction work.`;
  }

  // Fallback to simple prompt for legacy articles without rich metadata
  const resources =
    article.resources || article.Resources || article.title || 'cloud infrastructure';
  return `Create a professional technical illustration in ${theme.color} color scheme with a ${theme.vibe} aesthetic. The scene features cute Lego minifigure-style characters collaborating to build cloud infrastructure. Show 2-3 blocky characters working together on: ${resources}. The characters should be constructing these as modular building blocks, similar to Lego bricks. Include subtle ${provider} branding elements. Style: isometric 3D illustration, clean and modern, tech-focused, with a playful builder theme. No text or logos, just the visual scene.`;
}

/**
 * Call Replicate Imagen-4 API to generate image
 */
async function callReplicateApi(apiKey, prompt) {
  // useFileOutput:false ensures replicate.run() returns plain URL strings.
  // Without this, SDK 1.x returns FileOutput objects that, when passed to
  // https.get(), are treated as options and connect to localhost:443.
  const replicate = new Replicate({
    auth: apiKey.trim(),
    useFileOutput: false,
  });

  const input = {
    prompt,
    aspect_ratio: '16:9', // Wide format for cover images
    image_size: process.env.CONTENTFORGE_IMAGE_SIZE || '2K',
    output_format: 'png',
    safety_filter_level: 'block_medium_and_above',
  };

  // R2/G1: hero covers use CONTENTFORGE_IMAGE_MODEL_HERO first, then the
  // shared CONTENTFORGE_IMAGE_MODEL, then the cost-optimised default.
  const heroModel =
    process.env.CONTENTFORGE_IMAGE_MODEL_HERO ||
    process.env.CONTENTFORGE_IMAGE_MODEL ||
    'google/imagen-4-fast';

  const maxAttempts = 3;
  let attempts = 0;
  let output;

  while (attempts < maxAttempts) {
    try {
      logger.info(`[replicate] Sending request (Attempt ${attempts + 1}/${maxAttempts})...`);
      output = await replicate.run(heroModel, { input });
      break;
    } catch (err) {
      attempts++;
      // Check for transient errors (503 Service Unavailable, 429 Too Many Requests)
      // Replicate client might wrap errors, so check message string too.
      const isRetryable =
        err.message.includes('503') ||
        err.message.includes('429') ||
        err.message.includes('Service Unavailable') ||
        err.message.includes('Too Many Requests');

      if (isRetryable && attempts < maxAttempts) {
        const delay = Math.pow(2, attempts) * 1000; // 2s, 4s, 8s...
        console.warn(`[replicate] ⚠️ ${err.message}. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }

  // Replicate returns the URL directly or as output[0]
  const imageUrl = typeof output === 'string' ? output : output[0] || output.url;

  if (!imageUrl) {
    throw new Error('No image URL returned from Replicate API');
  }

  return imageUrl;
}

/**
 * Download image from URL
 */
function downloadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

/**
 * Upload buffer to Firebase Storage and return public URL
 */
async function uploadAiCoverToStorage(buffer, filename) {
  const bucket = admin.storage().bucket(BUCKET);
  const storagePath = `covers/${filename}`;
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      contentType: 'image/png',
      metadata: {
        firebaseStorageDownloadTokens: crypto.randomUUID(),
      },
    },
  });

  const encodedPath = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media`;
}

// F9 — Upload an Imagen-4 PNG cover plus three WebP responsive variants
// (640w / 1280w / 2048w) so the public site can serve smaller payloads via
// <img srcset>. Returns { original, webp: { '640', '1280', '2048' } }.
// On Sharp failure the original PNG still ships; variants come back as null
// and the frontend falls back to the original.
async function uploadCoverWithResponsiveVariants(buffer, filename) {
  const original = await uploadAiCoverToStorage(buffer, filename);
  const webp = { 640: null, 1280: null, 2048: null };

  if (!sharp) return { original, webp };

  const baseName = filename.replace(/\.[^.]+$/, '');
  const widths = [640, 1280, 2048];
  const bucket = admin.storage().bucket(BUCKET);

  await Promise.all(
    widths.map(async (width) => {
      try {
        const variantBuffer = await sharp(buffer)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        const variantPath = `covers/${baseName}-${width}.webp`;
        const variantFile = bucket.file(variantPath);
        await variantFile.save(variantBuffer, {
          metadata: {
            contentType: 'image/webp',
            metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() },
          },
        });
        const encodedVariantPath = encodeURIComponent(variantPath);
        webp[width] =
          `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedVariantPath}?alt=media`;
      } catch (err) {
        logger.warn(`[uploadCoverWithResponsiveVariants] ${width}w failed: ${err.message}`);
      }
    })
  );

  return { original, webp };
}

async function persistGeneratedContentImage({
  contentId,
  target,
  imageUrl,
  imageVariants = null,
  data = {},
  sourceCollection = 'content',
}) {
  await admin
    .firestore()
    .collection('generated_content_images')
    .add({
      contentId,
      articleId: contentId,
      slot: target,
      imageUrl,
      // F9 — Persist responsive WebP variant URLs alongside the original PNG
      // so consumers can opt into <img srcset>. Null/missing means no variants
      // were generated; callers must fall back to imageUrl.
      ...(imageVariants && { imageVariants }),
      title: data.Title || data.title || 'Untitled',
      provider: data['Cloud Provider'] || data.cloudProvider || '',
      contentType: data.type || data.contentType || 'blog',
      sourceCollection,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

// F6 (May 11, 2026) — generateAiCoverOnTrigger (blogs collection) removed.
// Was a duplicate of generateAiCoverOnContentTrigger and only reachable via
// the now-removed inspectAndPopulateArticle. Decommissioned via
// `firebase functions:delete generateAiCoverOnTrigger --region=us-central1`.

exports.generateAiCoverOnContentTrigger = onDocumentWritten(
  {
    document: 'content/{contentId}',
    secrets: [replicateApiKey, ...aiSecrets],
  },
  async (event) => {
    const { contentId } = event.params;
    const afterData = event.data?.after?.data();
    const beforeData = event.data?.before?.data();

    if (!afterData || afterData.altCoverImageTrigger !== true) {
      return null;
    }

    if (beforeData?.altCoverImageTrigger === true) {
      return null;
    }

    logger.info(`[generateAiCover:content] Trigger detected for content/${contentId}`);

    try {
      let prompt = afterData.altCoverImagePrompt;

      if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        prompt = buildImagePrompt(afterData);
        logger.info('[generateAiCover:content] Built new prompt from metadata.');
      } else {
        logger.info('[generateAiCover:content] Using user-provided prompt.');
      }

      const targets =
        Array.isArray(afterData.aiImageTargets) && afterData.aiImageTargets.length > 0
          ? afterData.aiImageTargets.slice(0, 4)
          : ['hero'];

      const generatedUrls = {};
      const generatedVariants = {};
      const historyUpdates = {};

      for (const target of targets) {
        const slotPrompt = `${prompt}\n\nImage slot: ${target}. Keep composition distinct while preserving style continuity.`;
        const imageUrl = await callReplicateWithFallback(replicateApiKey.value(), slotPrompt);
        const imageBuffer = await downloadImageFromUrl(imageUrl);
        const filename = `${contentId}-ai-${target}.png`;
        // F9 — Upload the PNG original plus WebP responsive variants.
        const { original: publicUrl, webp } = await uploadCoverWithResponsiveVariants(
          imageBuffer,
          filename
        );
        generatedUrls[target] = publicUrl;
        generatedVariants[target] = webp;
        historyUpdates[`aiImageHistory.${target}`] =
          admin.firestore.FieldValue.arrayUnion(publicUrl);
        await persistGeneratedContentImage({
          contentId,
          target,
          imageUrl: publicUrl,
          imageVariants: webp,
          data: afterData,
        });
      }

      const updateData = {
        altCoverImageTrigger: false,
        altCoverImagePrompt: prompt,
        altCoverImageGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
        altCoverImageError: admin.firestore.FieldValue.delete(),
        aiImageUrls: {
          ...(afterData.aiImageUrls || {}),
          ...generatedUrls,
        },
        aiImageVariants: {
          ...(afterData.aiImageVariants || {}),
          ...generatedVariants,
        },
        ...historyUpdates,
      };

      if (generatedUrls.hero) {
        updateData.altCoverImage = generatedUrls.hero;
        if (generatedVariants.hero) {
          updateData.altCoverImageVariants = generatedVariants.hero;
        }
      }

      await admin.firestore().collection('content').doc(contentId).update(updateData);
      return null;
    } catch (err) {
      console.error(`[generateAiCover:content] Failed for content/${contentId}:`, err.message);
      await admin.firestore().collection('content').doc(contentId).update({
        altCoverImageTrigger: false,
        altCoverImageError: err.message,
      });
      throw err;
    }
  }
);

// ============================================================================
// generateReviewHeroImage — On-demand single hero from Review Queue card.
// Uses the page-prompt pair (primaryPrompt + secondaryPrompt) authored in the
// Prompts admin (image_prompts/{provider}_{type}). Bypasses the auto-trigger
// path entirely so the queue stays placeholder-only until the operator clicks.
// ============================================================================

function resolvePromptPagePath(provider, type) {
  const p = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const t = String(type || 'blog')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!p) return null;
  // Editorial convention: review-queue items map to the `_news` page-prompt.
  // Other types use their own (blog, architecture, etc.) when authored.
  const suffix = t === 'blog' ? 'news' : t;
  return `${p}_${suffix}`;
}

/**
 * Gather raw tag candidates from an article.
 *
 * Ingest paths populate wildly different fields, so every known source is
 * pulled and flattened — arrays of strings, arrays of {name|label|title|value}
 * objects, delimiter-separated strings, and plain string maps. Empty strings
 * are deliberately kept: the caller passes these straight into applyMatrix as
 * rawTags, and filtering here would change what that sees.
 *
 * Extracted verbatim from generateReviewHeroImage, where this loop alone
 * accounted for most of the branch count.
 */
function collectTagCandidates(article) {
  const tagSources = [
    article.keyTopics,
    article.tags,
    article.Tags,
    article.categories,
    article.Categories,
    article.category,
    article.Category,
    article.topics,
    article.keywords,
    article.Keywords,
    article.services,
    article.products,
    article.awsServices,
    article.azureServices,
    article.gcpServices,
    article.labels,
    article.taxonomy,
  ];
  const collected = [];
  for (const src of tagSources) {
    if (!src) continue;
    if (Array.isArray(src)) {
      for (const v of src) {
        if (typeof v === 'string') collected.push(v);
        else if (v && typeof v === 'object') {
          collected.push(v.name || v.label || v.title || v.value || '');
        }
      }
    } else if (typeof src === 'string') {
      src.split(/[,|;]/).forEach((v) => collected.push(v));
    } else if (typeof src === 'object') {
      Object.values(src).forEach((v) => {
        if (typeof v === 'string') collected.push(v);
      });
    }
  }
  return collected;
}

/**
 * Resolve a page path to its prompt pair.
 *
 * Authoritative source is image_prompt_pages/{pageDocId} -> (setName,
 * promptName); the legacy fallback is a self-contained image_prompts/{pageDocId}
 * doc. Because each miss is a distinct 404 for the caller, failures come back as
 * { status, error } rather than being thrown or logged — the handler still sends
 * exactly the statuses and messages it sent inline.
 */
async function resolveHeroPromptPair(db, pagePath) {
  let setName = '';
  let promptName = '';
  let primaryPrompt = '';
  let secondaryPrompt = '';
  let slotTemplates = {};

  const assignmentSnap = await db.collection('image_prompt_pages').doc(pagePath).get();
  if (assignmentSnap.exists) {
    const assign = assignmentSnap.data() || {};
    setName = String(assign.setName || '').trim();
    promptName = String(assign.promptName || '').trim();
  }

  if (setName && promptName) {
    const setSnap = await db.collection('image_prompt_sets').doc(setName).get();
    if (!setSnap.exists) {
      return {
        status: 404,
        error: `Assigned set "${setName}" not found in image_prompt_sets.`,
      };
    }
    primaryPrompt = String(setSnap.data()?.primaryPrompt || '').trim();

    const nameSnap = await db
      .collection('image_prompt_sets')
      .doc(setName)
      .collection('prompts')
      .doc(promptName)
      .get();
    if (!nameSnap.exists) {
      return {
        status: 404,
        error: `Assigned prompt name "${promptName}" not found under set "${setName}".`,
      };
    }
    const nameData = nameSnap.data() || {};
    secondaryPrompt = String(nameData.additionalParameters || '').trim();
    slotTemplates = nameData.slotTemplates || {};
  } else {
    // Legacy fallback to self-contained doc
    const legacySnap = await db.collection('image_prompts').doc(pagePath).get();
    if (!legacySnap.exists) {
      return {
        status: 404,
        error: `No prompt assignment found for ${pagePath} — assign a Prompt Set and Prompt Name in Prompts admin.`,
      };
    }
    const legacy = legacySnap.data() || {};
    primaryPrompt = String(legacy.primaryPrompt || '').trim();
    secondaryPrompt = String(legacy.secondaryPrompt || '').trim();
  }

  if (!primaryPrompt && !secondaryPrompt) {
    return {
      status: 400,
      error: `Prompt pair for ${pagePath} has no primary/secondary text.`,
    };
  }

  return { setName, promptName, primaryPrompt, secondaryPrompt, slotTemplates };
}

/** The four article fields the hero prompt needs, across every field spelling. */
function readHeroArticleFields(article) {
  return {
    provider: article.cloudProvider || article['Cloud Provider'] || article.provider || '',
    type: article.type || article.contentType || 'blog',
    title: article.Title || article.title || '',
    summary: article.Summary || article.summary || '',
  };
}

/**
 * Assemble the image-generation prompt. Every section is optional except the
 * character/style header, the title and the output directive; falsy sections
 * drop out via filter(Boolean), exactly as they did inline.
 */
function buildHeroPrompt({
  primaryPrompt,
  secondaryPrompt,
  heroSlotTemplate,
  title,
  summary,
  allTags,
  promptAugmentations,
}) {
  return [
    `CHARACTER & STYLE:\n${primaryPrompt}`,
    secondaryPrompt && `INSTRUCTIONS:\n${secondaryPrompt}`,
    heroSlotTemplate && `SLOT:\n${heroSlotTemplate}`,
    `ARTICLE TITLE: ${title}`,
    summary && `ARTICLE SUMMARY: ${summary}`,
    allTags.length > 0 && `TAGS / SERVICES TO REPRESENT: ${allTags.join(', ')}`,
    promptAugmentations.length > 0 &&
      `SCENE AUGMENTATIONS:\n- ${promptAugmentations.join('\n- ')}`,
    'OUTPUT: Hero image, 16:9 aspect ratio, no text overlay other than official vendor logos.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Field mask written back to the content doc after a successful generation. */
function buildHeroContentUpdate(publicUrl, webp, finalPrompt) {
  return {
    altCoverImage: publicUrl,
    altCoverImageVariants: webp || null,
    altCoverImagePrompt: finalPrompt,
    altCoverImageGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
    altCoverImageError: admin.firestore.FieldValue.delete(),
    [`aiImageUrls.hero`]: publicUrl,
    [`aiImageVariants.hero`]: webp || null,
    [`aiImageHistory.hero`]: admin.firestore.FieldValue.arrayUnion(publicUrl),
  };
}

/** Audit row appended to generated_content_images for each generated hero. */
function buildGeneratedImageRecord({
  contentId,
  publicUrl,
  webp,
  title,
  provider,
  type,
  finalPrompt,
  pagePath,
  setName,
  promptName,
  allTags,
  actor,
}) {
  return {
    contentId,
    articleId: contentId,
    slot: 'hero',
    imageUrl: publicUrl,
    ...(webp && { imageVariants: webp }),
    title,
    provider,
    contentType: type,
    sourceCollection: 'content',
    prompt: finalPrompt,
    promptPagePath: pagePath,
    promptSetName: setName || null,
    promptName: promptName || null,
    customTags: allTags,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: actor.email || actor.uid || 'admin',
  };
}

exports.generateReviewHeroImage = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [replicateApiKey, ...aiSecrets],
  },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'POST only' });
    }
    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    const contentId = String(req.body?.contentId || '').trim();
    if (!contentId) {
      return res.status(400).json({ success: false, error: 'contentId required' });
    }

    const db = admin.firestore();
    const contentRef = db.collection('content').doc(contentId);
    const contentSnap = await contentRef.get();
    if (!contentSnap.exists) {
      return res.status(404).json({ success: false, error: `content/${contentId} not found` });
    }
    const article = contentSnap.data() || {};
    const { provider, type, title, summary } = readHeroArticleFields(article);

    const pagePath = resolvePromptPagePath(provider, type);
    if (!pagePath) {
      return res
        .status(400)
        .json({ success: false, error: `Cannot resolve prompt page for provider="${provider}"` });
    }

    // Resolve the page assignment → (setName, promptName), or bail with the
    // status that resolution determined.
    const promptPair = await resolveHeroPromptPair(db, pagePath);
    if (promptPair.status) {
      return res.status(promptPair.status).json({ success: false, error: promptPair.error });
    }
    const { setName, promptName, primaryPrompt, secondaryPrompt, slotTemplates } = promptPair;

    const heroSlotTemplate = String(slotTemplates?.hero || '').trim();

    // Robust tag gathering: many ingest paths populate different fields. Pull
    // from every known source so the prompt always has vendor/service signal.
    const collected = collectTagCandidates(article);

    // Run the keyword matrix to (a) collapse synonyms into canonical tags and
    // (b) pull in directive sentences for known triggers (Kiro, AWS Backup,
    // certification, etc.). Matrix is admin-editable in Firestore; falls back
    // to the in-code seed if empty.
    const matrix = await loadKeywordMatrix(db);
    const haystack = [title, summary, ...collected].filter(Boolean).join(' \n ');
    const matrixResult = applyMatrix(matrix, {
      rawTags: [provider, type, ...collected],
      haystack,
    });
    const allTags = matrixResult.all;
    const promptAugmentations = matrixResult.augmentations;

    const finalPrompt = buildHeroPrompt({
      primaryPrompt,
      secondaryPrompt,
      heroSlotTemplate,
      title,
      summary,
      allTags,
      promptAugmentations,
    });

    try {
      const imageUrl = await callReplicateWithFallback(replicateApiKey.value(), finalPrompt);
      const imageBuffer = await downloadImageFromUrl(imageUrl);
      const filename = `${contentId}-ai-hero.png`;
      const { original: publicUrl, webp } = await uploadCoverWithResponsiveVariants(
        imageBuffer,
        filename
      );

      await contentRef.update(buildHeroContentUpdate(publicUrl, webp, finalPrompt));

      await db.collection('generated_content_images').add(
        buildGeneratedImageRecord({
          contentId,
          publicUrl,
          webp,
          title,
          provider,
          type,
          finalPrompt,
          pagePath,
          setName,
          promptName,
          allTags,
          actor,
        })
      );

      return res.json({
        success: true,
        contentId,
        imageUrl: publicUrl,
        promptPagePath: pagePath,
      });
    } catch (err) {
      logger.error(`[generateReviewHero] ${contentId}: ${err.message}`);
      await contentRef.update({
        altCoverImageError: err.message,
      });
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

exports.createSlugPageOnTrigger = onDocumentWritten(
  {
    document: 'blogs/{blogId}',
    region: 'us-central1',
  },
  async (event) => {
    const { blogId } = event.params;
    const afterData = event.data?.after?.data();
    const beforeData = event.data?.before?.data();

    if (!afterData || afterData.createSlugPageTrigger !== true) {
      return null;
    }
    if (beforeData?.createSlugPageTrigger === true) {
      return null;
    }

    const rawTitle = afterData.Title || afterData.title || 'untitled-article';
    const provider = String(
      afterData.landingProvider || afterData.cloudProvider || afterData['Cloud Provider'] || 'azure'
    ).toLowerCase();
    const baseSlug = generateSlug(rawTitle) || `article-${blogId.slice(0, 6)}`;
    const slug = afterData.slug || afterData.Slug || `${baseSlug}-${blogId.slice(0, 6)}`;

    await admin
      .firestore()
      .collection('blogs')
      .doc(blogId)
      .update({
        slug,
        Slug: slug,
        createSlugPageTrigger: false,
        curatedParent: afterData.curatedParent || 'Curated Articles',
        curatedSubpage: true,
        curatedSubpagePath: `/${provider}/blog/${slug}`,
        curatedLinkedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return null;
  }
);

// ============================================================================
// Content Cleanup — Auto-delete rejected content after 24 hours
// ============================================================================

/**
 * Scheduled function: Runs daily at 4:00 AM CST to soft-delete rejected
 * content older than 24 hours. The soft-delete reaper (`cleanupSoftDeletedContent`,
 * 7-day grace) is what eventually hard-deletes them. Total recoverable
 * window for an accidentally-rejected item is therefore ~8 days.
 */
exports.cleanupRejectedContent = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async () => {
    logger.info('[cleanupRejectedContent] Starting scheduled rejected-content cleanup');

    try {
      const cmsFunctions = require('./cms-functions');
      const result = await cmsFunctions.deleteRejectedContentBatch({
        olderThanHours: 24,
        limit: 500,
      });
      logger.info(
        `[cleanupRejectedContent] Deleted=${result.deletedCount}, Examined=${result.examinedCount}, HasMore=${result.hasMore}`
      );
    } catch (err) {
      logger.error('[cleanupRejectedContent] Cleanup failed:', err);
      throw err;
    }
  }
);

exports.cleanupSoftDeletedContent = onSchedule(
  {
    // F8 (May 11, 2026) — cut from hourly to every 4h. 7-day soft-delete grace
    // window doesn't need hourly reaping; 4h cadence still hits the window 42x
    // before any item ages out.
    schedule: '0 */4 * * *',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async () => {
    logger.info('[cleanupSoftDeletedContent] Starting scheduled soft-delete cleanup');

    try {
      const cmsFunctions = require('./cms-functions');
      // 7-day grace window. Items reach this reaper either by:
      //   1. cleanupRejectedContent setting softDeletedAt when a rejection
      //      passes its 24h "still recoverable" window, or
      //   2. an explicit user-initiated soft-delete from the admin UI.
      // The 7 days runs from when softDeletedAt is set (i.e. step 1's
      // 24h is already spent before the 7-day clock starts), so the
      // total recoverable window for an accidental reject is ~8 days.
      const result = await cmsFunctions.deleteSoftDeletedContentBatch({
        olderThanHours: 24 * 7,
        limit: 200,
      });
      logger.info(
        `[cleanupSoftDeletedContent] DeletedContent=${result.deletedContentCount}, DeletedBlogs=${result.deletedBlogCount}, Examined=${result.examinedCount}, HasMore=${result.hasMore}`
      );
    } catch (err) {
      logger.error('[cleanupSoftDeletedContent] Cleanup failed:', err);
      throw err;
    }
  }
);

// Helpers for publishScheduledContent: validation + publish + metadata update
// for one content document. Returns 'published' or 'skipped'; throws on
// real failure so the caller can record it.
const PUBLISH_ELIGIBLE_STATUSES = [
  'ready_to_publish',
  'approved_blog',
  'published_blog',
  'approved_news',
  'published_news',
  'published_both',
];

function resolveScheduledPublishDate(rawValue) {
  if (!rawValue) return null;
  if (rawValue?.toDate) return rawValue.toDate();
  return new Date(rawValue);
}

function validateScheduledItem({ data }) {
  const status = data.contentStatus || '';
  if (!PUBLISH_ELIGIBLE_STATUSES.includes(status)) {
    return { skip: true, reason: `status ${status || 'unknown'}` };
  }
  const provider = data['Cloud Provider'] || data.cloudProvider || '';
  const titleForSlug = data.Title || data.title || '';
  const slugCandidate = generateSlug(titleForSlug);
  if (!provider) return { skip: true, reason: 'missing provider metadata' };
  if (!slugCandidate) return { skip: true, reason: 'missing slug/title metadata' };

  const publishedAtValue =
    data.publishedDate ||
    data.datePublished ||
    data['Published At'] ||
    data.blogPublishedAt ||
    data.publishedAt ||
    null;
  const publishedAtDate = resolveScheduledPublishDate(publishedAtValue);
  const scheduledDate = resolveScheduledPublishDate(data.scheduledPublishDate);
  if (publishedAtDate && Number.isNaN(publishedAtDate.getTime())) {
    return { skip: true, reason: 'invalid Published At timestamp' };
  }
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
    return { skip: true, reason: 'invalid scheduledPublishDate timestamp' };
  }
  return { skip: false, publishedAtDate };
}

async function processOneScheduledContentItem(db, doc) {
  const data = doc.data();
  const contentId = doc.id;
  const validation = validateScheduledItem({ data });
  if (validation.skip) {
    logger.warn(`[publishScheduledContent] Skipping ${contentId}: ${validation.reason}`);
    return 'skipped';
  }

  logger.info(`[publishScheduledContent] Publishing: ${contentId} - ${data.Title || data.title}`);
  const cmsFunctions = require('./cms-functions');
  const publishResult = await cmsFunctions.processPublishContent(admin.firestore(), contentId, {
    user: { email: 'scheduler@system.local', uid: 'scheduler' },
    publishTarget: 'blog',
    markLive: true,
    createSlugPageTrigger: true,
    addToCurated: true,
  });
  if (publishResult?.error) {
    throw new Error(publishResult.error);
  }

  const { publishedAtDate } = validation;
  await db
    .collection('content')
    .doc(contentId)
    .update({
      scheduledPublishDate: null,
      contentStatus: 'published_blog',
      publishTarget: 'blog',
      approvedForNews: false,
      approvedForBlog: true,
      Live: true,
      publishedAt: publishedAtDate || admin.firestore.FieldValue.serverTimestamp(),
      ...(publishedAtDate && {
        blogPublishedAt: publishedAtDate,
        'Published At': publishedAtDate,
        publishedDate: publishedAtDate,
        datePublished: publishedAtDate,
      }),
    });
  logger.info(`[publishScheduledContent] Successfully published: ${contentId}`);
  return 'published';
}

/**
 * Scheduled function to check for content with scheduledPublishDate <= now
 * and publish them automatically. Runs every 15 minutes.
 */
exports.publishScheduledContent = onSchedule(
  {
    schedule: '*/15 * * * *', // Run every 15 minutes
    timeZone: 'America/Chicago',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    logger.info('[publishScheduledContent] Checking for due publications at', now.toDate());
    const runMetrics = {
      due: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      sampleErrors: [],
    };

    try {
      // Query content that is scheduled to be published and is due
      const snapshot = await db
        .collection('content')
        .where('scheduledPublishDate', '<=', now)
        .where('Live', '==', false)
        .limit(50) // Process max 50 items per run
        .get();

      runMetrics.due = snapshot.size;

      if (snapshot.empty) {
        // F8 (May 11, 2026) — empty runs no longer write to workflow_digests.
        // The scheduler runs every 15min and almost always has no work pre-launch;
        // 96 no-op writes/day was rounding-error cost but real. OpsHealth UI
        // interprets a missing/stale publishingOps as healthy when
        // publishingWatchdog (monitorPublishingPipeline) isn't raising alerts.
        logger.info('[publishScheduledContent] No scheduled content due for publishing');
        return;
      }

      logger.info(`[publishScheduledContent] Found ${snapshot.size} items to publish`);

      // Process each item
      for (const doc of snapshot.docs) {
        const contentId = doc.id;
        try {
          const outcome = await processOneScheduledContentItem(db, doc);
          if (outcome === 'skipped') runMetrics.skipped += 1;
          else runMetrics.published += 1;
        } catch (itemErr) {
          logger.error(`[publishScheduledContent] Failed to publish ${contentId}:`, itemErr);
          runMetrics.failed += 1;
          if (runMetrics.sampleErrors.length < 5) {
            runMetrics.sampleErrors.push({
              contentId,
              error: String(itemErr?.message || itemErr),
            });
          }
        }
      }

      logger.info(`[publishScheduledContent] Completed processing ${snapshot.size} items`);

      const digestDate = new Date().toISOString().slice(0, 10);
      await db
        .collection('workflow_digests')
        .doc(digestDate)
        .set(
          {
            publishingOps: {
              lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
              status: runMetrics.failed > 0 ? 'degraded' : 'success',
              due: runMetrics.due,
              published: runMetrics.published,
              skipped: runMetrics.skipped,
              failed: runMetrics.failed,
              sampleErrors: runMetrics.sampleErrors,
            },
          },
          { merge: true }
        );

      if (runMetrics.failed > 0) {
        const alertDocId = `scheduled-publish-${new Date().toISOString().slice(0, 13)}`;
        await db.collection('workflow_alerts').doc(alertDocId).set(
          {
            alertType: 'scheduled_publish_failures',
            severity: 'warning',
            active: true,
            failedCount: runMetrics.failed,
            dueCount: runMetrics.due,
            sampleErrors: runMetrics.sampleErrors,
            source: 'publishScheduledContent',
            firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (err) {
      logger.error('[publishScheduledContent] Scheduled publishing failed:', err);
      const digestDate = new Date().toISOString().slice(0, 10);
      await db
        .collection('workflow_digests')
        .doc(digestDate)
        .set(
          {
            publishingOps: {
              lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
              status: 'failed',
              due: runMetrics.due,
              published: runMetrics.published,
              skipped: runMetrics.skipped,
              failed: runMetrics.failed + 1,
              sampleErrors: [
                ...runMetrics.sampleErrors,
                {
                  contentId: null,
                  error: String(err?.message || err),
                },
              ].slice(0, 5),
            },
          },
          { merge: true }
        );
      throw err;
    }
  }
);

exports.monitorPublishingPipeline = onSchedule(
  {
    // F8 (May 11, 2026) — cut from hourly to every 6h. The 45-minute stale
    // threshold inside the function is independent of cadence; alerts still
    // fire promptly when overdue content sits past threshold. Pre-launch
    // there is no value in checking pipeline health 24x/day.
    schedule: '0 */6 * * *',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    timeoutSeconds: 240,
    memory: '256MiB',
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const staleScheduledThreshold = admin.firestore.Timestamp.fromDate(
      new Date(now.getTime() - 45 * 60 * 1000)
    );
    const stagedTooLongThresholdMs = now.getTime() - 6 * 60 * 60 * 1000;

    const overdueScheduledSnapshot = await db
      .collection('content')
      .where('scheduledPublishDate', '<=', staleScheduledThreshold)
      .where('Live', '==', false)
      .limit(100)
      .get();

    const nonLiveSnapshot = await db
      .collection('content')
      .where('Live', '==', false)
      .limit(250)
      .get();
    const stagedTooLong = nonLiveSnapshot.docs.filter((docSnap) => {
      const data = docSnap.data() || {};
      if (data.contentStatus !== 'published_blog') return false;
      if (data.scheduledPublishDate) return false;

      const ts = data.blogPublishedAt || data.reviewedAt || data.updatedAt || null;
      const tsMs = ts?.toMillis?.() || ts?.toDate?.()?.getTime?.() || 0;
      return tsMs > 0 && tsMs <= stagedTooLongThresholdMs;
    });

    const digestDate = now.toISOString().slice(0, 10);
    await db
      .collection('workflow_digests')
      .doc(digestDate)
      .set(
        {
          publishingWatchdog: {
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            overdueScheduledCount: overdueScheduledSnapshot.size,
            stagedTooLongCount: stagedTooLong.length,
          },
        },
        { merge: true }
      );

    if (overdueScheduledSnapshot.size > 0 || stagedTooLong.length > 0) {
      const alertDocId = `publishing-watchdog-${now.toISOString().slice(0, 13)}`;
      await db
        .collection('workflow_alerts')
        .doc(alertDocId)
        .set(
          {
            alertType: 'publishing_pipeline_stalled_items',
            severity: overdueScheduledSnapshot.size > 0 ? 'critical' : 'warning',
            active: true,
            overdueScheduledCount: overdueScheduledSnapshot.size,
            stagedTooLongCount: stagedTooLong.length,
            sampleOverdueIds: overdueScheduledSnapshot.docs.slice(0, 10).map((d) => d.id),
            sampleStagedIds: stagedTooLong.slice(0, 10).map((d) => d.id),
            source: 'monitorPublishingPipeline',
            firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      logger.warn(
        `[monitorPublishingPipeline] Alerts raised: overdueScheduled=${overdueScheduledSnapshot.size}, stagedTooLong=${stagedTooLong.length}`
      );
    } else {
      logger.info('[monitorPublishingPipeline] Pipeline healthy: no stalled content detected');
    }
  }
);

// ============================================================================
// CMS Content Workflow Functions
// ============================================================================
const cmsFunctions = require('./cms-functions');
exports.submitContentUrls = cmsFunctions.submitContentUrls;
exports.transitionContentStatus = cmsFunctions.transitionContentStatus;
exports.batchInspect = cmsFunctions.batchInspect;
exports.triggerAiImageGeneration = cmsFunctions.triggerAiImageGeneration;
exports.deleteGeneratedImageSlot = cmsFunctions.deleteGeneratedImageSlot;
exports.deleteContentGeneratedImage = cmsFunctions.deleteContentGeneratedImage;
exports.createContentItem = cmsFunctions.createContentItem;
exports.getContentItem = cmsFunctions.getContentItem;
exports.recordAdminAudit = cmsFunctions.recordAdminAudit;
exports.saveEditorDraft = cmsFunctions.saveEditorDraft;
exports.updateContentItem = cmsFunctions.updateContentItem;
exports.unpublishContentToInspected = cmsFunctions.unpublishContentToInspected;
exports.deleteContentItem = cmsFunctions.deleteContentItem;
exports.requestContentInspection = cmsFunctions.requestContentInspection;
exports.saveContentSchedule = cmsFunctions.saveContentSchedule;
exports.resetContentReviewState = cmsFunctions.resetContentReviewState;
exports.saveContentImageOrder = cmsFunctions.saveContentImageOrder;
exports.upsertSpeakerEvent = cmsFunctions.upsertSpeakerEvent;
exports.deleteSpeakerEvent = cmsFunctions.deleteSpeakerEvent;
exports.updateGalleryImageMetadata = cmsFunctions.updateGalleryImageMetadata;
exports.createManualGalleryImageRecord = cmsFunctions.createManualGalleryImageRecord;
exports.manageImagePromptConfig = cmsFunctions.manageImagePromptConfig;
exports.publerProxy = cmsFunctions.publerProxy;
exports.linkieProxy = cmsFunctions.linkieProxy;
exports.klaviyoProxy = cmsFunctions.klaviyoProxy;
exports.newsletterSubscribe = cmsFunctions.newsletterSubscribe;
exports.deleteRejectedContent = cmsFunctions.deleteRejectedContent;
exports.softDeleteLivePage = cmsFunctions.softDeleteLivePage;
exports.updateWorkflowAlert = cmsFunctions.updateWorkflowAlert;
exports.getCurrentAdminStatus = cmsFunctions.getCurrentAdminStatus;
exports.bootstrapCurrentUserAdmin = cmsFunctions.bootstrapCurrentUserAdmin;
exports.getAdminDashboardSnapshot = cmsFunctions.getAdminDashboardSnapshot;
exports.recalculateDashboardStats = cmsFunctions.recalculateDashboardStats;
exports.getQueueSnapshot = cmsFunctions.getQueueSnapshot;
exports.getPublishSnapshot = cmsFunctions.getPublishSnapshot;
exports.getOpsHealthSnapshot = cmsFunctions.getOpsHealthSnapshot;
exports.listContentItems = cmsFunctions.listContentItems;
exports.publishContentToBlogs = cmsFunctions.publishContentToBlogs;
exports.generateArticleDraft = cmsFunctions.generateArticleDraft;
exports.generatePreviewImages = cmsFunctions.generatePreviewImages;
exports.generateCuratedArticleImage = cmsFunctions.generateCuratedArticleImage;
exports.deleteCuratedGeneratedImage = cmsFunctions.deleteCuratedGeneratedImage;
exports.aiStackReadiness = cmsFunctions.aiStackReadiness;
exports.maintainDashboardStats = cmsFunctions.maintainDashboardStats;

// Export for testing
exports.validateUrl = validateUrl;
exports.isPrivateIP = isPrivateIP;

// --- PodBean podcast ingestion ---
const PODCAST_FEEDS = [
  { provider: 'azure', url: 'https://feed.podbean.com/PublicCloudWorks/feed.xml' },
];

const podcastParser = new RssParser({
  customFields: {
    item: [
      'enclosure',
      ['itunes:duration', 'itunes:duration'],
      ['itunes:image', 'itunes:image'],
      ['media:content', 'media:content'],
    ],
  },
});

function normalizePodcastId(guid, title) {
  const base = (guid || title || '').toString();
  return base
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

// Pull `mediaUrl` / `mimeType` / `length` out of an RSS podcast item.
// Tries `enclosure` first, then `media:content` (some PodBean feeds).
function extractPodcastMediaFields(item) {
  if (item.enclosure && item.enclosure.url) {
    return {
      mediaUrl: item.enclosure.url,
      mimeType: item.enclosure.type || null,
      fileLength: item.enclosure.length || null,
    };
  }
  if (item['media:content']) {
    const mc = item['media:content'];
    return {
      mediaUrl: (mc.$ && mc.$.url) || mc.url || null,
      mimeType: (mc.$ && mc.$.type) || mc.type || null,
      fileLength: (mc.$ && mc.$.fileSize) || mc.fileSize || null,
    };
  }
  return { mediaUrl: null, mimeType: null, fileLength: null };
}

function extractPodcastImage(item) {
  return (
    (item.itunes && item.itunes.image && item.itunes.image.href) ||
    (item.itunes && typeof item.itunes.image === 'string' && item.itunes.image) ||
    (item.image && item.image.url) ||
    (item['itunes:image'] && item['itunes:image'].href) ||
    null
  );
}

function parsePodcastPublishedDate(item) {
  if (item.isoDate) return new Date(item.isoDate);
  if (item.pubDate) return new Date(item.pubDate);
  return null;
}

async function upsertPodcastEpisode(provider, item) {
  const guid = item.guid || item.id || item.link || item.title;
  const docId = normalizePodcastId(guid, item.title);
  const publishedAt = parsePodcastPublishedDate(item);
  const { mediaUrl, mimeType, fileLength } = extractPodcastMediaFields(item);
  const duration = (item.itunes && item.itunes.duration) || item['itunes:duration'] || null;
  const image = extractPodcastImage(item);

  const payload = {
    id: docId,
    provider,
    title: item.title || '',
    description: item.contentSnippet || item.summary || '',
    longDescription: item['content:encoded'] || item.content || '',
    mediaUrl,
    mimeType,
    length: fileLength,
    duration,
    image,
    link: item.link || null,
    guid: guid || null,
    publishedAt: publishedAt ? admin.firestore.Timestamp.fromDate(publishedAt) : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await admin.firestore().collection('podcasts').doc(docId).set(payload, { merge: true });
  return docId;
}

async function processPodbeanFeed(provider, feedUrl) {
  const feed = await podcastParser.parseURL(feedUrl);
  const items = feed.items || [];
  const results = { processed: 0, errors: [] };
  for (const item of items) {
    try {
      await upsertPodcastEpisode(provider, item);
      results.processed += 1;
    } catch (err) {
      results.errors.push({ title: item.title, error: String(err) });
    }
  }
  return results;
}

exports.fetchPodcastFeeds = onSchedule('every 2 hours', async () => {
  const summary = {};
  for (const cfg of PODCAST_FEEDS) {
    try {
      summary[cfg.provider] = await processPodbeanFeed(cfg.provider, cfg.url);
    } catch (err) {
      summary[cfg.provider] = { processed: 0, error: String(err) };
    }
  }
  logger.info('fetchPodcastFeeds result', summary);
  return summary;
});

exports.fetchPodcastFeedsManual = onRequest(async (req, res) => {
  if (!applyAdminCors(req, res)) return;
  // OWASP A01 — require a verified admin claim before triggering a write path.
  const actor = await requireAdminClaims(req, res, 'editor');
  if (!actor) return;

  try {
    const providerHint = req.query.provider;
    const feeds = PODCAST_FEEDS.filter((c) => (providerHint ? c.provider === providerHint : true));
    const summary = {};
    for (const cfg of feeds) {
      try {
        summary[cfg.provider] = await processPodbeanFeed(cfg.provider, cfg.url);
      } catch (err) {
        summary[cfg.provider] = { processed: 0, error: String(err) };
      }
    }
    res.json({ ok: true, summary });
  } catch (err) {
    logger.error('fetchPodcastFeedsManual error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});
// --- end PodBean ingestion ---

// ============================================================================
// BLOG SCRAPING — Firecrawl-based ingestion for non-RSS HTML blog listing pages
// ============================================================================

/**
 * Non-RSS blog listing pages per provider.
 * These are HTML pages (not RSS feeds) that list articles — scraped via Firecrawl.
 * Each entry specifies the listing page URL and which provider it belongs to.
 */
const BLOG_SCRAPE_SOURCES = [
  // Azure
  {
    provider: 'azure',
    name: 'Microsoft Tech Community Blogs',
    url: 'https://techcommunity.microsoft.com/Blogs/',
  },
  {
    provider: 'azure',
    name: 'Microsoft Partner Center Announcements',
    url: 'https://learn.microsoft.com/en-us/partner-center/announcements/',
  },
  {
    provider: 'azure',
    name: 'Microsoft Partner Blog',
    url: 'https://partner.microsoft.com/en-us/blog',
  },
  // AWS
  {
    provider: 'aws',
    name: 'AWS Blogs Index',
    url: 'https://aws.amazon.com/blogs/',
  },
  // GCP
  {
    provider: 'gcp',
    name: 'Google Cloud Blog',
    url: 'https://cloud.google.com/blog/',
  },
  {
    provider: 'gcp',
    name: 'Google Developers Blog',
    url: 'https://developers.googleblog.com/',
  },
  {
    provider: 'gcp',
    name: 'Firebase Blog',
    url: 'https://firebase.blog/',
  },
  // FinOps
  {
    provider: 'finops',
    name: 'Microsoft FinOps Blog',
    url: 'https://techcommunity.microsoft.com/category/azure/blog/finopsblog',
  },
  {
    provider: 'finops',
    name: 'FinOps Foundation Updates',
    url: 'https://www.finops.org/updates/all-updates/',
  },
  // Terraform
  {
    provider: 'terraform',
    name: 'HashiCorp Blog',
    url: 'https://www.hashicorp.com/en/blog',
  },
  {
    provider: 'terraform',
    name: 'TF Weekly Newsletter',
    url: 'https://www.weekly.tf/',
  },
];

/**
 * Use Firecrawl to scrape a blog listing page and extract individual article links + metadata.
 * Returns an array of { url, title, description, publishedAt, imageUrl } objects.
 */
async function scrapeListingPageWithFirecrawl(apiKey, listingUrl) {
  const app = new FirecrawlApp({ apiKey });

  const result = await app.scrapeUrl(listingUrl, {
    formats: ['extract'],
    extract: {
      schema: {
        type: 'object',
        properties: {
          articles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'Full URL of the article' },
                title: { type: 'string', description: 'Article title' },
                description: { type: 'string', description: 'Article excerpt or description' },
                publishedAt: {
                  type: 'string',
                  description: 'Publication date (ISO 8601 or human-readable)',
                },
                imageUrl: {
                  type: 'string',
                  description: 'Article thumbnail or cover image URL',
                },
                author: { type: 'string', description: 'Author name if present' },
              },
              required: ['url', 'title'],
            },
            description: 'List of blog articles found on the page',
          },
        },
        required: ['articles'],
      },
    },
  });

  if (!result.success) {
    throw new Error(
      `Firecrawl scrape failed for ${listingUrl}: ${result.error || 'unknown error'}`
    );
  }

  const articles = result.extract?.articles || [];
  // Resolve relative URLs
  const base = new URL(listingUrl);
  return articles.map((a) => {
    let url = a.url || '';
    if (url && !url.startsWith('http')) {
      url = url.startsWith('/') ? `${base.origin}${url}` : `${base.origin}/${url}`;
    }
    return { ...a, url };
  });
}

/**
 * Ingest a single article discovered by Firecrawl into the `content` collection.
 * Deduplicates by sourceUrl. Mirrors the same schema as upsertRssItemsAsBlogs.
 */
async function ingestFirecrawlArticle(db, provider, source, article) {
  const sourceUrl = article.url;
  if (!sourceUrl || !sourceUrl.startsWith('http')) return false;

  const title = article.title || 'Untitled';
  let publishedAt = admin.firestore.FieldValue.serverTimestamp();
  let publishedMs = Date.now();
  if (article.publishedAt) {
    const parsed = new Date(article.publishedAt);
    if (!isNaN(parsed.getTime())) {
      publishedAt = parsed;
      publishedMs = parsed.getTime();
    }
  }

  const cmsFunctions = require('./cms-functions');
  const dup = await cmsFunctions.findDuplicateContent(db, {
    url: sourceUrl,
    canonicalUrl: article.canonicalUrl || article.canonical || '',
    title,
    publishedMs,
  });
  if (dup.duplicate) return false;

  const inBlogs = await db.collection('blogs').where('sourceUrl', '==', sourceUrl).limit(1).get();
  if (!inBlogs.empty) return false;

  const summary = (article.description || '').slice(0, 300);
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  const dedupFields = cmsFunctions.buildDedupFields({
    url: sourceUrl,
    canonicalUrl: article.canonicalUrl || article.canonical || '',
    title,
  });

  await db.collection('content').add({
    ...dedupFields,
    'Created At': admin.firestore.FieldValue.serverTimestamp(),
    Author: article.author || source.name,
    'Cloud Provider': providerLabel,
    Title: title,
    Content: article.description || '',
    'CD Url': sourceUrl,
    Summary: summary,
    Slug: generateSlug(title),
    Live: false,
    'Published At': publishedAt,
    Status: 'Draft',
    Tags: [],
    source: 'firecrawl',
    sourceTrustLevel: 'trusted',
    trustedSource: true,
    sourceUrl,
    sourceFeed: source.url,
    storageCollection: 'content',
    category: categorizeItem({ title, contentSnippet: article.description, categories: [] }),
    approvedForNews: false,
    approvedForBlog: false,
    contentStatus: 'ingested',
    inspectTrigger: true,
    aiSummary: '',
    aiTags: [],
    readTime: '3 min',
    contentImageUrl: article.imageUrl || '',
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return true;
}

/**
 * Scheduled function: Scrape non-RSS blog listing pages every 6 hours via Firecrawl.
 * Creates content entries for new articles not yet in the database.
 */
exports.fetchBlogListings = onSchedule(
  {
    schedule: 'every 6 hours',
    secrets: [firecrawlApiKey],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const apiKey = firecrawlApiKey.value();
    const results = { scraped: 0, newArticles: 0, errors: 0 };

    for (const source of BLOG_SCRAPE_SOURCES) {
      try {
        logger.info(`[blogScraper] Scraping ${source.name} (${source.provider}): ${source.url}`);
        const articles = await scrapeListingPageWithFirecrawl(apiKey, source.url);
        results.scraped++;

        let newCount = 0;
        for (const article of articles.slice(0, 20)) {
          const added = await ingestFirecrawlArticle(db, source.provider, source, article);
          if (added) newCount++;
        }
        results.newArticles += newCount;
        logger.info(`[blogScraper] ${source.name}: ${articles.length} found, ${newCount} new`);
      } catch (err) {
        logger.error(`[blogScraper] Failed ${source.name}:`, err.message);
        results.errors++;
      }
    }

    logger.info('[blogScraper] Complete:', results);
    return results;
  }
);

/**
 * Manual HTTP trigger for testing the blog listing scraper.
 * Query params: ?provider=azure|aws|gcp|github|terraform|finops (optional filter)
 */
exports.fetchBlogListingsManual = onRequest(
  { secrets: [firecrawlApiKey], timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;
    // OWASP A01 — require a verified admin claim before triggering a write path.
    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    try {
      const db = admin.firestore();
      const apiKey = firecrawlApiKey.value();
      const providerFilter = req.query.provider;

      const sources = providerFilter
        ? BLOG_SCRAPE_SOURCES.filter((s) => s.provider === providerFilter)
        : BLOG_SCRAPE_SOURCES;

      const results = { scraped: 0, newArticles: 0, errors: 0, detail: {} };

      for (const source of sources) {
        try {
          const articles = await scrapeListingPageWithFirecrawl(apiKey, source.url);
          results.scraped++;

          let newCount = 0;
          for (const article of articles.slice(0, 20)) {
            const added = await ingestFirecrawlArticle(db, source.provider, source, article);
            if (added) newCount++;
          }
          results.newArticles += newCount;
          results.detail[source.name] = { found: articles.length, new: newCount };
        } catch (err) {
          results.errors++;
          results.detail[source.name] = { error: err.message };
        }
      }

      res.json({ ok: true, results });
    } catch (err) {
      logger.error('[blogScraper] Manual trigger error:', err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  }
);
// --- end Blog Listing Scraper ---

// ── MS Skills Hub RSS Scraper ─────────────────────────────────────────────
// Runs every Friday at 9 AM UTC. Reads the Skills Hub RSS feed and writes
// cert lifecycle events (beta launches, retirements, GA announcements) into
// the `certEvents` Firestore collection. Does NOT create blog articles.

const MS_SKILLS_RSS =
  'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=skills-hub-blog';

// Patterns that indicate a certification lifecycle event worth storing
const CERT_EVENT_PATTERNS = [
  { regex: /beta\s+exam|new\s+beta|beta\s+launch/i, type: 'beta_launch' },
  { regex: /retir|expir|sunset/i, type: 'retirement' },
  { regex: /generally\s+available|now\s+live|ga\s+today|exits?\s+beta/i, type: 'ga_launch' },
  { regex: /exam\s+update|certification\s+update|new\s+cert/i, type: 'update' },
];

// Extract exam codes like AZ-104, AI-103, AB-620 from text
function extractExamCodes(text) {
  const matches = text.match(/\b([A-Z]{2,3}-\d{3,4})\b/g);
  return matches ? [...new Set(matches)] : [];
}

exports.scrapeSkillsHubRss = onSchedule(
  {
    schedule: 'every friday 09:00',
    timeZone: 'UTC',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const parser = new RssParser({
      timeout: 15000,
      headers: { 'User-Agent': 'HCW-RssScraper/1.0' },
    });

    logger.info('[skillsHubRss] Starting weekly scrape of MS Skills Hub RSS');

    let feed;
    try {
      feed = await parser.parseURL(MS_SKILLS_RSS);
    } catch (err) {
      logger.error('[skillsHubRss] Failed to fetch RSS feed:', err.message);
      return;
    }

    let written = 0;
    let skipped = 0;

    for (const item of feed.items || []) {
      const fullText = `${item.title || ''} ${item.contentSnippet || ''} ${item.content || ''}`;

      // Only store items that match a cert lifecycle pattern
      const matchedType = CERT_EVENT_PATTERNS.find((p) => p.regex.test(fullText))?.type;
      if (!matchedType) {
        skipped++;
        continue;
      }

      const certCodes = extractExamCodes(fullText);
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();

      // Extract retirement/expiry dates (e.g. "June 30, 2026" or "2026-06-30")
      const dateMatches = fullText.match(
        /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2}/gi
      );

      const docId = item.guid || item.link || item.title;
      const docRef = db
        .collection('certEvents')
        .doc(Buffer.from(docId).toString('base64').slice(0, 128));

      const snap = await docRef.get();
      if (snap.exists) {
        skipped++;
        continue;
      }

      await docRef.set({
        type: matchedType,
        certCodes,
        title: item.title || '',
        summary: item.contentSnippet?.slice(0, 500) || '',
        link: item.link || '',
        pubDate: admin.firestore.Timestamp.fromDate(pubDate),
        mentionedDates: dateMatches || [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'skills-hub-rss',
      });
      written++;
    }

    logger.info(`[skillsHubRss] Done — written: ${written}, skipped: ${skipped}`);
  }
);
// ── end MS Skills Hub RSS Scraper ─────────────────────────────────────────

// ============================================================================
// G5 — AUTO ALT-TEXT FOR ARTICLE IMAGES
// ============================================================================

/**
 * Generate alt-text strings for an array of image URLs using the multimodal
 * path. Gated behind CONTENTFORGE_ALT_TEXT_ENABLED=true.
 *
 * Returns a map of { [originalUrl]: altText } for any URLs that succeed.
 * Failures are skipped silently (alt-text is non-critical).
 */
async function generateAltTexts(imageUrls) {
  if (process.env.CONTENTFORGE_ALT_TEXT_ENABLED !== 'true') {
    logger.info('[alt-text] disabled via env');
    return {};
  }
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    logger.info('[alt-text] no image urls provided');
    return {};
  }

  const results = {};
  const urls = imageUrls.slice(0, 5); // cap at 5 per article to bound cost
  logger.info(`[alt-text] processing ${urls.length} of ${imageUrls.length} image(s)`);

  for (const url of urls) {
    try {
      let imageBase64;
      let mimeType = 'image/jpeg';
      try {
        const buf = await downloadImageFromUrl(url);
        imageBase64 = buf.toString('base64');
        if (url.toLowerCase().endsWith('.png')) mimeType = 'image/png';
        if (url.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
        logger.info(`[alt-text] downloaded ${url} (${buf.length} bytes, ${mimeType})`);
      } catch (err) {
        console.warn(`[alt-text] download failed for ${url}: ${err?.message || err}`);
        continue; // unreachable image — skip
      }

      try {
        const altText = await generateTextResponse({
          parts: [
            {
              text: 'Describe this image in one concise sentence suitable for an HTML alt attribute (max 125 characters). Focus on the visible subject and context. Do not start with "Image of" or "A photo of". Return only the description text, no quotes.',
            },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
          purpose: 'multimodal',
        });

        if (altText && altText.trim().length > 0) {
          results[url] = altText.trim().slice(0, 125);
          logger.info(`[alt-text] ok ${url} -> "${results[url]}"`);
        } else {
          console.warn(`[alt-text] empty response for ${url}`);
        }
      } catch (err) {
        console.warn(`[alt-text] multimodal call failed for ${url}: ${err?.message || err}`);
      }
    } catch (err) {
      console.warn(`[alt-text] unexpected error for ${url}: ${err?.message || err}`);
    }
  }

  logger.info(`[alt-text] completed: ${Object.keys(results).length} of ${urls.length} succeeded`);
  return results;
}

// ============================================================================
// R8 — GENERATE POST CONTENT (deferred from ingest, triggered at publish time)
// ============================================================================

/**
 * The two inputs the analyser can work from, across the field spellings the
 * various ingest paths write. Either one is sufficient; the caller rejects the
 * request only when both are empty.
 */
function readPostContentSources(data) {
  return {
    markdownContent: data.content || data.postContent || '',
    sourceUrl: data.sourceUrl || data.url || '',
  };
}

/**
 * HTTP Cloud Function: generate or regenerate the postContent field for an
 * existing content doc. Called by the admin portal "Generate post body" button.
 *
 * POST body: { articleId: string, collection?: 'content' | 'blogs' }
 * Returns: { ok: true, wordCount: number } or { ok: false, error: string }
 */
/**
 * Validate the generatePostContent request shape. Returns an error string or
 * null. The collection allowlist exists so callers can never write into
 * arbitrary collections via the Admin SDK (OWASP A01).
 */
function validateGeneratePostContentRequest(articleId, collection) {
  if (!articleId || typeof articleId !== 'string') return 'articleId is required';
  if (collection !== 'content') return 'collection must be "content"';
  return null;
}

exports.generatePostContent = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', secrets: aiSecrets },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }
    // OWASP A01 — require a verified admin claim before triggering a write path.
    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    const { articleId, collection = 'content' } = req.body || {};
    const requestError = validateGeneratePostContentRequest(articleId, collection);
    if (requestError) {
      res.status(400).json({ ok: false, error: requestError });
      return;
    }

    const db = admin.firestore();
    const docRef = db.collection(collection).doc(articleId);
    const snap = await docRef.get();

    if (!snap.exists) {
      res.status(404).json({ ok: false, error: `Document not found: ${collection}/${articleId}` });
      return;
    }

    const data = snap.data();
    const { markdownContent, sourceUrl } = readPostContentSources(data);

    if (!markdownContent && !sourceUrl) {
      res.status(400).json({ ok: false, error: 'Document has no content or sourceUrl to analyse' });
      return;
    }

    try {
      // Run the full analysis including postContent, regardless of the
      // CONTENTFORGE_METADATA_ONLY flag (that flag only applies to ingest).
      const savedFlag = process.env.CONTENTFORGE_METADATA_ONLY;
      process.env.CONTENTFORGE_METADATA_ONLY = 'false';

      const analysis = await analyzeWithGemini(
        sourceUrl || `urn:articleId:${articleId}`,
        markdownContent.substring(0, 15000)
      );

      process.env.CONTENTFORGE_METADATA_ONLY = savedFlag || '';

      const { postContent } = analysis.metadata || {};
      if (!postContent) {
        res.status(500).json({ ok: false, error: 'Model returned no postContent' });
        return;
      }

      await docRef.update({
        postContent,
        postContentGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
        postContentModel: analysis.model || 'unknown',
      });

      logger.info(`[generatePostContent] ✅ ${collection}/${articleId}`, {
        wordCount: postContent.split(/\s+/).length,
      });
      res.json({ ok: true, wordCount: postContent.split(/\s+/).length });
    } catch (err) {
      logger.error(`[generatePostContent] ❌ ${collection}/${articleId}`, err);
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  }
);

// ============================================================================
// G2 — FALLBACK IMAGE PROVIDER (Replicate outage resilience)
// ============================================================================

/**
 * Wrap callReplicateApi with an OpenAI Images fallback. Only active when
 * CONTENTFORGE_IMAGE_FALLBACK_PROVIDER=openai. On any Replicate error after
 * exhausting retries, attempts one call to OpenAI gpt-image-1 medium.
 *
 * @param {string} apiKey   Replicate API key
 * @param {string} prompt   Image generation prompt
 * @returns {Promise<string>} URL of the generated image
 */
async function callReplicateWithFallback(apiKey, prompt) {
  try {
    return await callReplicateApi(apiKey, prompt);
  } catch (replicateErr) {
    const fallbackProvider = process.env.CONTENTFORGE_IMAGE_FALLBACK_PROVIDER || 'none';
    if (fallbackProvider !== 'openai') throw replicateErr;

    const openAiKey = process.env.OPENAI_API_KEY;
    if (!openAiKey) {
      logger.warn('[image-fallback] OPENAI_API_KEY not set — cannot fall back');
      throw replicateErr;
    }

    logger.warn('[image-fallback] Replicate failed — falling back to gpt-image-1', {
      error: replicateErr.message,
    });

    const axios = require('axios');
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1792x1024',
        quality: 'medium',
      },
      {
        timeout: 120000,
        headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      }
    );

    const imageUrl = response.data?.data?.[0]?.url;
    if (!imageUrl) throw new Error('OpenAI fallback returned no image URL');
    logger.info('[image-fallback] gpt-image-1 fallback succeeded');
    return imageUrl;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AI ENGINE  — aiProxy · mcpProxy · testAiProvider · syncMcpTools
// Admin-only HTTP functions that power the /admin/ai-engine page.
// All endpoints require a valid Firebase ID token with adminRole ≥ viewer.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * aiProxy — Routes a chat request to any configured AI provider.
 *
 * POST body:
 *   { provider: string, model?: string, prompt: string,
 *     systemPrompt?: string, source?: string }
 *
 * Response:
 *   { ok: true, text, promptTokens, completionTokens, estimatedCostUsd,
 *     provider, model, latencyMs }
 */
exports.aiProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 90,
    memory: '256MiB',
    secrets: [replicateApiKey, ...aiSecrets],
  },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;

    const actor = await requireAdminClaims(req, res, 'viewer');
    if (!actor) return;

    const { provider, model, prompt, systemPrompt = '', source = 'api' } = req.body || {};
    if (!provider || !prompt) {
      return res.status(400).json({ ok: false, error: '`provider` and `prompt` are required' });
    }

    const t0 = Date.now();
    try {
      const result = await callProvider({ provider, model, prompt, systemPrompt });
      const latencyMs = Date.now() - t0;
      const estimatedCostUsd = getCostEstimate(
        provider,
        model || '',
        result.promptTokens,
        result.completionTokens
      );

      // Log usage to Firestore (non-blocking)
      admin
        .firestore()
        .collection('ai_usage')
        .add({
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          provider,
          model: model || 'default',
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: (result.promptTokens || 0) + (result.completionTokens || 0),
          estimatedCostUsd,
          source,
          userId: actor.uid,
          latencyMs,
        })
        .catch((err) => logger.warn('[aiProxy] usage log failed', { message: err.message }));

      return res.json({
        ok: true,
        text: result.text,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        estimatedCostUsd,
        provider,
        model: model || 'default',
        latencyMs,
      });
    } catch (err) {
      logger.error('[aiProxy] error', { provider, model, message: err.message });
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * testAiProvider — Sends a tiny "hello" probe to verify a provider is reachable.
 *
 * POST body: { providerId: string }
 * Updates ai_providers/{providerId} with { status, lastTested, lastError }.
 * Response: { ok, latencyMs, model, status }
 */
exports.testAiProvider = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [replicateApiKey, ...aiSecrets],
  },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;

    const actor = await requireAdminClaims(req, res, 'viewer');
    if (!actor) return;

    const { providerId } = req.body || {};
    if (!providerId) return res.status(400).json({ ok: false, error: '`providerId` required' });

    const db = admin.firestore();
    const docRef = db.collection('ai_providers').doc(providerId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Provider not found' });

    const providerData = snap.data();
    const model = providerData.defaultModel || undefined;

    const t0 = Date.now();
    try {
      await callProvider({
        provider: providerId,
        model,
        prompt: 'Reply with exactly the word PONG and nothing else.',
      });
      const latencyMs = Date.now() - t0;

      await docRef.update({
        status: 'connected',
        lastTested: admin.firestore.FieldValue.serverTimestamp(),
        lastError: null,
        latencyMs,
      });

      return res.json({ ok: true, latencyMs, model, status: 'connected' });
    } catch (err) {
      const latencyMs = Date.now() - t0;
      await docRef
        .update({
          status: 'error',
          lastTested: admin.firestore.FieldValue.serverTimestamp(),
          lastError: err.message,
          latencyMs,
        })
        .catch(() => {});
      return res.status(200).json({ ok: false, latencyMs, status: 'error', error: err.message });
    }
  }
);

/**
 * refreshPlaudToken — Scheduled job that rotates the Plaud MCP OAuth access token.
 *
 * Plaud access tokens expire every ~24h. We run every 12h to keep a fresh token in
 * Firestore at mcp_servers/plaud, using the stored refresh_token. The refresh_token
 * is itself rotated on each call (Plaud returns a new pair), and lasts ~7 days.
 *
 * If the refresh fails (revoked, refresh_token expired, etc.) we flip the doc
 * status to 'disconnected' so the admin UI shows the reconnect prompt.
 */
const PLAUD_REFRESH_URL =
  'https://platform.plaud.ai/developer/api/oauth/third-party/access-token/refresh';

async function refreshPlaudTokenOnce() {
  const ref = admin.firestore().collection('mcp_servers').doc('plaud');
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn('refreshPlaudToken: mcp_servers/plaud not found');
    return { ok: false, reason: 'missing_doc' };
  }
  const data = snap.data() || {};
  const refreshToken = data.oauthRefreshToken;
  if (!refreshToken) {
    logger.warn('refreshPlaudToken: no oauthRefreshToken stored');
    await ref.set({ status: 'disconnected' }, { merge: true });
    return { ok: false, reason: 'missing_refresh_token' };
  }
  try {
    const res = await fetch(PLAUD_REFRESH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ refresh_token: refreshToken }).toString(),
    });
    const body = await res.text();
    if (!res.ok) {
      logger.error('refreshPlaudToken failed', { status: res.status, body: body.slice(0, 300) });
      await ref.set(
        { status: 'disconnected', lastTokenRefreshError: body.slice(0, 500) },
        { merge: true }
      );
      return { ok: false, reason: `http_${res.status}` };
    }
    const parsed = JSON.parse(body);
    if (!parsed.access_token) {
      throw new Error('No access_token in response');
    }
    const expiresInSec = Number(parsed.expires_in) || 86400;
    await ref.set(
      {
        oauthToken: parsed.access_token,
        oauthRefreshToken: parsed.refresh_token || refreshToken,
        oauthExpiresAt: Date.now() + expiresInSec * 1000,
        status: 'connected',
        lastTokenRefresh: admin.firestore.FieldValue.serverTimestamp(),
        lastTokenRefreshError: admin.firestore.FieldValue.delete(),
      },
      { merge: true }
    );
    logger.info('refreshPlaudToken: success', { expiresInSec });
    return { ok: true };
  } catch (err) {
    logger.error('refreshPlaudToken exception', { error: err.message });
    await ref.set({ status: 'disconnected', lastTokenRefreshError: err.message }, { merge: true });
    return { ok: false, reason: 'exception' };
  }
}

exports.refreshPlaudToken = onSchedule(
  {
    schedule: 'every 12 hours',
    region: 'us-central1',
    timeoutSeconds: 60,
    retryCount: 2,
  },
  async () => {
    await refreshPlaudTokenOnce();
  }
);

/**
 * refreshPlaudTokenNow — On-demand HTTPS callable so admins can force a refresh.
 * Useful from the admin Recordings Hub "Refresh now" button.
 */
exports.refreshPlaudTokenNow = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    // Verified adminRole custom claim (legacy `admin` claim was retired) — editor minimum.
    const adminRole = String(request.auth?.token?.adminRole || '');
    const roleLevel = ADMIN_ROLES[adminRole.toUpperCase()]?.level || 0;
    if (roleLevel < ADMIN_ROLES.EDITOR.level) {
      throw new HttpsError('permission-denied', 'Admins only');
    }
    const result = await refreshPlaudTokenOnce();
    if (!result.ok) {
      throw new HttpsError('internal', `Refresh failed: ${result.reason}`);
    }
    return { ok: true };
  }
);

// ── Shared MCP request plumbing ──────────────────────────────────────────────
//
// mcpProxy and syncMcpTools differ only in the RPC method they call and what
// they do with the result. Everything below was duplicated verbatim between
// them, which is also why both handlers were over the complexity limit.

/**
 * Auth header for an MCP server. A stored oauthToken wins over an env-var API
 * key. The BOM strip matters: tokens pasted from a file written on Windows can
 * carry U+FEFF, which a server rejects as a malformed bearer token.
 */
function resolveMcpAuthHeaders({ oauthToken, apiKeyEnvVar }) {
  let bearerToken = oauthToken || (apiKeyEnvVar ? process.env[apiKeyEnvVar] : null) || null;
  if (typeof bearerToken === 'string') {
    bearerToken = bearerToken.replace(/^\ufeff/, '').trim();
  }
  return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
}

/** Dispatch a JSON-RPC body over whichever transport the server is configured for. */
function callMcpRpc({ serverId, url, transport, authHeaders, rpcBody }) {
  if (transport === 'sse') {
    return mcpSseRpc(url, authHeaders, rpcBody);
  }
  return mcpHttpRpc(serverId, url, rpcBody, authHeaders);
}

/** Flatten an MCP result envelope — { content: [{ type:'text', text }] } — to text. */
function extractMcpText(rawResult) {
  if (!Array.isArray(rawResult?.content)) {
    return JSON.stringify(rawResult ?? {});
  }
  return rawResult.content
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Failure body for a caller-visible MCP error. These go out as HTTP 200 with
 * ok:false — the proxy call itself succeeded, the upstream tool did not.
 */
function mcpFailureBody(authFailure, extra = {}) {
  return {
    ok: false,
    error: authFailure.error,
    ...(authFailure.code ? { code: authFailure.code } : {}),
    ...extra,
  };
}

/** Normalize a tools/list response to the shape stored on the server doc. */
function normalizeMcpTools(rpcResult) {
  const tools = rpcResult?.result?.tools || [];
  return tools.map((t) => ({
    name: t.name || '',
    description: t.description || '',
    inputSchema: t.inputSchema || {},
  }));
}

/** Record a failed probe on the server doc. Best-effort: never masks the original error. */
function markMcpServerError(docRef, errMsg) {
  return docRef
    .update({
      status: 'error',
      lastTested: admin.firestore.FieldValue.serverTimestamp(),
      lastError: errMsg,
    })
    .catch(() => {});
}


/**
 * mcpProxy — Proxies an MCP tool call server-side so credentials never reach the browser.
 *
 * Transport modes (read from mcp_servers Firestore document):
 *   • transport='http' (default) — Streamable HTTP, with automatic session-handshake retry
 *   • transport='sse'            — SSE relay (Firecrawl, Replicate)
 *
 * Auth modes:
 *   • apiKeyEnvVar  — reads a Bearer token from a Cloud Functions secret env var
 *   • oauthToken    — reads a stored OAuth access token from Firestore (e.g. Plaud)
 *
 * POST body: { serverId: string, tool: string, arguments: object }
 * Response:  { ok, result: string, raw: any }
 */
exports.mcpProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [replicateApiKey, vpsApiToken, firecrawlApiKey, ...aiSecrets],
  },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;

    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    const { serverId, tool, arguments: toolArgs = {} } = req.body || {};
    if (!serverId || !tool) {
      return res.status(400).json({ ok: false, error: '`serverId` and `tool` are required' });
    }

    const db = admin.firestore();
    const snap = await db.collection('mcp_servers').doc(serverId).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'MCP server not found' });

    const { url, apiKeyEnvVar, oauthToken, enabled, transport } = snap.data();
    if (!enabled) return res.status(403).json({ ok: false, error: 'MCP server is disabled' });
    if (!url) return res.status(400).json({ ok: false, error: 'Server has no URL configured' });

    // Resolve auth token — stored oauthToken takes priority over env-var API key
    const authHeaders = resolveMcpAuthHeaders({ oauthToken, apiKeyEnvVar });

    const rpcBody = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: tool, arguments: toolArgs },
      id: 2,
    };

    let rpcResult;
    try {
      rpcResult = await callMcpRpc({ serverId, url, transport, authHeaders, rpcBody });
    } catch (err) {
      logger.error('[mcpProxy] error', { serverId, tool, message: err.message });
      const authFailure = getMcpAuthError(err, 'MCP tool call failed', serverId);
      return res.status(200).json(mcpFailureBody(authFailure));
    }

    if (rpcResult?.error) {
      return res.status(200).json({
        ok: false,
        error: rpcResult.error.message || 'MCP error',
        code: rpcResult.error.code,
      });
    }

    const rawResult = rpcResult?.result;
    const text = extractMcpText(rawResult);

    if (rawResult?.isError) {
      return res.status(200).json({ ok: false, error: text || 'MCP tool error' });
    }

    return res.json({ ok: true, result: text, raw: rawResult });
  }
);

/**
 * syncMcpTools — Fetches the tool manifest from an MCP server and stores it in Firestore.
 *
 * Transport modes (read from mcp_servers Firestore document):
 *   • transport='http' (default) — Streamable HTTP with automatic session-handshake
 *   • transport='sse'            — SSE relay (Firecrawl, Replicate)
 *
 * POST body: { serverId: string }
 * Response:  { ok, tools: [{ name, description }] }
 */
exports.syncMcpTools = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [replicateApiKey, vpsApiToken, firecrawlApiKey],
  },
  async (req, res) => {
    if (!applyAdminCors(req, res)) return;

    const actor = await requireAdminClaims(req, res, 'editor');
    if (!actor) return;

    const { serverId } = req.body || {};
    if (!serverId) return res.status(400).json({ ok: false, error: '`serverId` required' });

    const db = admin.firestore();
    const docRef = db.collection('mcp_servers').doc(serverId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'MCP server not found' });

    const { url, apiKeyEnvVar, oauthToken, transport } = snap.data();
    if (!url) return res.status(400).json({ ok: false, error: 'Server has no URL configured' });

    const authHeaders = resolveMcpAuthHeaders({ oauthToken, apiKeyEnvVar });

    const rpcBody = { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 };

    let rpcResult;
    try {
      rpcResult = await callMcpRpc({ serverId, url, transport, authHeaders, rpcBody });
    } catch (err) {
      const errMsg = err.message || 'MCP tool sync failed';
      logger.error('[syncMcpTools] error', { serverId, url, message: errMsg });
      await markMcpServerError(docRef, errMsg);
      const authFailure = getMcpAuthError(err, errMsg, serverId);
      return res.status(200).json(mcpFailureBody(authFailure, { tools: [] }));
    }

    if (rpcResult?.error) {
      const errMsg = rpcResult.error.message || `MCP error ${rpcResult.error.code ?? ''}`.trim();
      await markMcpServerError(docRef, errMsg);
      return res.status(200).json({ ok: false, error: errMsg, tools: [] });
    }

    const normalized = normalizeMcpTools(rpcResult);

    await docRef.update({
      tools: normalized,
      status: 'connected',
      lastTested: admin.firestore.FieldValue.serverTimestamp(),
      lastError: null,
    });

    return res.json({ ok: true, tools: normalized });
  }
);

// ── Publish Snapshot ──────────────────────────────────────────────────────────
// Reads the certifications and speakerevents Firestore collections and writes a
// denormalized snapshot to _snapshots/{collection}. The About page and the
// speaking-events widget read from these documents so new admin changes are
// visible to visitors without a full site redeploy.
exports.publishSnapshot = onRequest(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const decoded = await requireAdminClaims(req, res, 'editor');
    if (!decoded) return;

    function serializeVal(value) {
      if (value === null || value === undefined) return value;
      if (typeof value === 'object' && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
      }
      if (Array.isArray(value)) return value.map(serializeVal);
      if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = serializeVal(v);
        return out;
      }
      return value;
    }

    const db = admin.firestore();
    const generatedAt = new Date().toISOString();
    const results = {};

    for (const collectionName of ['certifications', 'speakerevents']) {
      const snap = await db.collection(collectionName).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...serializeVal(d.data()) }));
      await db.collection('_snapshots').doc(collectionName).set({ generatedAt, items });
      results[collectionName] = items.length;
    }

    logger.info('publishSnapshot completed', { ...results, by: decoded.uid });
    return res.json({ ...results, generatedAt });
  }
);

// ── Labs Platform (VPS lab execution) ────────────────────────────────────────
const labsFunctions = require('./labs-functions');
exports.enqueueLabJob = labsFunctions.enqueueLabJob;
exports.getLabsSnapshot = labsFunctions.getLabsSnapshot;
exports.cancelLabJob = labsFunctions.cancelLabJob;
