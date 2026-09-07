/**
 * publish-http.js — the publish pipeline RPCs at the frontend's route names,
 * plus the two routes that are narrower forms of the same pipeline: the #374
 * image backfill and the #400 set-slug-and-republish. Semantics in
 * lib/cms/publish.js, lib/cms/rehost-images.js, lib/cms/set-slug.js and
 * lib/snapshots-publish.js.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createPublishHandlers } from '../lib/cms/publish.js';
import { createDefaultInlineImageRehoster } from '../lib/cms/inline-images-default.js';
import { createRehostImageHandlers } from '../lib/cms/rehost-images.js';
import { createSetSlugHandlers } from '../lib/cms/set-slug.js';
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

// #400: the operator path for giving an article the right slug. Same pipeline
// instance again, for the same reason as the re-host route above — the
// republish that makes curatedSubpagePath / slugPageUrl / publishedUrl /
// publicUrl follow the new slug is the real publish, not a second copy of
// resolveCuratedSubpagePath.
httpRoute('cmsContentSetSlug', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/content/slug',
  handler: (request, context) =>
    createSetSlugHandlers({
      guard: getDefaultGuard(),
      store,
      processPublishContent: publishHandlers(context).processPublishContent,
      log: context,
    }).setContentSlug(request, context),
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
