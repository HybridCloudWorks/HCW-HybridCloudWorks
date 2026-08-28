/**
 * change-feed.js — the Cosmos change-feed functions replacing Site-Main's
 * eleven Firestore triggers (Migration_Plan §4.3, TODO T-324).
 *
 * One function per watched container, six in all, on the IDENTITY-BASED
 * binding (`COSMOS_CONNECTION__accountEndpoint` + `__credential =
 * managedidentity`, infra/main.tf — never a connection string, T-315). All
 * six share the `leases` container with a distinct prefix each. The handler
 * logic is lib/triggers/handlers.js; dependencies are built per invocation.
 *
 * Not registered: `syncToolExpertModeRuns` (lab_jobs → Cloud Tools artifact
 * sync; nothing here writes `artifactRef`, demoted with Cloud Tools).
 *
 * The three delete paths the feed cannot see live on the HTTP side:
 *   DELETE /api/cms/content/{id} + POST deleteContentItem → dashboard counters
 *   DELETE /api/cms/social-posts/{id}                     → Publer un-publish
 *   DELETE /api/cms/blogs/{id}                            → the slug page IS the document
 */
import { app } from '@azure/functions';
import * as store from '../lib/cosmos-client.js';
import * as blobStorage from '../lib/blob-storage.js';
import { createFeedHandlers } from '../lib/triggers/handlers.js';
import { createImageMirror } from '../lib/triggers/image-mirror.js';
import { createDashboardStatsMaintainer } from '../lib/triggers/dashboard-stats.js';
import { createAiCoverGenerator, createReplicateClient } from '../lib/triggers/ai-cover.js';
import { createForgeReadyNotifier } from '../lib/triggers/forge-ready-notify.js';
import { createNotifier } from '../lib/notify.js';
import { createPublerClient } from '../lib/timers/publer-sync.js';

export const COSMOS_CONNECTION = 'COSMOS_CONNECTION';
export const LEASE_CONTAINER = 'leases';

const databaseName = () => process.env.COSMOS_DATABASE || 'hcw';

async function handlers(context) {
  const storage = { uploadBlob: blobStorage.uploadBlob };
  const [{ createInspector }, { createCritic }, { scrapeArticle }, ai] = await Promise.all([
    import('../lib/content/inspect.js'),
    import('../lib/content/critique.js'),
    import('../lib/content/scrape.js'),
    import('../lib/ai/router.js'),
  ]);
  const notifier = createNotifier({ store, log: context });
  return createFeedHandlers({
    store,
    mirror: createImageMirror({ store, storage, log: context }),
    inspector: createInspector({
      store,
      ai,
      scrape: (url) => scrapeArticle(url, { log: context }),
      critic: createCritic({ ai }),
      log: context,
    }),
    aiCover: createAiCoverGenerator({
      store,
      storage,
      replicate: createReplicateClient(),
      uuid: () => crypto.randomUUID(),
      log: context,
    }),
    forgeReadyNotify: createForgeReadyNotifier({ store, notifier, log: context }),
    dashboardStats: createDashboardStatsMaintainer({ store, log: context }),
    notifier,
    publer: createPublerClient(),
  });
}

function feed(name, containerName, pick) {
  app.cosmosDB(name, {
    connection: COSMOS_CONNECTION,
    databaseName: databaseName(),
    containerName,
    leaseContainerName: LEASE_CONTAINER,
    leaseContainerPrefix: `${name}-`,
    createLeaseContainerIfNotExists: false,
    startFromBeginning: false,
    maxItemsPerInvocation: 50,
    handler: async (documents, context) => {
      if (!Array.isArray(documents) || documents.length === 0) return;
      const results = await pick(await handlers(context))(documents, context);
      context.log(
        `[${name}] ${documents.length} change(s): ${JSON.stringify(results).slice(0, 2000)}`
      );
    },
  });
}

feed('mirrorSpeakerEventImages', 'speakerevents', (h) => h.speakerevents);
feed('mirrorCertificationImages', 'certifications', (h) => h.certifications);
feed('processBlogChanges', 'blogs', (h) => h.blogs);
feed('processContentChanges', 'content', (h) => h.content);
feed('notifyWorkflowAlerts', 'workflow_alerts', (h) => h.workflowAlerts);
feed('syncSocialPostsToPubler', 'social_posts', (h) => h.socialPosts);
