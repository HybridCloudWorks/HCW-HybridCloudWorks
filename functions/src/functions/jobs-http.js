/**
 * jobs-http.js — enqueue and poll for in-platform asynchronous jobs (T-322).
 * Semantics in lib/jobs.js. The worker is jobs-worker.js (a queue trigger on
 * the same Storage account the host already uses, identity-based).
 *
 * The queue message goes out through an OUTPUT BINDING rather than a queue
 * client: no extra dependency, no extra credential, and the host sends it
 * with the same identity-based AzureWebJobsStorage connection the trigger
 * listens on. The binding is only set on the success path, so a 400/403/413
 * never enqueues anything.
 */
import { output } from '@azure/functions';
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc, patchDoc, replaceDocIfMatch } from '../lib/cosmos-client.js';
import { createJobHandlers, JOBS_QUEUE } from '../lib/jobs.js';

const queueOutput = output.storageQueue({
  queueName: JOBS_QUEUE,
  connection: 'AzureWebJobsStorage',
});

const handlers = () =>
  createJobHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc, patchDoc, replaceDocIfMatch },
  });

httpRoute('enqueueJob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'enqueueJob',
  extraOutputs: [queueOutput],
  handler: (request, context) =>
    handlers().enqueueJob(request, context, {
      enqueue: (message) => context.extraOutputs.set(queueOutput, message),
    }),
});

httpRoute('getJob', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'getJob',
  handler: (request, context) => handlers().getJob(request, context),
});
