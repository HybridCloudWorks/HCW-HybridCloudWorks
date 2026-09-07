/**
 * publish-http.js — the publish pipeline RPCs at the frontend's route names,
 * and the #374 backfill route that is a narrow form of the same pipeline.
 * Semantics in lib/cms/publish.js, lib/cms/rehost-images.js and
 * lib/snapshots-publish.js.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createPublishHandlers } from '../lib/cms/publish.js';
import { createDefaultInlineImageRehoster } from '../lib/cms/inline-images-default.js';
import { createRehostImageHandlers } from '../lib/cms/rehost-images.js';
import { createSnapshotPublishHandlers } from '../lib/snapshots-publish.js';

const store = { queryDocs, readDoc, upsertDoc, patchDoc };

const publishHandlers = (context) =>
  createPublishHandlers({
    guard: getDefaultGuard(),
    store,
    inlineImages: createDefaultInlineImageRehoster(context),
    log: context,
  });

httpRoute('publishContent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'publishContent',
  handler: (request, context) => publishHandlers(context).publishContent(request, context),
});

// The same pipeline instance the publish route builds, so the rehoster the
// backfill runs is the one a publish runs — not a second wiring of it.
const rehostHandlers = (context) =>
  createRehostImageHandlers({
    guard: getDefaultGuard(),
    store,
    processPublishContent: publishHandlers(context).processPublishContent,
    log: context,
  });

httpRouteByMethod('cmsContentRehostImages', {
  authLevel: 'anonymous',
  route: 'cms/content/rehost-images',
  handlers: {
    GET: (request, context) => rehostHandlers(context).listCandidates(request, context),
    POST: (request, context) => rehostHandlers(context).rehostImages(request, context),
  },
});

httpRoute('publishSnapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'publishSnapshot',
  handler: (request, context) =>
    createSnapshotPublishHandlers({ guard: getDefaultGuard(), store }).publishSnapshot(
      request,
      context
    ),
});
