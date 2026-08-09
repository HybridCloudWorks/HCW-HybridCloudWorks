/**
 * image-prompts-http.js — the manageImagePromptConfig RPC (the route name the
 * frontend already posts to via postJSON) plus the config-tree and keyword
 * endpoints replacing useImagePrompts.js's direct Firestore access.
 * Registration only; semantics in lib/cms/image-prompts.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createImagePromptHandlers } from '../lib/cms/image-prompts.js';

const handlers = () =>
  createImagePromptHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
  });

httpRoute('manageImagePromptConfig', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manageImagePromptConfig',
  handler: (request, context) => handlers().manageConfig(request, context),
});

httpRoute('cmsGetImagePromptConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/image-prompts',
  handler: (request, context) => handlers().getConfigTree(request, context),
});

httpRoute('cmsGetKeywordConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/keyword-config',
  handler: (request, context) => handlers().getKeywordConfig(request, context),
});

httpRoute('cmsPutKeywordDoc', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'cms/keyword-config/{collection}/{id}',
  handler: (request, context) => handlers().putKeywordDoc(request, context),
});

httpRoute('cmsDeleteKeywordDoc', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/keyword-config/{collection}/{id}',
  handler: (request, context) => handlers().deleteKeywordDoc(request, context),
});
