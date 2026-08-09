/**
 * ops-health-http.js — operations-health snapshot + workflow-alert RPCs at
 * the frontend's route names. Registration only; semantics in
 * lib/ops-health.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createOpsHealthHandlers } from '../lib/ops-health.js';

const handlers = () =>
  createOpsHealthHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc },
  });

httpRoute('getOpsHealthSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'getOpsHealthSnapshot',
  handler: (request, context) => handlers().getOpsHealthSnapshot(request, context),
});

httpRoute('updateWorkflowAlert', {
  methods: ['POST', 'PATCH'],
  authLevel: 'anonymous',
  route: 'updateWorkflowAlert',
  handler: (request, context) => handlers().updateWorkflowAlert(request, context),
});
