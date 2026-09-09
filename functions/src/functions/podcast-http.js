/**
 * podcast-http.js — the podcast transcript admin surface (#435).
 *
 * Generation runs as the `generate-podcast-transcript` job (podcast-jobs.js);
 * the generate route here only enqueues it, through the same Storage Queue
 * output binding `enqueueJob` uses, so no new credential and no new service.
 * The other three routes are the fast half — reading what was generated, and
 * approving it. The page that presents them is the Recording Hub (#442).
 */
import { output } from '@azure/functions';
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { JOBS_QUEUE } from '../lib/jobs.js';
import { createPodcastHandlers } from '../lib/podcast/handlers.js';

const queueOutput = output.storageQueue({
  queueName: JOBS_QUEUE,
  connection: 'AzureWebJobsStorage',
});

const handlers = () =>
  createPodcastHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc },
  });

httpRoute('generatePodcastTranscript', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/podcast/transcripts/generate',
  extraOutputs: [queueOutput],
  handler: (request, context) =>
    handlers().generateTranscript(request, context, {
      enqueue: (message) => context.extraOutputs.set(queueOutput, message),
    }),
});

httpRoute('reviewPodcastTranscript', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/podcast/transcripts/review',
  handler: (request, context) => handlers().reviewTranscript(request, context),
});

httpRoute('listPodcastTranscripts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/podcast/transcripts',
  handler: (request, context) => handlers().listTranscripts(request, context),
});

// Registered after the literal `generate` and `review` routes so the static
// segments win; otherwise `cms/podcast/transcripts/review` would bind
// `id: 'review'`.
httpRoute('getPodcastTranscript', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/podcast/transcripts/{id}',
  handler: (request, context) => handlers().getTranscript(request, context),
});
