/**
 * admin-integrations-http.js — routes for recordings, speaker events,
 * settings, image gallery reads, AI providers / MCP servers, and usage
 * records (api-surface adminReads + remaining adminWrites). Registration
 * only; semantics in lib/admin-integrations.js.
 *
 * The {collection} segment on the config routes is allowlisted in the lib
 * (ai-providers, mcp-servers) — anything else 404s before touching Cosmos.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createAdminIntegrationHandlers } from '../lib/admin-integrations.js';

const handlers = () =>
  createAdminIntegrationHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
  });

app.http('cmsListRecordings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/recordings',
  handler: (request, context) => handlers().listRecordings(request, context),
});

app.http('cmsCreateRecording', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/recordings',
  handler: (request, context) => handlers().createRecording(request, context),
});

app.http('cmsPatchRecording', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'cms/recordings/{id}',
  handler: (request, context) => handlers().patchRecording(request, context),
});

app.http('cmsListSpeakerEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/speakerevents',
  handler: (request, context) => handlers().listSpeakerEvents(request, context),
});

app.http('cmsGetSettings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/settings',
  handler: (request, context) => handlers().getSettings(request, context),
});

app.http('cmsPutSettings', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'cms/settings',
  handler: (request, context) => handlers().putSettings(request, context),
});

app.http('cmsListImages', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/images',
  handler: (request, context) => handlers().listImages(request, context),
});

app.http('cmsListConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/config/{collection}',
  handler: (request, context) => handlers().listConfig(request, context),
});

app.http('cmsPutConfig', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'cms/config/{collection}/{id}',
  handler: (request, context) => handlers().putConfig(request, context),
});

app.http('cmsPatchConfig', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'cms/config/{collection}/{id}',
  handler: (request, context) => handlers().patchConfig(request, context),
});

app.http('cmsDeleteConfig', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/config/{collection}/{id}',
  handler: (request, context) => handlers().deleteConfig(request, context),
});

app.http('cmsListAiUsage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/ai-usage',
  handler: (request, context) => handlers().listUsage(request, context),
});
