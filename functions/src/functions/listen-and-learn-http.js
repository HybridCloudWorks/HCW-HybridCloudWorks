/**
 * listen-and-learn-http.js — the Listen & Learn admin surface: the Audio
 * Library (ADR 0033 §4) of books and courses, their chapters and each
 * chapter's audio versions.
 *
 * Generation is NOT here: it is the `generate-listen-and-learn` and
 * `speak-listen-and-learn-chapter` jobs (listen-and-learn-jobs.js), because
 * they run for minutes and an HTTP response is bounded well below that.
 * These routes are the fast half — reading what has been generated, editing
 * the library, approving — plus the enqueues: a source-grounded episode
 * (#433), a chapter regeneration and a hand-made chapter's first reading
 * only queue their job, through the same Storage Queue output binding
 * `enqueueJob` uses, so a bad request is refused at the route rather than
 * by a job that fails later. See listen-and-learn/handlers.js for why.
 *
 * One registration per route template (`httpRouteByMethod`): the Functions
 * host keys its route table on the template alone, so GET, PATCH and DELETE
 * of one book are one function with three handlers, not three functions.
 */
import { output } from '@azure/functions';
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { deleteBlob } from '../lib/blob-storage.js';
import { JOBS_QUEUE } from '../lib/jobs.js';
import { modelForTask } from '../lib/ai/router.js';
import { createListenAndLearnHandlers } from '../lib/listen-and-learn/handlers.js';

const queueOutput = output.storageQueue({
  queueName: JOBS_QUEUE,
  connection: 'AzureWebJobsStorage',
});

const handlers = () =>
  createListenAndLearnHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc },
    storage: { deleteBlob },
    // The task's model for the speech options and the estimate (ADR 0034 slice 5).
    ai: { modelForTask },
  });

/** The queue output as the enqueue handlers take it. */
const queueIo = (context) => ({
  enqueue: (message) => context.extraOutputs.set(queueOutput, message),
});

httpRouteByMethod('cmsListenAndLearnBooks', {
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn',
  handlers: {
    GET: (request, context) => handlers().listSets(request, context),
    POST: (request, context) => handlers().createBook(request, context),
  },
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
    handlers().generateSourceEpisode(request, context, queueIo(context)),
});

httpRoute('listenAndLearnSpeechOptions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/speech-options',
  handler: (request, context) => handlers().speechOptions(request, context),
});

httpRoute('listenAndLearnEstimate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/estimate',
  handler: (request, context) => handlers().estimateSpeech(request, context),
});

// Registered after the literal single-segment routes so the static segments
// win; otherwise `cms/listen-and-learn/review` would bind `platform: 'review'`.
httpRouteByMethod('cmsListenAndLearnBook', {
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/{platform}/{examCode}',
  handlers: {
    GET: (request, context) => handlers().getSet(request, context),
    PATCH: (request, context) => handlers().patchBook(request, context),
    DELETE: (request, context) => handlers().deleteBook(request, context),
  },
});

httpRouteByMethod('cmsListenAndLearnChapters', {
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/{platform}/{examCode}/chapters',
  extraOutputs: [queueOutput],
  handlers: {
    POST: (request, context) => handlers().createChapter(request, context, queueIo(context)),
    PATCH: (request, context) => handlers().reorderChapters(request, context),
  },
});

httpRouteByMethod('cmsListenAndLearnChapter', {
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/{platform}/{examCode}/chapters/{chapterId}',
  handlers: {
    PATCH: (request, context) => handlers().patchChapter(request, context),
    DELETE: (request, context) => handlers().deleteChapter(request, context),
  },
});

httpRoute('regenerateListenAndLearnChapter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/{platform}/{examCode}/chapters/{chapterId}/regenerate',
  extraOutputs: [queueOutput],
  handler: (request, context) => handlers().regenerateChapter(request, context, queueIo(context)),
});

httpRoute('deleteListenAndLearnVersion', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/{platform}/{examCode}/chapters/{chapterId}/versions/{versionId}',
  handler: (request, context) => handlers().deleteVersion(request, context),
});
