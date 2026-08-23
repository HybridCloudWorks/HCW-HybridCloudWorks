/**
 * ai-proxy-http.js — registration for the two admin AI RPCs (#180).
 * Semantics in lib/ai/proxy.js.
 *
 * RPC-style routes, not REST: the frontend posts to a function NAME
 * (`postJSON('aiProxy', ...)` in lib/api.js), which is the shape the Firebase
 * callable functions had and the admin UI still uses.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createAiProxyHandlers } from '../lib/ai/proxy.js';
import * as ai from '../lib/ai/router.js';
import { getCostEstimate } from '../lib/ai/router.js';

const handlers = () =>
  createAiProxyHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc, patchDoc },
    ai: { callProvider: ai.callProvider, getCostEstimate },
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
