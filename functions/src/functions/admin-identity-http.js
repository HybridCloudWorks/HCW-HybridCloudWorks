/**
 * admin-identity-http.js — the admin identity and speaker-event RPCs at the
 * route names the frontend already calls (postJSON/authedFetch convention).
 * Registration only; semantics in lib/admin-identity.js.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createAdminIdentityHandlers } from '../lib/admin-identity.js';

const handlers = () =>
  createAdminIdentityHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
  });

app.http('getCurrentAdminStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'getCurrentAdminStatus',
  handler: (request, context) => handlers().getCurrentAdminStatus(request, context),
});

app.http('bootstrapCurrentUserAdmin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'bootstrapCurrentUserAdmin',
  handler: (request, context) => handlers().bootstrapCurrentUserAdmin(request, context),
});

app.http('recordAdminAudit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'recordAdminAudit',
  handler: (request, context) => handlers().recordAdminAudit(request, context),
});

app.http('upsertSpeakerEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'upsertSpeakerEvent',
  handler: (request, context) => handlers().upsertSpeakerEvent(request, context),
});

app.http('deleteSpeakerEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'deleteSpeakerEvent',
  handler: (request, context) => handlers().deleteSpeakerEvent(request, context),
});
