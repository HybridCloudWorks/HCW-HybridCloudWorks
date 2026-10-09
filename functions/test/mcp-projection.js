/**
 * What Cosmos answers for lib/credentials/sources.js MCP_SERVER_QUERY, over
 * in-memory documents, for memoryStore's `query` option.
 *
 * The SELECT list, field for field: `c.id`, `c.status`, `c.lastTokenRefresh`,
 * `c.oauth.status AS oauthStatus`, `c.oauth.connectedAt AS oauthConnectedAt`,
 * `c.oauth.refreshedAt AS oauthRefreshedAt`, and `hasToken`, which Cosmos
 * computes as `IS_STRING(c.oauthToken) AND LENGTH(c.oauthToken) > 0`. A
 * property that is undefined is left out of the row, as Cosmos leaves it
 * out. sources.test.js holds the query text to this list, so the emulation
 * cannot drift from the query it stands in for.
 */

export const PROJECTED_FIELDS = Object.freeze([
  'id',
  'status',
  'lastTokenRefresh',
  'oauthStatus',
  'oauthConnectedAt',
  'oauthRefreshedAt',
  'hasToken',
]);

export function projectMcpServers({ container, parameters, docs }) {
  if (container !== 'mcp_servers') return [];
  const ids = parameters.find((parameter) => parameter.name === '@ids')?.value ?? [];
  return docs
    .filter((doc) => ids.includes(doc.id))
    .map((doc) => {
      const row = {
        id: doc.id,
        status: doc.status,
        lastTokenRefresh: doc.lastTokenRefresh,
        oauthStatus: doc.oauth?.status,
        oauthConnectedAt: doc.oauth?.connectedAt,
        oauthRefreshedAt: doc.oauth?.refreshedAt,
        hasToken: typeof doc.oauthToken === 'string' && doc.oauthToken.length > 0,
      };
      return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
    });
}
