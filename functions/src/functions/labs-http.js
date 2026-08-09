/**
 * labs-http.js — Labs platform RPCs at the frontend's route names.
 * Semantics in lib/labs.js (the labs-functions.js port).
 *
 * The stub-era labs/jobs + labs/agents scaffolding routes are retired: the
 * stub accepted arbitrary job bodies with no type allowlist or payload cap —
 * a validation-free write path must not coexist with the real one (the same
 * rule as the retired cms/content raw-upsert save). submitPublicLabJob is
 * deliberately not registered — it authenticates plain (non-admin) users and
 * belongs to the frontend auth-swap phase; see lib/labs.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createLabHandlers } from '../lib/labs.js';

const handlers = () =>
  createLabHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc },
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
