/**
 * admin-integrations-http.js — routes for recordings, speaker events,
 * settings, image gallery reads, AI providers / MCP servers, and usage
 * records (api-surface adminReads + remaining adminWrites). Registration
 * only; semantics in lib/admin-integrations.js.
 *
 * The {collection} segment on the config routes is allowlisted in the lib
 * (ai-providers, mcp-servers) — anything else 404s before touching Cosmos.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createAdminIntegrationHandlers } from '../lib/admin-integrations.js';

const handlers = () =>
  createAdminIntegrationHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
  });

httpRouteByMethod('cmsRecordings', {
  authLevel: 'anonymous',
  route: 'cms/recordings',
  handlers: {
    GET: (request, context) => handlers().listRecordings(request, context),
    POST: (request, context) => handlers().createRecording(request, context),
  },
});

httpRoute('cmsPatchRecording', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'cms/recordings/{id}',
  handler: (request, context) => handlers().patchRecording(request, context),
});

httpRoute('cmsListSpeakerEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/speakerevents',
  handler: (request, context) => handlers().listSpeakerEvents(request, context),
});

httpRouteByMethod('cmsSettings', {
  authLevel: 'anonymous',
  route: 'cms/settings',
  handlers: {
    GET: (request, context) => handlers().getSettings(request, context),
    PUT: (request, context) => handlers().putSettings(request, context),
  },
});

httpRoute('cmsGetCuratedImage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/images/curated/{id}',
  handler: (request, context) => handlers().getCuratedImage(request, context),
});

httpRoute('cmsListImages', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/images',
  handler: (request, context) => handlers().listImages(request, context),
});

httpRoute('cmsListConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/config/{collection}',
  handler: (request, context) => handlers().listConfig(request, context),
});

httpRouteByMethod('cmsConfigDoc', {
  authLevel: 'anonymous',
  route: 'cms/config/{collection}/{id}',
  handlers: {
    PUT: (request, context) => handlers().putConfig(request, context),
    PATCH: (request, context) => handlers().patchConfig(request, context),
    DELETE: (request, context) => handlers().deleteConfig(request, context),
  },
});

httpRouteByMethod('cmsAiFeatures', {
  authLevel: 'anonymous',
  route: 'cms/ai-features',
  handlers: {
    GET: (request, context) => handlers().getAiFeatures(request, context),
    PUT: (request, context) => handlers().putAiFeatures(request, context),
  },
});

httpRoute('cmsListAiUsage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/ai-usage',
  handler: (request, context) => handlers().listUsage(request, context),
});
