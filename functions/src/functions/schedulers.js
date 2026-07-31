import { app } from '@azure/functions';

/**
 * schedulers.js
 *
 * Timer triggers replacing Firebase Cloud Scheduler / scheduled functions.
 *
 * All handlers are gated by FEATURE_FLAG_SCHEDULERS="true" (app setting set by
 * Terraform). Set to "false" until business logic is ported from the source repo.
 * Timers fire on schedule regardless — the flag makes them safe no-ops until ready.
 */

const schedulersEnabled = () => process.env.FEATURE_FLAG_SCHEDULERS === 'true';

app.timer('syncRssFeeds', {
  schedule: '0 0 * * * *', // every hour
  handler: async (myTimer, context) => {
    if (!schedulersEnabled()) {
      context.log('[syncRssFeeds] FEATURE_FLAG_SCHEDULERS=false — skipping');
      return;
    }
    context.log('Running RSS feed sync...');
    // TODO: Fetch feed URLs from Cosmos DB config, parse, upsert content docs
  }
});

app.timer('publishScheduledContent', {
  schedule: '0 */15 * * * *', // every 15 minutes
  handler: async (myTimer, context) => {
    if (!schedulersEnabled()) {
      context.log('[publishScheduledContent] FEATURE_FLAG_SCHEDULERS=false — skipping');
      return;
    }
    context.log('Running scheduled content publish...');
    // TODO: Query Cosmos DB for draft content with publishedAt <= now, set to published
  }
});

app.timer('cleanupTempStorage', {
  schedule: '0 0 0 * * *', // daily at midnight UTC
  handler: async (myTimer, context) => {
    if (!schedulersEnabled()) {
      context.log('[cleanupTempStorage] FEATURE_FLAG_SCHEDULERS=false — skipping');
      return;
    }
    context.log('Running storage cleanup...');
    // TODO: Identify and delete orphaned blobs using blob-storage.js
  }
});

app.timer('checkAgentHealth', {
  schedule: '0 */5 * * * *', // every 5 minutes
  handler: async (myTimer, context) => {
    if (!schedulersEnabled()) {
      context.log('[checkAgentHealth] FEATURE_FLAG_SCHEDULERS=false — skipping');
      return;
    }
    context.log('Running agent health check...');
    // TODO: Query lab_agents in Cosmos DB, mark offline if lastPing > 5 mins ago
  }
});
