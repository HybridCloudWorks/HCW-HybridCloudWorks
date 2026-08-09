import { app } from '@azure/functions';

// Import all triggers so they are registered with the Azure Functions framework
import './admin-crud-http.js';
import './admin-identity-http.js';
import './admin-integrations-http.js';
import './admin-uploads-http.js';
import './admin-snapshots-http.js';
import './cms-http.js';
import './content-workflow-http.js';
import './gallery-images-http.js';
import './image-prompts-http.js';
import './labs-http.js';
import './ops-health-http.js';
import './public-media.js';
import './public-reads.js';
import './publish-http.js';
import './public-submissions.js';
import './schedulers.js';
import './cosmos-triggers.js';

const BUILD_TIME = new Date().toISOString();

app.http('healthCheck', {
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
        region: process.env.REGION_NAME || process.env.WEBSITE_SITE_NAME || 'local',
        node: process.version,
        schedulers: process.env.FEATURE_FLAG_SCHEDULERS === 'true' ? 'enabled' : 'disabled',
        startedAt: BUILD_TIME,
      }),
    };
  },
});

