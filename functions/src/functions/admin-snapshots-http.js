/**
 * admin-snapshots-http.js — dashboard/queue/publish snapshot RPCs at the
 * route names the frontend already posts to, and the dashboard's Decision
 * Center. Registration only; semantics in lib/admin-snapshots.js and
 * lib/decision-center.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createDoc, queryDocs, readDoc, replaceDocIfMatch, upsertDoc } from '../lib/cosmos-client.js';
import { createAdminSnapshotHandlers } from '../lib/admin-snapshots.js';
import { createDecisionCenterHandlers } from '../lib/decision-center.js';

// createDoc and replaceDocIfMatch are the Recount's marker writes
// (triggers/dashboard-stats.js rederiveMarkers).
const handlers = () =>
  createAdminSnapshotHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, createDoc, replaceDocIfMatch },
  });

const decisions = () =>
  createDecisionCenterHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc },
  });

httpRoute('getDecisionCenter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getDecisionCenter',
  handler: (request, context) => decisions().getDecisionCenter(request, context),
});

httpRoute('getQueueSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getQueueSnapshot',
  handler: (request, context) => handlers().getQueueSnapshot(request, context),
});

httpRoute('getPublishSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getPublishSnapshot',
  handler: (request, context) => handlers().getPublishSnapshot(request, context),
});

httpRoute('getAdminDashboardSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getAdminDashboardSnapshot',
  handler: (request, context) => handlers().getAdminDashboardSnapshot(request, context),
});

httpRoute('recalculateDashboardStats', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'recalculateDashboardStats',
  handler: (request, context) => handlers().recalculateDashboardStats(request, context),
});
