/**
 * public-content-manifest.js — the pre-render manifest source (T-718).
 * Registration only; semantics live in lib/public-content-manifest.js.
 *
 * No guard, and no rate limit. Both are deliberate and explained at length in
 * the lib: the route serves only published documents projected to an explicit
 * field allowlist, and rate-limiting it would make it unreachable from the
 * per-run origin window `publish-content-manifest.yml` uses — the same window
 * `deploy-functions.yml` already opens to probe `/api/health`.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { queryDocs } from '../lib/cosmos-client.js';
import { createPublicContentManifestHandlers } from '../lib/public-content-manifest.js';

const handlers = () => createPublicContentManifestHandlers({ store: { queryDocs } });

httpRoute('publicGetContentManifest', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/content-manifest',
  handler: (request, context) => handlers().getManifest(request, context),
});
