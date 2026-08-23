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

const LINKIE = createIntegration({
  name: 'Linkie',
  baseUrl: 'https://api.linkie.bio',
  keyEnv: 'LINKIE_API_KEY',
  headers: ({ apiKey }) => ({ Authorization: `Bearer ${apiKey}` }),
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
