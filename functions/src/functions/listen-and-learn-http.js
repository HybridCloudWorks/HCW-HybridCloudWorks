/**
 * listen-and-learn-http.js — the Listen & Learn admin surface.
 *
 * Generation is NOT here: it is the `generate-listen-and-learn` job
 * (listen-and-learn-jobs.js), because it runs for minutes and an HTTP response
 * is bounded well below that. These routes are the fast half — reading what
 * has been generated, and approving it — plus one enqueue (#433): the
 * source-grounded episode route only queues the job, through the same
 * Storage Queue output binding `enqueueJob` uses, so the owner's URL list is
 * refused at the route when it is wrong rather than by a job that fails
 * later. See listen-and-learn/handlers.js for why.
 */
import { output } from '@azure/functions';
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { JOBS_QUEUE } from '../lib/jobs.js';
import { createListenAndLearnHandlers } from '../lib/listen-and-learn/handlers.js';

const queueOutput = output.storageQueue({
  queueName: JOBS_QUEUE,
  connection: 'AzureWebJobsStorage',
});

const handlers = () =>
  createListenAndLearnHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc },
  });

httpRoute('listListenAndLearnSets', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn',
  handler: (request, context) => handlers().listSets(request, context),
});

httpRoute('reviewListenAndLearn', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/review',
  handler: (request, context) => handlers().reviewEpisode(request, context),
});

httpRoute('generateListenAndLearnSourceEpisode', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/source-episode',
  extraOutputs: [queueOutput],
  handler: (request, context) =>
    handlers().generateSourceEpisode(request, context, {
      enqueue: (message) => context.extraOutputs.set(queueOutput, message),
    }),
});

// Registered after the literal `review` and `source-episode` routes so the
// static segments win; otherwise `cms/listen-and-learn/review` would bind
// `platform: 'review'`.
httpRoute('getListenAndLearnSet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/{platform}/{examCode}',
  handler: (request, context) => handlers().getSet(request, context),
});
