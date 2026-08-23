import { httpRoute, readConfigStamp } from '../lib/auth/http-route.js';

// Import all triggers so they are registered with the Azure Functions framework
import './admin-crud-http.js';
import './admin-identity-http.js';
import './admin-integrations-http.js';
import './ai-proxy-http.js';
import './integrations-http.js';
import './admin-uploads-http.js';
import './admin-snapshots-http.js';
import './cms-http.js';
import './content-workflow-http.js';
import './gallery-images-http.js';
import './image-prompts-http.js';
import './inspect-jobs.js';
import './forge-jobs.js';
import './jobs-sweeper.js';
import './change-feed.js';
import './jobs-http.js';
import './jobs-worker.js';
import './lab-agent-http.js';
import './labs-http.js';
import './legacy-blogs-telemetry-http.js';
import './ops-health-http.js';
import './platform-health-http.js';
import './public-media.js';
import './public-reads.js';
import './publish-http.js';
import './rss-jobs.js';
import './public-submissions.js';
import './schedulers.js';
import './telegram-http.js';

const BUILD_TIME = new Date().toISOString();

/**
 * Liveness probe. Anonymous, and therefore says as little as possible.
 *
 * It used to return `node: process.version`, the site name, and whether the
 * schedulers flag was on — an unauthenticated inventory of the runtime version
 * and deployment name, which is the first thing anyone enumerating a host
 * looks for and is of no use to a probe (TODO.md T-402). A liveness check
 * needs one bit: is the host answering.
 *
 * `startedAt` stays. It is the one field with an operational use — telling a
 * cold start from a warm instance while diagnosing — and it discloses nothing
 * about the software.
 */
httpRoute('healthCheck', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health', // resolves to GET /api/health
  handler: async (request, context) => {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        service: 'hcw-functions',
        startedAt: BUILD_TIME,
        // T-513's second observation channel. Application Insights went blind
        // for six hours on 2026-08-22 (T-514) while this endpoint kept
        // answering, so the configuration generation a worker is running must
        // be readable without it.
        //
        // This is a deliberate, narrow exception to T-402, which stripped
        // `node`, the site name and a feature flag from this response. Those
        // disclosed the runtime version and deployment topology to anyone
        // enumerating the host. These two disclose neither: `generation` is a
        // CI run id and a commit SHA from a public repository, and `writer` is
        // one of `azurerm`, `azapi-strip`, `cli` or `unset`. Neither is a
        // secret, a version, or a name — and both are useless to an attacker
        // and load-bearing for an operator.
        ...readConfigStamp(),
      }),
    };
  },
});
