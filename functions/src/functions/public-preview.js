/**
 * public-preview.js — registration for the signed staging-preview route
 * (api-surface.json rest.publicReads; T-606). Registration only; the token
 * verification, status gate and indistinguishable-404 semantics live in
 * lib/public-preview.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { readDoc } from '../lib/cosmos-client.js';
import { createPublicPreviewHandlers } from '../lib/public-preview.js';

const handlers = () => createPublicPreviewHandlers({ store: { readDoc } });

httpRoute('publicGetPreview', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/preview/{contentId}',
  handler: (request, context) => handlers().getPreview(request, context),
});
