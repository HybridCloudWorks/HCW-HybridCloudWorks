/**
 * podcast-recordings-http.js — the recording side of the podcast admin
 * surface (#442): script a Plaud or stored recording, and upload audio for
 * Plaud Embedded to transcribe.
 *
 * Both routes only enqueue; the work runs as jobs in podcast-jobs.js. Same
 * Storage Queue output binding as `enqueueJob` and `generatePodcastTranscript`,
 * so no new credential and no new service. Registered in its own file, apart
 * from podcast-http.js, because #437 slice 2 is extending that one.
 */
import { output } from '@azure/functions';
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { deleteBlob, uploadBlob } from '../lib/blob-storage.js';
import { JOBS_QUEUE } from '../lib/jobs.js';
import { createPodcastRecordingHandlers } from '../lib/podcast/recording-handlers.js';

const queueOutput = output.storageQueue({
  queueName: JOBS_QUEUE,
  connection: 'AzureWebJobsStorage',
});

// `deleteBlob` is not optional: the upload handler removes a blob whose job
// could not be queued, and without it that blob stays reachable until the
// lifecycle rule. podcast-recordings-http.test.js asserts it is wired.
const handlers = () =>
  createPodcastRecordingHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc },
    storage: { uploadBlob, deleteBlob },
  });

// A literal segment under `cms/podcast/transcripts/`; it cannot collide with
// `GET cms/podcast/transcripts/{id}` because that route is GET only.
httpRoute('generatePodcastTranscriptFromRecording', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/podcast/transcripts/generate-from-recording',
  extraOutputs: [queueOutput],
  handler: (request, context) =>
    handlers().generateFromRecording(request, context, {
      enqueue: (message) => context.extraOutputs.set(queueOutput, message),
    }),
});

httpRoute('uploadPodcastRecording', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/podcast/recordings/upload',
  extraOutputs: [queueOutput],
  handler: (request, context) =>
    handlers().uploadRecording(request, context, {
      enqueue: (message) => context.extraOutputs.set(queueOutput, message),
    }),
});
