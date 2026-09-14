/**
 * newsletter-insights-http.js — Resend metrics, audience, domains, logs and
 * templates for the Mailing List page (#504). Semantics, roles and what each
 * route may write are in lib/newsletter/insights-handlers.js. No route here
 * sends email.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc } from '../lib/cosmos-client.js';
import { createNewsletterInsightsHandlers } from '../lib/newsletter/insights-handlers.js';

let handlers = null;
const insights = () => {
  handlers ??= createNewsletterInsightsHandlers({ guard: getDefaultGuard(), store: { readDoc } });
  return handlers;
};

httpRoute('mailingListMetrics', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/metrics',
  handler: (request, context) => insights().metrics(request, context),
});

httpRoute('mailingListClickedLinks', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/broadcasts/{broadcastId}/clicked-links',
  handler: (request, context) => insights().clickedLinks(request, context),
});

httpRoute('mailingListRecipients', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/broadcasts/{broadcastId}/recipients',
  handler: (request, context) => insights().recipients(request, context),
});

httpRoute('mailingListAudience', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/audience',
  handler: (request, context) => insights().audience(request, context),
});

httpRoute('mailingListAudienceSummary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/audience/summary',
  handler: (request, context) => insights().audienceSummary(request, context),
});

httpRouteByMethod('mailingListContact', {
  authLevel: 'anonymous',
  route: 'cms/mailing-list/audience/{contactId}',
  handlers: {
    PATCH: (request, context) => insights().updateContact(request, context),
    DELETE: (request, context) => insights().deleteContact(request, context),
  },
});

httpRouteByMethod('mailingListDomains', {
  authLevel: 'anonymous',
  route: 'cms/mailing-list/domains',
  handlers: {
    GET: (request, context) => insights().listDomains(request, context),
    POST: (request, context) => insights().createDomain(request, context),
  },
});

// No DELETE: removing a sending domain is left to Resend's dashboard.
httpRouteByMethod('mailingListDomain', {
  authLevel: 'anonymous',
  route: 'cms/mailing-list/domains/{domainId}',
  handlers: {
    GET: (request, context) => insights().getDomain(request, context),
    PATCH: (request, context) => insights().updateDomain(request, context),
  },
});

httpRoute('verifyMailingListDomain', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/domains/{domainId}/verify',
  handler: (request, context) => insights().verifyDomain(request, context),
});

httpRoute('mailingListLogs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/logs',
  handler: (request, context) => insights().listLogs(request, context),
});

httpRoute('mailingListLog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/logs/{logId}',
  handler: (request, context) => insights().getLog(request, context),
});

httpRoute('mailingListEmails', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/emails',
  handler: (request, context) => insights().listEmails(request, context),
});

httpRoute('mailingListTemplates', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/templates',
  handler: (request, context) => insights().listTemplates(request, context),
});

httpRoute('mailingListTemplate', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/mailing-list/templates/{templateId}',
  handler: (request, context) => insights().getTemplate(request, context),
});
