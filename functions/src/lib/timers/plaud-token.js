/**
 * plaud-token.js — `refreshPlaudToken`, every 12 hours: rotates the Plaud MCP
 * OAuth access token stored on `mcp_servers/plaud` using its refresh token
 * (Plaud returns a new pair each time; access ~24 h, refresh ~7 days). A
 * failed refresh flips the document to `disconnected` so the admin UI shows
 * the reconnect prompt.
 *
 * Ported from Site-Main index.js (088f458). The tokens live in the document,
 * as they did upstream — no app secret is involved.
 */

export const PLAUD_REFRESH_URL =
  'https://platform.plaud.ai/developer/api/oauth/third-party/access-token/refresh';

export function createPlaudTokenRefresh({
  store,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log = {},
}) {
  const patch = (updates) => store.patchDoc('mcp_servers', 'plaud', updates);

  async function run() {
    const doc = await store.readDoc('mcp_servers', 'plaud', 'plaud');
    if (!doc) {
      log.warn?.('[refreshPlaudToken] mcp_servers/plaud not found');
      return { ok: false, reason: 'missing_doc' };
    }
    const refreshToken = doc.oauthRefreshToken;
    if (!refreshToken) {
      log.warn?.('[refreshPlaudToken] no oauthRefreshToken stored');
      await patch({ status: 'disconnected' });
      return { ok: false, reason: 'missing_refresh_token' };
    }
    try {
      const res = await fetchImpl(PLAUD_REFRESH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ refresh_token: refreshToken }).toString(),
      });
      const body = await res.text();
      if (!res.ok) {
        log.error?.(`[refreshPlaudToken] failed: HTTP ${res.status}`);
        await patch({ status: 'disconnected', lastTokenRefreshError: body.slice(0, 500) });
        return { ok: false, reason: `http_${res.status}` };
      }
      const parsed = JSON.parse(body);
      if (!parsed.access_token) throw new Error('No access_token in response');
      const expiresInSec = Number(parsed.expires_in) || 86400;
      await patch({
        oauthToken: parsed.access_token,
        oauthRefreshToken: parsed.refresh_token || refreshToken,
        oauthExpiresAt: now().getTime() + expiresInSec * 1000,
        status: 'connected',
        lastTokenRefresh: now().toISOString(),
        lastTokenRefreshError: null,
      });
      log.log?.(`[refreshPlaudToken] success (expires in ${expiresInSec}s)`);
      return { ok: true, expiresInSec };
    } catch (err) {
      log.error?.(`[refreshPlaudToken] exception: ${err?.message || err}`);
      await patch({
        status: 'disconnected',
        lastTokenRefreshError: String(err?.message || err).slice(0, 500),
      });
      return { ok: false, reason: 'exception' };
    }
  }
  return { run };
}
