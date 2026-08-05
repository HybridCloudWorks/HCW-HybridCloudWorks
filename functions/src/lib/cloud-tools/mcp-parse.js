/**
 * MCP response parsing and result normalisation for Cloud Tools.
 *
 * Ported from Site-Main `functions/cloud-tools-mcp.js` (commit 07f3123). These
 * are the pure halves of that module — everything that shapes a response
 * without performing I/O. The transport half (session handshake, `fetch`,
 * server registry lookup against the `mcp_servers` collection) ports separately
 * with the handlers, because it needs the Cosmos client.
 *
 * Nothing here is Firebase- or Azure-specific, so the port is a straight
 * CommonJS → ESM conversion with no behaviour change.
 */

/**
 * The default MCP servers, used when the `mcp_servers` collection has no entry.
 * Both are public, unauthenticated documentation endpoints.
 */
export const DEFAULT_CLOUD_TOOL_MCP_SERVERS = {
  'aws-knowledge-mcp': {
    url: 'https://knowledge-mcp.global.api.aws',
    transport: 'http',
    enabled: true,
  },
  'microsoftdocs-mcp': {
    url: 'https://learn.microsoft.com/api/mcp',
    transport: 'http',
    enabled: true,
  },
};

/**
 * Parse an MCP response body, which arrives as either plain JSON or as
 * Server-Sent Events depending on the server and the negotiated Accept header.
 *
 * Returns `{}` rather than throwing on anything unparseable: a documentation
 * lookup is an enrichment, and a malformed response from a third-party docs
 * server must degrade to "no references" rather than fail the request that
 * triggered it.
 *
 * @param {string} bodyText
 * @returns {object}
 */
export function parseMcpResponseBody(bodyText) {
  const text = String(bodyText || '').trim();
  if (!text) return {};

  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      // Fall through to SSE parsing — a body can start with '{' and still be
      // an event stream.
    }
  }

  const dataLines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  const joined = dataLines.join('\n');
  if (!joined) return {};

  try {
    return JSON.parse(joined);
  } catch {
    return {};
  }
}

/**
 * Flatten an MCP tool result into plain text.
 *
 * @param {unknown} result
 * @returns {string}
 */
export function toTextContent(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;

  if (Array.isArray(result?.content)) {
    return result.content
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

/**
 * Normalise an AWS Knowledge MCP search result to the wire shape.
 * Capped at three results, matching the original.
 *
 * @param {unknown} result
 * @returns {Array<{title: string, url: string, snippet: string, source: string}>}
 */
export function normalizeAwsSearchResults(result) {
  const payload = result?.structuredContent || result || {};
  const results = Array.isArray(payload?.results) ? payload.results : [];

  return results.slice(0, 3).map((item) => ({
    title: item.title || 'AWS documentation',
    url: item.url || '',
    snippet: item.context || '',
    source: 'aws-knowledge-mcp',
  }));
}

/**
 * Normalise a Microsoft Learn MCP search result to the wire shape.
 *
 * Note the field names differ from the AWS shape — `contentUrl`/`content`
 * rather than `url`/`context`. That asymmetry is in the upstream APIs, not a
 * transcription slip.
 *
 * @param {unknown} result
 * @returns {Array<{title: string, url: string, snippet: string, source: string}>}
 */
export function normalizeMicrosoftSearchResults(result) {
  const payload = result?.structuredContent || result || {};
  const results = Array.isArray(payload?.results) ? payload.results : [];

  return results.slice(0, 3).map((item) => ({
    title: item.title || 'Microsoft documentation',
    url: item.contentUrl || '',
    snippet: item.content || '',
    source: 'microsoftdocs-mcp',
  }));
}
