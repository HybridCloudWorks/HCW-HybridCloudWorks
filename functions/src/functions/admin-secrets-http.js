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
import { createDoc, queryDocs, readDoc, replaceDocIfMatch } from '../lib/cosmos-client.js';
import { createAdminSecretHandlers } from '../lib/admin-secrets.js';
import { syncCredentialReminders } from '../lib/credentials/reminders.js';

// createDoc and replaceDocIfMatch, not upsertDoc: the state document is
// written under its ETag, one secret's record at a time (updateSecretRecord).
// After a recorded write the credential register's reminders are synced, so a
// rotation moves its reminder at once (review of #1039); the sync reads the
// MCP servers by query, hence queryDocs in its store only.
const handlers = () =>
  createAdminSecretHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, createDoc, replaceDocIfMatch },
    afterSecretWrite: () =>
      syncCredentialReminders({ store: { readDoc, queryDocs, createDoc, replaceDocIfMatch } }),
  });

httpRouteByMethod('cmsSecrets', {
  authLevel: 'anonymous',
  route: 'cms/secrets',
  handlers: {
    GET: (request, context) => handlers().getSecretStatus(request, context),
    PUT: (request, context) => handlers().putSecret(request, context),
  },
});
