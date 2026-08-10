import { app } from '@azure/functions';
import * as store from '../lib/cosmos-client.js';
import { createPublishHandlers } from '../lib/cms/publish.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createScheduledPublisher } from '../lib/scheduled-publish.js';

/**
 * schedulers.js
 *
 * Timer triggers replacing Firebase Cloud Scheduler / scheduled functions.
 *
 * **Each timer has its own flag.** They shared `FEATURE_FLAG_SCHEDULERS`, which
 * meant enabling any one of them enabled all four — including
 * `cleanupTempStorage`, which is an unimplemented TODO that deletes blobs.
 * Turning on the scheduled publisher would have armed a blob-deletion job at
 * the same time, and only `delete_retention_policy { days = 7 }` would have
 * made that recoverable (TODO.md T-302).
 *
 * `FEATURE_FLAG_SCHEDULERS` is still honoured as the master switch, so an
 * existing "false" keeps everything off, but "true" no longer enables anything
 * on its own: a timer runs when the master switch is not explicitly false AND
 * its own flag is "true". Timers fire on schedule regardless — the flags make
 * them safe no-ops.
 */

const masterDisabled = () => process.env.FEATURE_FLAG_SCHEDULERS === 'false';

/**
 * @param {string} name - env var suffix, e.g. 'PUBLISH_SCHEDULED'
 */
const timerEnabled = (name) =>
  !masterDisabled() && process.env[`FEATURE_FLAG_${name}`] === 'true';

app.timer('syncRssFeeds', {
  schedule: '0 0 * * * *', // every hour
  handler: async (myTimer, context) => {
    if (!timerEnabled('SYNC_RSS_FEEDS')) {
      context.log('[syncRssFeeds] disabled — skipping');
      return;
    }
    context.log('Running RSS feed sync...');
    // TODO: Fetch feed URLs from Cosmos DB config, parse, upsert content docs.
    // Cap items[] per document at write time when this lands — see TODO.md T-319.
  },
});

app.timer('publishScheduledContent', {
  schedule: '0 */15 * * * *', // every 15 minutes
  handler: async (myTimer, context) => {
    if (!timerEnabled('PUBLISH_SCHEDULED_CONTENT')) {
      context.log('[publishScheduledContent] disabled — skipping');
      return;
    }
    // Built per invocation rather than at module load: the publish factory
    // reaches for a Cosmos client, and this file is imported by index.js on
    // every cold start, including for anonymous GETs that never publish
    // anything.
    const publish = createPublishHandlers({ guard: getDefaultGuard(), store });
    const publisher = createScheduledPublisher({ store, publish });
    await publisher.runScheduledPublish(context);
  },
});

app.timer('cleanupTempStorage', {
  schedule: '0 0 0 * * *', // daily at midnight UTC
  handler: async (myTimer, context) => {
    if (!timerEnabled('CLEANUP_TEMP_STORAGE')) {
      context.log('[cleanupTempStorage] disabled — skipping');
      return;
    }
    context.log('Running storage cleanup...');
    // TODO: identify and delete orphaned blobs using blob-storage.js.
    //
    // NOT implemented, and the flag exists so that enabling the publisher does
    // not enable this. Whoever writes it: make the first version dry-run, and
    // read TODO.md T-302 first — the orphan query has to enumerate every blob
    // and every referencing document, and anything it fails to enumerate it
    // classifies as an orphan and deletes.
  },
});

app.timer('checkAgentHealth', {
  schedule: '0 */5 * * * *', // every 5 minutes
  handler: async (myTimer, context) => {
    if (!timerEnabled('CHECK_AGENT_HEALTH')) {
      context.log('[checkAgentHealth] disabled — skipping');
      return;
    }
    context.log('Running agent health check...');
    // TODO: query lab_agents and mark stale ones offline. Note the field is
    // `lastSeenAt`, written server-side by the agent heartbeat route — not
    // `lastPing`, which never existed on the read side (TODO.md T-401).
  },
});
