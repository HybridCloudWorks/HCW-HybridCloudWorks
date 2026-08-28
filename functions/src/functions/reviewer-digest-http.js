/**
 * reviewer-digest-http.js — registration for `generateReviewerDigestManual`
 * (api-surface.json rpc.implemented). Semantics with the timer core in
 * lib/timers/reviewer-digest.js — the manual run and the 07:00 scheduled run
 * are the same snapshot.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import * as store from '../lib/cosmos-client.js';
import { createReviewerDigestManualHandler } from '../lib/timers/reviewer-digest.js';

httpRoute('generateReviewerDigestManual', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'generateReviewerDigestManual',
  handler: (request, context) =>
    createReviewerDigestManualHandler({ guard: getDefaultGuard(), store })(request, context),
});
