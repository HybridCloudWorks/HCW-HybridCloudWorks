/**
 * publish-http.js — the publish pipeline RPCs at the frontend's route names.
 * Semantics in lib/cms/publish.js and lib/snapshots-publish.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createPublishHandlers } from '../lib/cms/publish.js';
import { createSnapshotPublishHandlers } from '../lib/snapshots-publish.js';

const store = { queryDocs, readDoc, upsertDoc, patchDoc };

httpRoute('publishContent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'publishContent',
  handler: (request, context) =>
    createPublishHandlers({ guard: getDefaultGuard(), store }).publishContent(request, context),
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
