/**
 * admin-secrets-http.js — the API-keys page's two routes. Registration only;
 * semantics in lib/admin-secrets.js.
 *
 * Both are `super_admin`, which is stricter than every other admin route here.
 * The read is gated as tightly as the write because the STATUS is itself an
 * inventory: which integrations exist, and which are currently unconfigured.
 * `secrets-health.js` makes the same call for the same reason — it puts a count
 * on the anonymous `/api/health` and keeps the names for an authenticated
 * surface. This is that surface.
 */
import { httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createAdminSecretHandlers } from '../lib/admin-secrets.js';

const handlers = () =>
  createAdminSecretHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc },
  });

httpRouteByMethod('cmsSecrets', {
  authLevel: 'anonymous',
  route: 'cms/secrets',
  handlers: {
    GET: (request, context) => handlers().getSecretStatus(request, context),
    PUT: (request, context) => handlers().putSecret(request, context),
  },
});
