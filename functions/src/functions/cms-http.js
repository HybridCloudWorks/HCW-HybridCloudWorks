/**
 * cms-http.js — HTTP routes for the CMS admin portal.
 *
 * Registration only; the logic lives in lib/cms-content.js (list/get carry the
 * Site-Main semantics — projection, filter, limits) and auth is the two-gate
 * role guard. The former ../lib/auth-middleware.js import is gone: its
 * audience config (ENTRA_CLIENT_ID) was removed from the infrastructure by the
 * Flex Consumption rewrite, so every request through it would have failed —
 * or worse, skipped audience validation entirely (verify-token.js FIX A1).
 *
 * Remaining ports tracked in .azure/api-surface.json: createContentItem /
 * updateContentItem semantics for save, blob cleanup for delete, and the
 * cmsGenerateContent AI pipeline (route intentionally NOT registered until it
 * exists — a stub returning "TODO: AI output" is not an endpoint).
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createCmsContentHandlers } from '../lib/cms-content.js';

const handlers = () =>
  createCmsContentHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, deleteDoc },
  });

app.http('cmsListContent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/content',
  handler: (request, context) => handlers().list(request, context),
});

app.http('cmsGetContentItem', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'cms/content/item',
  handler: (request, context) => handlers().get(request, context),
});

app.http('cmsSaveContent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/content',
  handler: (request, context) => handlers().save(request, context),
});

app.http('cmsDeleteContent', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/content/{id}',
  handler: (request, context) => handlers().remove(request, context),
});
