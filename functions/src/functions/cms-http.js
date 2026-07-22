import { app } from '@azure/functions';
import { requireAdminClaims, jsonResponse, errorResponse } from '../lib/auth-middleware.js';
import { queryDocs, getContainer, upsertDoc, deleteDoc } from '../lib/cosmos-client.js';

/**
 * cms-http.js
 * 
 * HTTP triggers for the CMS admin portal. Ported from Firebase Cloud Functions.
 * 
 * TODO: Port the business logic from Personal-Site_HCW/functions/cms-functions.js
 * The Azure Functions v4 wiring and auth middleware are set up below.
 */

// ---------------------------------------------------------------------------
// Get Content List
// ---------------------------------------------------------------------------
app.http('cmsGetContent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/content',
  handler: async (request, context) => {
    try {
      const auth = await requireAdminClaims(request, ['editor']);
      if (auth.error) return auth.error;

      // TODO: Implement pagination and filtering logic from original
      const limit = parseInt(request.query.get('limit') || '50', 10);
      
      const query = 'SELECT * FROM c ORDER BY c.updatedAt DESC OFFSET 0 LIMIT @limit';
      const parameters = [{ name: '@limit', value: limit }];
      
      const docs = await queryDocs('content', query, parameters);
      return jsonResponse({ content: docs });
      
    } catch (err) {
      context.error('cmsGetContent error:', err);
      return errorResponse('Failed to fetch content', 500);
    }
  }
});

// ---------------------------------------------------------------------------
// Save/Update Content
// ---------------------------------------------------------------------------
app.http('cmsSaveContent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/content',
  handler: async (request, context) => {
    try {
      const auth = await requireAdminClaims(request, ['editor']);
      if (auth.error) return auth.error;

      const body = await request.json();
      
      // TODO: Implement validation, default values, and AI generation hooks
      // from original saveContent function.
      
      const savedDoc = await upsertDoc('content', body);
      return jsonResponse({ success: true, id: savedDoc.id, doc: savedDoc });
      
    } catch (err) {
      context.error('cmsSaveContent error:', err);
      return errorResponse('Failed to save content', 500);
    }
  }
});

// ---------------------------------------------------------------------------
// Delete Content
// ---------------------------------------------------------------------------
app.http('cmsDeleteContent', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/content/{id}',
  handler: async (request, context) => {
    try {
      const auth = await requireAdminClaims(request, ['editor']);
      if (auth.error) return auth.error;

      const id = request.params.id;
      // TODO: Delete associated blobs (images/covers) via blob-storage.js
      // before deleting the document.
      
      await deleteDoc('content', id);
      return jsonResponse({ success: true });
      
    } catch (err) {
      context.error('cmsDeleteContent error:', err);
      return errorResponse('Failed to delete content', 500);
    }
  }
});

// ---------------------------------------------------------------------------
// Generate Content via AI
// ---------------------------------------------------------------------------
app.http('cmsGenerateContent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/generate',
  handler: async (request, context) => {
    try {
      const auth = await requireAdminClaims(request, ['editor']);
      if (auth.error) return auth.error;

      const body = await request.json();
      // TODO: Port the Langchain / Vertex AI / Replicate logic here.
      // Make sure to fetch API keys from Key Vault if not in App Settings.
      
      return jsonResponse({ success: true, result: "TODO: AI output" });
      
    } catch (err) {
      context.error('cmsGenerateContent error:', err);
      return errorResponse('Failed to generate content', 500);
    }
  }
});
