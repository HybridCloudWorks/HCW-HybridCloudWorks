/**
 * lab-agent-http.js — the three routes the Labs VPS agent may call.
 * Registration only; semantics in lib/lab-agent.js, authorization in
 * lib/auth/require-agent.js.
 *
 * These are guarded, but not by `requireRole`: the agent is a machine identity
 * with its own App Role and its own registry, disjoint from the admin gates
 * (see require-agent.js for why). The route-inventory test knows about this
 * third guard explicitly — a new guard must be added there before its routes
 * count as guarded, which is the point of that test.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultAgentGuard } from '../lib/auth/default-agent-guard.js';
import { queryDocs, readDoc, patchDoc, replaceDocIfMatch } from '../lib/cosmos-client.js';
import { createLabAgentHandlers } from '../lib/lab-agent.js';

const handlers = () =>
  createLabAgentHandlers({
    guard: getDefaultAgentGuard(),
    store: { queryDocs, readDoc, patchDoc, replaceDocIfMatch },
  });

httpRoute('claimLabJob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agent/claimLabJob',
  handler: (request, context) => handlers().claimLabJob(request, context),
});

httpRoute('heartbeatLabAgent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agent/heartbeat',
  handler: (request, context) => handlers().heartbeatAgent(request, context),
});

httpRoute('completeLabJob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agent/completeLabJob',
  handler: (request, context) => handlers().completeLabJob(request, context),
});
