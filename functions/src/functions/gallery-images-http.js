/**
 * gallery-images-http.js — image-record RPCs at the frontend's route names,
 * plus the media-library routes ADR 0033 added (bulk edits, persisted
 * folders, import-from-URL, per-image usage). Registration only; semantics
 * in lib/gallery-images.js. Blob deletion and upload go through
 * lib/blob-storage.js against the containers Terraform names after the GCS
 * path prefixes.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { deleteBlob, uploadBlob } from '../lib/blob-storage.js';
import { createGalleryImageHandlers } from '../lib/gallery-images.js';

const handlers = () =>
  createGalleryImageHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
    storage: { deleteBlob, uploadBlob },
  });

for (const name of [
  'saveContentImageOrder',
  'updateGalleryImageMetadata',
  'createManualGalleryImageRecord',
  'deleteCuratedGeneratedImage',
  'deleteContentGeneratedImage',
  'deleteRejectedContent',
]) {
  httpRoute(name, {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: name,
    handler: (request, context) => handlers()[name](request, context),
  });
}

httpRoute('cmsBulkGalleryImages', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/images/bulk',
  handler: (request, context) => handlers().bulkGalleryImages(request, context),
});

httpRouteByMethod('cmsGalleryFolders', {
  authLevel: 'anonymous',
  route: 'cms/images/folders',
  handlers: {
    GET: (request, context) => handlers().getGalleryFolders(request, context),
    PUT: (request, context) => handlers().putGalleryFolders(request, context),
  },
});

httpRoute('cmsImportGalleryImage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/images/import',
  handler: (request, context) => handlers().importGalleryImage(request, context),
});

httpRoute('cmsGalleryImageUsage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/images/{id}/usage',
  handler: (request, context) => handlers().getImageUsage(request, context),
});
