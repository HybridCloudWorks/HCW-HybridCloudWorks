/**
 * podcast-http.js — the podcast transcript admin surface (#435).
 *
 * Generation runs as the `generate-podcast-transcript` job (podcast-jobs.js);
 * the generate route here only enqueues it, through the same Storage Queue
 * output binding `enqueueJob` uses, so no new credential and no new service.
 * The other routes are the fast half — reading what was generated, and
 * approving it. The page that presents them is the Recording Hub (#442).
 *
 * Approval publishes to RSS.com (#437, ADR 0029 §1b) — through a second job,
 * `publish-podcast-transcript`, for the same reason: an MP3 upload and an
 * episode create can take tens of seconds, and the client's own deadlines
 * sum past the HTTP budget. So the review route and the retry route both
 * carry the queue output binding, and both answer 202 with the job id when a
 * publish is in flight. Nothing on this surface writes `podcasts`: the feed
 * is the ingest boundary and the timer reads it.
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
  extraOutputs: [queueOutput],
  handler: (request, context) =>
    handlers().reviewTranscript(request, context, {
      enqueue: (message) => context.extraOutputs.set(queueOutput, message),
    }),
});

// The retry: the same host step approval runs, on a transcript that is
// already published. Idempotent on the host episode id the document carries.
httpRoute('publishPodcastTranscript', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/podcast/transcripts/{id}/publish',
  extraOutputs: [queueOutput],
  handler: (request, context) =>
    handlers().publishTranscript(request, context, {
      enqueue: (message) => context.extraOutputs.set(queueOutput, message),
    }),
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
