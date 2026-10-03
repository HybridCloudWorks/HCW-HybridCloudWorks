/**
 * ai-proxy-http.js — registration for the admin AI RPCs (#180) and the
 * per-task routing document (ADR 0033 §4). Semantics in lib/ai/proxy.js and
 * lib/admin-integrations.js.
 *
 * aiProxy / testAiProvider are RPC-style routes, not REST: the frontend
 * posts to a function NAME (`postJSON('aiProxy', ...)` in lib/api.js), which
 * is the shape the Firebase callable functions had and the admin UI still
 * uses. `cms/ai-routing` is REST (GET/PUT), beside `cms/ai-features`.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc, patchDoc, queryDocs, deleteDoc } from '../lib/cosmos-client.js';
import { createAiProxyHandlers } from '../lib/ai/proxy.js';
import { createAdminIntegrationHandlers } from '../lib/admin-integrations.js';
import * as ai from '../lib/ai/router.js';
import { getCostEstimate } from '../lib/ai/router.js';

const handlers = () =>
  createAiProxyHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc, patchDoc },
    ai: { callProvider: ai.callProvider, getCostEstimate },
  });

// The routing document's handlers live beside the feature switches in
// admin-integrations.js; the router's cache is dropped after every write so
// a change applies on the next call, not after the 60 s TTL.
const routingHandlers = () =>
  createAdminIntegrationHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
    onAiConfigChanged: ai.invalidateConfig,
  });

httpRoute('aiProxy', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'aiProxy',
  handler: (request, context) => handlers().aiProxy(request, context),
});

httpRoute('testAiProvider', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'testAiProvider',
  handler: (request, context) => handlers().testAiProvider(request, context),
});

httpRouteByMethod('cmsAiRouting', {
  authLevel: 'anonymous',
  route: 'cms/ai-routing',
  handlers: {
    GET: (request, context) => routingHandlers().getAiRouting(request, context),
    PUT: (request, context) => routingHandlers().putAiRouting(request, context),
  },
});
