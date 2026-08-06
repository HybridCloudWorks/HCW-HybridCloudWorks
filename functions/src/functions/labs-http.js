/**
 * labs-http.js — HTTP routes for the Labs portal (VPS agent management).
 *
 * Rewired from the stub-era auth-middleware (dead audience config, see
 * cms-http.js) onto the two-gate role guard. Handler bodies unchanged pending
 * the labs-functions.js port: job-type validation against agent capabilities
 * is still TODO and tracked in .azure/api-surface.json.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, upsertDoc } from '../lib/cosmos-client.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

app.http('labsSubmitJob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'labs/jobs',
  handler: async (request, context) => {
    const auth = await getDefaultGuard().requireRole(request, 'editor');
    if (auth.error) return auth.error;

    try {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') return json(400, { error: 'Body must be a JSON object' });
      // TODO: Validate job type against capabilities (labs-functions.js port)

      const newJob = {
        id: `job-${Date.now()}`,
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...body,
      };

      const savedJob = await upsertDoc('lab_jobs', newJob);
      return json(200, { success: true, job: savedJob });
    } catch (err) {
      context.error('labsSubmitJob error:', err);
      return json(500, { error: 'Failed to submit job' });
    }
  },
});

app.http('labsGetAgents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'labs/agents',
  handler: async (request, context) => {
    const auth = await getDefaultGuard().requireRole(request, 'editor');
    if (auth.error) return auth.error;

    try {
      const docs = await queryDocs('lab_agents', 'SELECT * FROM c');
      return json(200, { agents: docs });
    } catch (err) {
      context.error('labsGetAgents error:', err);
      return json(500, { error: 'Failed to get agents' });
    }
  },
});
