/**
 * legacy-blogs-telemetry-http.js — the counter that will justify retiring the
 * `blogs` fallback container. Registration only; semantics in
 * lib/legacy-blogs-telemetry.js.
 *
 * Guarded, unlike the Firebase original. Its only caller is an admin page, so
 * an anonymous write endpoint bought nothing and let anyone both amplify writes
 * and poison the evidence.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createLegacyBlogsTelemetryHandlers } from '../lib/legacy-blogs-telemetry.js';

const handlers = () =>
  createLegacyBlogsTelemetryHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc },
  });

httpRoute('recordLegacyBlogsRead', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/telemetry/legacy-blogs-read',
  handler: (request, context) => handlers().recordLegacyBlogsRead(request, context),
});
