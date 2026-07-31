import { app } from '@azure/functions';

/**
 * cosmos-triggers.js
 *
 * Cosmos DB change feed triggers. Replaces Firestore onWrite/onCreate triggers.
 *
 * connection: 'COSMOS_CONNECTION_STRING' must match the app setting key set by
 * Terraform (COSMOS_CONNECTION_STRING = primary_sql_connection_string).
 *
 * NOTE: The Cosmos DB change feed does NOT surface deletes. Any trigger logic
 * that requires before-image or deletion semantics must use soft-delete flags
 * or API-side orchestration. Audit all 11 original Firestore triggers before
 * porting (Migration_Plan §3.5).
 */

app.cosmosDB('onContentChange', {
  connection: 'COSMOS_CONNECTION_STRING',
  databaseName: process.env.COSMOS_DATABASE || 'hybridcloudworks',
  containerName: 'content',
  createLeaseContainerIfNotExists: false, // leases container is managed by Terraform
  leaseContainerName: 'leases',
  leaseContainerPrefix: 'content_',
  handler: async (documents, context) => {
    context.log(`Cosmos DB trigger: ${documents.length} content document(s) changed`);

    for (const doc of documents) {
      // TODO: Port side effects from original onDocumentWritten handlers:
      // - AI summary generation
      // - Social media cross-posting dispatch (via queue)
      // - Search index update
      context.log(`Content doc changed: ${doc.id}`);
    }
  }
});

app.cosmosDB('onLabJobChange', {
  connection: 'COSMOS_CONNECTION_STRING',
  databaseName: process.env.COSMOS_DATABASE || 'hybridcloudworks',
  containerName: 'lab_jobs',
  createLeaseContainerIfNotExists: false,
  leaseContainerName: 'leases',
  leaseContainerPrefix: 'lab_jobs_',
  handler: async (documents, context) => {
    for (const doc of documents) {
      // TODO: If status == 'completed', notify the user.
      // If status == 'failed', trigger alert via queue.
      context.log(`Lab job changed: ${doc.id} status=${doc.status}`);
    }
  }
});
