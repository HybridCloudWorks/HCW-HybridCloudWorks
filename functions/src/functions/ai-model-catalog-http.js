/**
 * ai-model-catalog-http.js — the model catalogue routes (ADR 0034 slice 2,
 * #857): read it, hide or show one model, refresh it now. Registration only;
 * semantics in lib/ai/model-catalog.js and lib/ai/model-catalog-handlers.js.
 *
 * The refresh lists every provider with a key through the same adapters the
 * weekly `probeAiProviders` timer runs (schedulers.js), with the app
 * identity's token for Foundry built the way the router builds its own.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { availableProviders, invalidateConfig } from '../lib/ai/router.js';
import { createListContext, listModels, refreshModelCatalog } from '../lib/ai/model-catalog.js';
import { createModelCatalogHandlers } from '../lib/ai/model-catalog-handlers.js';

const store = { readDoc, upsertDoc };

const handlers = () =>
  createModelCatalogHandlers({
    guard: getDefaultGuard(),
    store,
    refresh: () => {
      const ctx = createListContext();
      return refreshModelCatalog({
        store,
        providers: availableProviders(),
        listModels: (provider) => listModels(ctx, provider),
      });
    },
    // A hide or a refresh changes what the router may select, so it applies
    // on the next AI call instead of after the 60 s cache (ADR 0033).
    aiConfigChanged: invalidateConfig,
  });

httpRoute('cmsAiModelCatalog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/ai-model-catalog',
  handler: (request, context) => handlers().getModelCatalog(request, context),
});

httpRoute('cmsAiModelCatalogRefresh', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/ai-model-catalog/refresh',
  handler: (request, context) => handlers().refreshModelCatalog(request, context),
});

httpRoute('cmsAiModelCatalogModel', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'cms/ai-model-catalog/{provider}/{model}',
  handler: (request, context) => handlers().patchModelCatalogModel(request, context),
});
