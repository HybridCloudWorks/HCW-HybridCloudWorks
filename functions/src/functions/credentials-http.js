/**
 * credentials-http.js — Admin → Integrations → Credentials (#1026).
 * Registration only; semantics in lib/credentials/handlers.js.
 *
 * All three are `super_admin`, the Keys tab's role: the register is an
 * inventory of every credential the estate holds and which are overdue, the
 * same reason admin-secrets-http.js gates its read as tightly as its write.
 *
 * `cms/credentials/reminders` is a literal two-segment path beside the
 * one-segment `cms/credentials`, so the two never meet.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createDoc, readDoc, replaceDocIfMatch, upsertDoc } from '../lib/cosmos-client.js';
import { createCredentialRegisterHandlers } from '../lib/credentials/handlers.js';

// createDoc and replaceDocIfMatch: the register's record and the reminders
// sheet are both written under their ETags. upsertDoc only for the audit row.
const handlers = () =>
  createCredentialRegisterHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, createDoc, replaceDocIfMatch, upsertDoc },
  });

httpRouteByMethod('cmsCredentials', {
  authLevel: 'anonymous',
  route: 'cms/credentials',
  handlers: {
    GET: (request, context) => handlers().getRegister(request, context),
    PUT: (request, context) => handlers().putRotation(request, context),
  },
});

httpRoute('cmsCredentialsReminders', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/credentials/reminders',
  handler: (request, context) => handlers().syncReminders(request, context),
});
