/**
 * newsletter-admin-http.js — reviewing and editing weekly issues
 * (#504, ADR 0030 §2a). Semantics in lib/newsletter/admin-handlers.js.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, replaceDocIfMatch, upsertDoc } from '../lib/cosmos-client.js';
import { createNewsletterAdminHandlers } from '../lib/newsletter/admin-handlers.js';

let handlers = null;
const admin = () => {
  handlers ??= createNewsletterAdminHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, replaceDocIfMatch, upsertDoc },
  });
  return handlers;
};

httpRoute('listNewsletters', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/newsletters',
  handler: (request, context) => admin().list(request, context),
});

httpRouteByMethod('newsletterIssue', {
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}',
  handlers: {
    GET: (request, context) => admin().get(request, context),
    PATCH: (request, context) => admin().update(request, context),
  },
});

httpRoute('rejectNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/reject',
  handler: (request, context) => admin().reject(request, context),
});
