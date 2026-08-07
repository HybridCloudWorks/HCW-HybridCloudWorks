/**
 * admin-snapshots-http.js — dashboard/queue/publish snapshot RPCs at the
 * route names the frontend already posts to. Registration only; semantics in
 * lib/admin-snapshots.js.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createAdminSnapshotHandlers } from '../lib/admin-snapshots.js';

const handlers = () =>
  createAdminSnapshotHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc },
  });

app.http('getQueueSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getQueueSnapshot',
  handler: (request, context) => handlers().getQueueSnapshot(request, context),
});

app.http('getPublishSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getPublishSnapshot',
  handler: (request, context) => handlers().getPublishSnapshot(request, context),
});

app.http('getAdminDashboardSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getAdminDashboardSnapshot',
  handler: (request, context) => handlers().getAdminDashboardSnapshot(request, context),
});

app.http('recalculateDashboardStats', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'recalculateDashboardStats',
  handler: (request, context) => handlers().recalculateDashboardStats(request, context),
});
