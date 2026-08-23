/**
 * integrations-http.js — publerProxy, klaviyoProxy, linkieProxy (#180).
 * Semantics and the security boundary in lib/integrations/rest-proxy.js.
 *
 * RPC-style route names, matching what the admin UI posts to.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readKey } from '../lib/ai/router.js';
import { createRestProxy, createIntegration } from '../lib/integrations/rest-proxy.js';
import { PUBLER_API_BASE_URL } from '../lib/timers/publer-sync.js';

const proxy = () => createRestProxy({ guard: getDefaultGuard(), readKey });

// Base URL and auth shape reused from the client that has been calling Publer
// since the port, rather than restated here where the two could drift.
const PUBLER = createIntegration({
  name: 'Publer',
  baseUrl: PUBLER_API_BASE_URL,
  keyEnv: 'PUBLER_API_KEY',
  extraEnv: ['PUBLER_WORKSPACE_ID'],
  headers: ({ apiKey, env, readKey: read }) => ({
    Authorization: `Bearer-API ${apiKey}`,
    'Publer-Workspace-Id': read(env, 'PUBLER_WORKSPACE_ID'),
  }),
});

// The admin UI sends paths already prefixed with /api (e.g. '/api/lists/'), so
// the base is the bare host. `revision` is required by Klaviyo on every request
// and pins the API contract — without it the account's default is used, which
// can change under the application without a deploy.
const KLAVIYO = createIntegration({
  name: 'Klaviyo',
  baseUrl: 'https://a.klaviyo.com',
  keyEnv: 'KLAVIYO_PRIVATE_KEY',
  headers: ({ apiKey }) => ({
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: '2024-10-15',
    accept: 'application/json',
  }),
});

// Base URL and allowlist taken from Site-Main's working proxy
// (functions/cms/proxies.js), not inferred. The first version of this file
// guessed `https://api.linkie.bio` from the env-var name and was wrong: the API
// is served from the app host under a version prefix. Overridable because
// Site-Main found the published docs Cloudflare-gated from non-browser clients,
// so the endpoint may have to be corrected without a code change.
//
// Linkie is the one integration here with an allowlist. Its admin page calls a
// small known set, and the key's scopes (profiles read+write, analytics read,
// posts read+write) are broader than any single screen needs — so naming the
// endpoints is worth more than trusting the caller.
const LINKIE = createIntegration({
  name: 'Linkie',
  baseUrl: process.env.LINKIE_API_BASE_URL || 'https://app.linkie.bio/api/v1',
  keyEnv: 'LINKIE_API_KEY',
  headers: ({ apiKey }) => ({ Authorization: `Bearer ${apiKey}` }),
  allowedPaths: {
    paths: ['/profiles', '/analytics/traffic-stats'],
    // Posts are profile-scoped: Linkie has no top-level /links or /analytics
    // endpoint, which is the detail an inferred base URL would have missed too.
    patterns: [/^\/profiles\/[^/]+\/posts$/, /^\/profiles\/[^/]+\/posts\/[^/]+$/],
  },
});

for (const [name, integration] of [
  ['publerProxy', PUBLER],
  ['klaviyoProxy', KLAVIYO],
  ['linkieProxy', LINKIE],
]) {
  httpRoute(name, {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: name,
    handler: (request, context) => proxy()(integration)(request, context),
  });
}
