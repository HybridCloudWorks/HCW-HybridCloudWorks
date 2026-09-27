/**
 * labs-http.js — Labs platform RPCs at the frontend's route names.
 * Semantics in lib/labs.js (the labs-functions.js port).
 *
 * The stub-era labs/jobs + labs/agents scaffolding routes are retired: the
 * stub accepted arbitrary job bodies with no type allowlist or payload cap —
 * a validation-free write path must not coexist with the real one (the same
 * rule as the retired cms/content raw-upsert save). submitPublicLabJob is
 * deliberately not registered — it authenticates plain (non-admin) users and
 * belongs to the frontend auth-swap phase; see lib/labs.js. The anonymous
 * public/labs/submit route (#672) is registered in labs-public-http.js,
 * closed by default.
 *
 * The lab agent registry's write path (#740), semantics in
 * lib/labs/agent-registry.js: `cms/labs/agents` (POST registers an agent) and
 * `cms/labs/agents/{agentId}` (PATCH activates or deactivates one). Two
 * templates, so two registrations, each through httpRouteByMethod so that a
 * later verb on either is a new key in `handlers`, never a second function on
 * the same template (TODO.md T-510).
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createDoc, queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createLabHandlers } from '../lib/labs.js';
import { createAgentRegistryHandlers } from '../lib/labs/agent-registry.js';

const handlers = () =>
  createLabHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc },
  });

const registry = () =>
  createAgentRegistryHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, createDoc, patchDoc, upsertDoc },
  });

httpRoute('enqueueLabJob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'enqueueLabJob',
  handler: (request, context) => handlers().enqueueLabJob(request, context),
});

httpRoute('getLabsSnapshot', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'getLabsSnapshot',
  handler: (request, context) => handlers().getLabsSnapshot(request, context),
});

httpRoute('getLabJob', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'getLabJob',
  handler: (request, context) => handlers().getLabJob(request, context),
});

httpRoute('cancelLabJob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cancelLabJob',
  handler: (request, context) => handlers().cancelLabJob(request, context),
});

httpRouteByMethod('cmsLabAgents', {
  authLevel: 'anonymous',
  route: 'cms/labs/agents',
  handlers: {
    POST: (request, context) => registry().registerAgent(request, context),
  },
});

httpRouteByMethod('cmsLabAgent', {
  authLevel: 'anonymous',
  route: 'cms/labs/agents/{agentId}',
  handlers: {
    PATCH: (request, context) => registry().setAgentActive(request, context),
  },
});
