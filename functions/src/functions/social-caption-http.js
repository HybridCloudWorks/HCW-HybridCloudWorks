/**
 * social-caption-http.js — registration for `generateSocialCaption`
 * (api-surface.json rpc.implemented; formerly the last social entry in
 * notImplemented — SocialHubPage's Generate button has been a live 404
 * since the import). Semantics in lib/social-caption.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc } from '../lib/cosmos-client.js';
import * as ai from '../lib/ai/router.js';
import { createSocialCaptionHandlers } from '../lib/social-caption.js';

const handlers = () =>
  createSocialCaptionHandlers({ guard: getDefaultGuard(), store: { readDoc }, ai });

httpRoute('generateSocialCaption', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'generateSocialCaption',
  handler: (request, context) => handlers().generateSocialCaption(request, context),
});
