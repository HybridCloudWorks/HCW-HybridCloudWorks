/**
 * recording-content-http.js — registration for `createContentFromRecording`
 * (issue #180, the last unimplemented RPC). Semantics in
 * lib/content/draft-from-recording.js.
 *
 * RPC-style route, not REST: RecordingsPage posts to the function NAME
 * (`postJSON('createContentFromRecording', ...)`), the shape the Firebase
 * callable had. Same drafter and same content write path as
 * generateArticleDraft / createContentItem — see the lib header for why.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, queryDocs, patchDoc, upsertDoc } from '../lib/cosmos-client.js';
import * as ai from '../lib/ai/router.js';
import { createDrafter } from '../lib/content/drafting.js';
import { createContentDocument } from '../lib/cms/content-create.js';
import {
  createRecordingDrafter,
  createContentFromRecordingHandler,
} from '../lib/content/draft-from-recording.js';

const handler = (request, context) => {
  const store = { readDoc, queryDocs, patchDoc, upsertDoc };
  return createContentFromRecordingHandler({
    guard: getDefaultGuard(),
    recordingDrafter: createRecordingDrafter({
      drafter: createDrafter({ store, ai }),
      store,
      persist: createContentDocument,
      log: context,
    }),
  })(request, context);
};

httpRoute('createContentFromRecording', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'createContentFromRecording',
  handler,
});
