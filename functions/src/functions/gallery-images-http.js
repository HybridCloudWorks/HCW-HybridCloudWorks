/**
 * gallery-images-http.js — image-record RPCs at the frontend's route names.
 * Registration only; semantics in lib/gallery-images.js. Blob deletion goes
 * through lib/blob-storage.js against the containers Terraform names after
 * the GCS path prefixes.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { deleteBlob } from '../lib/blob-storage.js';
import { createGalleryImageHandlers } from '../lib/gallery-images.js';

const handlers = () =>
  createGalleryImageHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
    storage: { deleteBlob },
  });

for (const name of [
  'saveContentImageOrder',
  'updateGalleryImageMetadata',
  'createManualGalleryImageRecord',
  'deleteCuratedGeneratedImage',
  'deleteContentGeneratedImage',
  'deleteRejectedContent',
]) {
  app.http(name, {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: name,
    handler: (request, context) => handlers()[name](request, context),
  });
}
