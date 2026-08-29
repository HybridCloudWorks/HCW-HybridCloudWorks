/**
 * schedulers.js — the timer triggers replacing Firebase Cloud Scheduler
 * (Migration-Plan §4.2, TODO T-323).
 *
 * **Each timer has its own flag.** A timer runs when the master switch
 * `FEATURE_FLAG_SCHEDULERS` is not explicitly "false" AND its own
 * `FEATURE_FLAG_<NAME>` is "true". Timers fire on schedule regardless — the
 * flags make them safe no-ops — and every flag is "false" in `infra/main.tf`
 * until that timer has been observed firing at the intended local time
 * (§6 step 7).
 *
 * The clock is `WEBSITE_TIME_ZONE = America/Chicago` (app-wide); the NCRONTAB
 * expressions below are the §4.2 translations. One timer from the upstream
 * sixteen is not here: `refreshToolServiceCacheScheduled` (demoted with Cloud
 * Tools, T-322). Two delete blobs — `cleanupTempStorage`, `cleanupUnusedCertImages`
 * — and both are dry-run until their own `*_DELETE=true` setting (T-302).
 *
 * Every handler builds its dependencies per invocation, not at module load:
 * this file is imported by index.js on every cold start, including for
 * anonymous GETs that never run a timer.
 */
import { app } from '@azure/functions';
import * as store from '../lib/cosmos-client.js';
import * as blobStorage from '../lib/blob-storage.js';
import { createPublishHandlers } from '../lib/cms/publish.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createScheduledPublisher } from '../lib/scheduled-publish.js';
import { createSnapshotPublishHandlers } from '../lib/snapshots-publish.js';
import { createReviewerDigest } from '../lib/timers/reviewer-digest.js';
import { createContentCleanup } from '../lib/timers/content-cleanup.js';
import { createPublishingWatchdog } from '../lib/timers/publishing-watchdog.js';
import { createLinkCheck } from '../lib/timers/link-check.js';
import { createCertReverify } from '../lib/timers/cert-reverify.js';
import { createCertImageCleanup } from '../lib/timers/cert-image-cleanup.js';
import { createSkillsHubScrape } from '../lib/timers/skills-hub.js';
import { createPlaudTokenRefresh } from '../lib/timers/plaud-token.js';
import { createAgentHealthCheck } from '../lib/timers/agent-health.js';
import { createTempStorageCleanup } from '../lib/timers/temp-storage.js';
import { createForgeScheduled } from '../lib/timers/forge-scheduled.js';
import { findDuplicateContent, buildDedupFields } from '../lib/cms/content-dedup.js';
import { createPublerClient, createPublerReconcile } from '../lib/timers/publer-sync.js';
import { createBlogListingsScrape } from '../lib/timers/blog-listings.js';
import { createPodcastIngest, createPodcastParser } from '../lib/timers/podcasts.js';

const masterDisabled = () => process.env.FEATURE_FLAG_SCHEDULERS === 'false';

/** @param {string} name - env var suffix, e.g. 'PUBLISH_SCHEDULED_CONTENT' */
const timerEnabled = (name) => !masterDisabled() && process.env[`FEATURE_FLAG_${name}`] === 'true';

/**
 * Register a flag-gated timer. `run(context)` returns a small summary that is
 * logged; a thrown error is logged and rethrown so the host records the
 * failure.
 */
function timer(name, flag, schedule, run) {
  app.timer(name, {
    schedule,
    handler: async (_timer, context) => {
      if (!timerEnabled(flag)) {
        context.log(`[${name}] disabled — skipping`);
        return;
      }
      const result = await run(context);
      if (result !== undefined) context.log(`[${name}] ${JSON.stringify(result)}`);
    },
  });
}

const storage = () => ({ listBlobs: blobStorage.listBlobs, deleteBlob: blobStorage.deleteBlob });

// ── Ingestion and drafting ───────────────────────────────────────────────────

timer('syncRssFeeds', 'SYNC_RSS_FEEDS', '0 0 */2 * * *', async (context) => {
  // Site-Main: `every 2 hours`. Same ingest as the fetch-rss-feeds job.
  const { runRssIngest } = await import('./rss-jobs.js');
  const results = await runRssIngest(context);
  return {
    processed: results.processed,
    newContent: results.newContent,
    errors: results.errors.length,
  };
});

timer('fetchPodcastFeeds', 'FETCH_PODCAST_FEEDS', '0 30 */2 * * *', async (context) =>
  // Site-Main: `every 2 hours`, offset from syncRssFeeds.
  createPodcastIngest({ store, parser: await createPodcastParser(), log: context }).run()
);

timer('fetchBlogListings', 'FETCH_BLOG_LISTINGS', '0 15 */6 * * *', (context) =>
  // Site-Main: `every 6 hours`. Skips itself while FIRECRAWL_API_KEY is a stub.
  createBlogListingsScrape({
    store,
    dedup: { findDuplicateContent, buildDedupFields },
    log: context,
  }).run()
);

