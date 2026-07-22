import { app } from '@azure/functions';

// Import all triggers so they are registered with the Azure Functions framework
import './cms-http.js';
import './labs-http.js';
import './schedulers.js';
import './cosmos-triggers.js';

app.http('healthCheck', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    return { status: 200, body: JSON.stringify({ status: 'ok', message: 'Azure Functions running' }) };
  }
});

