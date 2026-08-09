/**
 * content-workflow-http.js — the content workflow write RPCs at the
 * frontend's route names. Registration only; semantics in
 * lib/content-workflow.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, patchDoc, upsertDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createContentWorkflowHandlers } from '../lib/content-workflow.js';

const handlers = () =>
  createContentWorkflowHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, patchDoc, upsertDoc, deleteDoc },
  });

for (const name of [
  'saveEditorDraft',
  'unpublishContentToInspected',
  'deleteContentItem',
  'saveContentSchedule',
  'softDeleteLivePage',
  'requestContentInspection',
  'resetContentReviewState',
]) {
  httpRoute(name, {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: name,
    handler: (request, context) => handlers()[name](request, context),
  });
}