timer('forgeScheduled', 'FORGE_SCHEDULED', '0 30 3 * * *', async (context) => {
  // Site-Main: `every 24 hours`. Off twice over: this flag and the Auto-Forge
  // toggle in Forge Memory (admin_config/forge_prompts.autoForge).
  const [{ defaultForgeConfig }, { createDrafter }, { createGrader }, { createForge }, ai] =
    await Promise.all([
      // The process-wide loader, NOT a private instance: a Forge Studio edit
      // clears the cache this timer reads (forge-config-default.js, #239).
      import('../lib/content/forge-config-default.js'),
      import('../lib/content/drafting.js'),
      import('../lib/content/forge-grader.js'),
      import('../lib/content/forge.js'),
      import('../lib/ai/router.js'),
    ]);
  const config = defaultForgeConfig;
  const forge = createForge({
    store,
    config,
    drafter: createDrafter({ store, ai }),
    grader: createGrader({ ai }),
    log: context,
  });
  return createForgeScheduled({ store, config, forge, log: context }).run();
});

// ── Publishing ───────────────────────────────────────────────────────────────

timer('publishScheduledContent', 'PUBLISH_SCHEDULED_CONTENT', '0 */15 * * * *', async (context) => {
  const publish = createPublishHandlers({ guard: getDefaultGuard(), store });
  await createScheduledPublisher({ store, publish }).runScheduledPublish(context);
});

timer('monitorPublishingPipeline', 'MONITOR_PUBLISHING_PIPELINE', '0 0 */6 * * *', (context) =>
  createPublishingWatchdog({ store, log: context }).run()
);

timer('generateReviewerDigest', 'GENERATE_REVIEWER_DIGEST', '0 0 7 * * *', (context) =>
  createReviewerDigest({ store, log: context }).run()
);

timer('checkLiveLinks', 'CHECK_LIVE_LINKS', '0 0 6 * * 1', (context) =>
  createLinkCheck({ store, log: context }).run()
);

// ── Retirement ───────────────────────────────────────────────────────────────

timer('cleanupRejectedContent', 'CLEANUP_REJECTED_CONTENT', '0 0 4 * * *', (context) =>
  createContentCleanup({ store, log: context }).softDeleteRejected({
    olderThanHours: 24,
    limit: 500,
  })
);

timer('cleanupSoftDeletedContent', 'CLEANUP_SOFT_DELETED_CONTENT', '0 0 */4 * * *', (context) =>
  // 7-day grace window from softDeletedAt; with the 24 h above, an accidental
  // rejection is recoverable for ~8 days.
  createContentCleanup({ store, log: context }).hardDeleteSoftDeleted({
    olderThanHours: 24 * 7,
    limit: 200,
  })
);

timer('cleanupTempStorage', 'CLEANUP_TEMP_STORAGE', '0 0 0 * * *', (context) =>
  // T-302: prefix + age, dry-run until TEMP_STORAGE_CLEANUP_DELETE=true.
  createTempStorageCleanup({ storage: storage(), log: context }).run()
);

timer('cleanupUnusedCertImages', 'CLEANUP_UNUSED_CERT_IMAGES', '0 0 5 * * *', (context) =>
  // Dry-run until CERT_IMAGE_CLEANUP_DELETE=true.
  createCertImageCleanup({ store, storage: storage(), log: context }).run()
);

// ── Certifications ───────────────────────────────────────────────────────────

timer('reVerifyCertifications', 'REVERIFY_CERTIFICATIONS', '0 0 0 * * 0', (context) => {
  const snapshots = createSnapshotPublishHandlers({ guard: getDefaultGuard(), store });
  return createCertReverify({
    store,
    publishSnapshots: snapshots.publishSnapshots,
    log: context,
  }).run();
});

timer('scrapeSkillsHubRss', 'SCRAPE_SKILLS_HUB_RSS', '0 0 4 * * 5', async (context) => {
  // Site-Main: `every friday 09:00` UTC; 04:00 CDT (03:00 CST) here.
  const { createRssParser } = await import('../lib/rss/ingest.js');
  return createSkillsHubScrape({ store, parser: await createRssParser(), log: context }).run();
});

// ── Platform ─────────────────────────────────────────────────────────────────

timer('syncSocialCalendarScheduled', 'SYNC_SOCIAL_CALENDAR', '0 */5 * * * *', (context) =>
  // Site-Main: `every 5 minutes`. D12: the live writer of social_posts — this
  // flag stays off until the cutover delta import is done (§6).
  createPublerReconcile({ store, client: createPublerClient(), log: context }).run()
);

timer('refreshPlaudToken', 'REFRESH_PLAUD_TOKEN', '0 0 */12 * * *', (context) =>
  createPlaudTokenRefresh({ store, log: context }).run()
);

timer('checkAgentHealth', 'CHECK_AGENT_HEALTH', '0 */5 * * * *', (context) =>
  createAgentHealthCheck({ store, log: context }).run()
);
