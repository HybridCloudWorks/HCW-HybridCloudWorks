/**
 * manual-images-http.js — registration for the manual image RPC cluster
 * (api-surface.json rpc.implemented; formerly four notImplemented entries,
 * each a live 404 in the admin UI) plus the Image Prompts page's per-set
 * sample generation (ADR 0033). Semantics in lib/manual-images.js.
 *
 * `queryDocs` is in the store so the generators can read the keyword matrix
 * and the prompt library; without it they compose from the request alone.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, patchDoc, upsertDoc } from '../lib/cosmos-client.js';
import { uploadBlob } from '../lib/blob-storage.js';
import { createReplicateClient } from '../lib/triggers/ai-cover.js';
import { createManualImageHandlers } from '../lib/manual-images.js';

const handlers = () =>
  createManualImageHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, patchDoc, upsertDoc },
    storage: { uploadBlob },
    replicate: createReplicateClient({ store: { queryDocs, upsertDoc } }),
    uuid: () => crypto.randomUUID(),
  });

for (const name of [
  'triggerAiImageGeneration',
  'generateReviewHeroImage',
  'generateCuratedArticleImage',
  'generatePreviewImages',
]) {
  httpRoute(name, {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: name,
    handler: (request, context) => handlers()[name](request, context),
  });
}

httpRoute('cmsGeneratePromptSetSample', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/image-prompts/sample',
  handler: (request, context) => handlers().generatePromptSetSample(request, context),
});
