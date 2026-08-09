/**
 * admin-snapshots-http.js — dashboard/queue/publish snapshot RPCs at the
 * route names the frontend already posts to. Registration only; semantics in
 * lib/admin-snapshots.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createAdminSnapshotHandlers } from '../lib/admin-snapshots.js';

const handlers = () =>
  createAdminSnapshotHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc },
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
