/**
 * newsletter-admin-http.js — reviewing, editing and approving weekly issues
 * (#504, ADR 0030 §2a). Semantics in lib/newsletter/admin-handlers.js.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import * as ai from '../lib/ai/router.js';
import { createDrafter } from '../lib/content/drafting.js';
import { queryDocs, readDoc, replaceDocIfMatch, upsertDoc } from '../lib/cosmos-client.js';
import { createNewsletterAdminHandlers } from '../lib/newsletter/admin-handlers.js';

let handlers = null;
const admin = () => {
  const store = { queryDocs, readDoc, replaceDocIfMatch, upsertDoc };
  handlers ??= createNewsletterAdminHandlers({
    guard: getDefaultGuard(),
    store,
    // The drafter the builder uses (forge-jobs.js), so a regenerated intro is
    // written the way Monday's was.
    drafter: createDrafter({ store, ai }),
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
    DELETE: (request, context) => admin().remove(request, context),
  },
});

httpRoute('approveNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/approve',
  handler: (request, context) => admin().approve(request, context),
});

httpRoute('regenerateNewsletterIntro', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/intro',
  handler: (request, context) => admin().intro(request, context),
});

httpRoute('suggestNewsletterSubjects', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/subjects',
  handler: (request, context) => admin().subjects(request, context),
});

httpRoute('testNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/test',
  handler: (request, context) => admin().test(request, context),
});

httpRoute('saveNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/save',
  handler: (request, context) => admin().save(request, context),
});

httpRoute('rejectNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/reject',
  handler: (request, context) => admin().reject(request, context),
});

// ADR 0033 Amplify slice: managing an approved issue from the hub.
httpRoute('cancelNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/cancel',
  handler: (request, context) => admin().cancel(request, context),
});

httpRoute('rescheduleNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/reschedule',
  handler: (request, context) => admin().reschedule(request, context),
});

httpRoute('retryNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/retry',
  handler: (request, context) => admin().retry(request, context),
});

httpRoute('duplicateNewsletter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletters/{id}/duplicate',
  handler: (request, context) => admin().duplicate(request, context),
});

// Not under cms/newsletters/{id}: a literal segment there would be read as an id.
httpRoute('reconcileNewsletters', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/newsletter-reconcile',
  handler: (request, context) => admin().reconcile(request, context),
});

httpRouteByMethod('newsletterSender', {
  authLevel: 'anonymous',
  route: 'cms/newsletter-sender',
  handlers: {
    GET: (request, context) => admin().getSender(request, context),
    PUT: (request, context) => admin().putSender(request, context),
  },
});
