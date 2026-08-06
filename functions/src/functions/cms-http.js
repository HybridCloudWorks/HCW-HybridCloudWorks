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
 * Routes follow the frontend's RPC convention where one exists: postJSON()
 * builds `${base}/${fnName}`, so createContentItem is registered under that
 * literal route.
 *
 * Remaining ports tracked in .azure/api-surface.json: updateContentItem
 * (must use patchDoc — partial write, not replace), blob cleanup for delete,
 * and the cmsGenerateContent AI pipeline (route intentionally NOT registered
 * until it exists — a stub returning "TODO: AI output" is not an endpoint).
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createCmsContentHandlers } from '../lib/cms-content.js';
import { createContentCreateHandler } from '../lib/cms/content-create.js';

const handlers = () =>
  createCmsContentHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, deleteDoc },
  });

// critiqueDraft is not injected: the default null critique is the specified
// behavior until the AI model-router slice lands (see content-create.js).
const createHandler = () =>
  createContentCreateHandler({
    guard: getDefaultGuard(),
    store: { queryDocs, upsertDoc },
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

// Replaces the interim raw-upsert save placeholder: creation now goes through
// the full source semantics (dedup 409, quality gate 422) at the RPC route the
// frontend actually calls (SubmitUrlsPage → postJSON('createContentItem')).
app.http('createContentItem', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'createContentItem',
  handler: (request, context) => createHandler()(request, context),
});

app.http('cmsDeleteContent', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/content/{id}',
  handler: (request, context) => handlers().remove(request, context),
});
