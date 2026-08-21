/**
 * jobs-worker.js — the queue-triggered side of lib/jobs.js (T-322).
 *
 * Runs under the NON-HTTP timeout (30 minutes on Flex Consumption), which is
 * the whole reason the six long handlers move here. The host creates the
 * queue on first start if it does not exist (the app's identity holds Queue
 * Data Contributor on AzureWebJobsStorage). Messages the SDK cannot hand to a
 * handler five times land in `platform-jobs-poison`; lib/jobs.js makes that
 * rare by never throwing for a job-level failure.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc, patchDoc, replaceDocIfMatch } from '../lib/cosmos-client.js';
import { createJobHandlers, JOBS_QUEUE } from '../lib/jobs.js';

const handlers = () =>
  createJobHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc, patchDoc, replaceDocIfMatch },
  });

app.storageQueue('platformJobWorker', {
  queueName: JOBS_QUEUE,
  connection: 'AzureWebJobsStorage',
  handler: (message, context) => handlers().runJob(message, context),
});
