/**
 * forge-config-http.js — registration for the Forge Studio RPCs (Blog
 * Machine T-604, the T-409 remainder). Semantics in
 * lib/content/forge-studio.js.
 *
 * RPC-style routes like the rest of the admin surface: the portal posts to
 * the function NAME. getForgeConfig also accepts GET for the Studio's
 * initial load.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createForgeStudioHandlers } from '../lib/content/forge-studio.js';

const handlers = () =>
  createForgeStudioHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc },
  });

httpRoute('getForgeConfig', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'getForgeConfig',
  handler: (request, context) => handlers().getForgeConfig(request, context),
});

httpRoute('updateForgeConfig', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'updateForgeConfig',
  handler: (request, context) => handlers().updateForgeConfig(request, context),
});
