import { app } from '@azure/functions';
import { requireAdminClaims, jsonResponse, errorResponse } from '../lib/auth-middleware.js';
import { queryDocs, upsertDoc } from '../lib/cosmos-client.js';

/**
 * labs-http.js
 * 
 * HTTP triggers for the Labs portal (managing the VPS agent).
 * Ported from Firebase Cloud Functions.
 * 
 * TODO: Port the business logic from Personal-Site_HCW/functions/labs-functions.js
 */

app.http('labsSubmitJob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'labs/jobs',
  handler: async (request, context) => {
    try {
      const auth = await requireAdminClaims(request, ['editor']);
      if (auth.error) return auth.error;

      const body = await request.json();
      // TODO: Validate job type against capabilities
      
      const newJob = {
        id: `job-${Date.now()}`,
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...body
      };
      
      const savedJob = await upsertDoc('lab_jobs', newJob);
      return jsonResponse({ success: true, job: savedJob });
      
    } catch (err) {
      context.error('labsSubmitJob error:', err);
      return errorResponse('Failed to submit job', 500);
    }
  }
});

app.http('labsGetAgents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'labs/agents',
  handler: async (request, context) => {
    try {
      const auth = await requireAdminClaims(request, ['editor']);
      if (auth.error) return auth.error;

      const docs = await queryDocs('lab_agents', 'SELECT * FROM c');
      return jsonResponse({ agents: docs });
      
    } catch (err) {
      context.error('labsGetAgents error:', err);
      return errorResponse('Failed to get agents', 500);
    }
  }
});
