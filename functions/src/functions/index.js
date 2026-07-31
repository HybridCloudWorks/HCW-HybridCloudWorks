import { app } from '@azure/functions';

// Import all triggers so they are registered with the Azure Functions framework
import './cms-http.js';
import './labs-http.js';
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

