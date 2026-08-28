/**
 * manual-images-http.js — registration for the manual image RPC cluster
 * (api-surface.json rpc.implemented; formerly four notImplemented entries,
 * each a live 404 in the admin UI). Semantics in lib/manual-images.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, patchDoc, upsertDoc } from '../lib/cosmos-client.js';
import { uploadBlob } from '../lib/blob-storage.js';
import { createReplicateClient } from '../lib/triggers/ai-cover.js';
import { createManualImageHandlers } from '../lib/manual-images.js';

const handlers = () =>
  createManualImageHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, patchDoc, upsertDoc },
    storage: { uploadBlob },
    replicate: createReplicateClient(),
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
