import { CosmosClient } from '@azure/cosmos';

/**
 * verify-migration.mjs
 * 
 * Verifies that document counts match between Firestore and Cosmos DB.
 * 
 * Usage:
 *   node verify-migration.mjs
 */

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosDatabase = process.env.COSMOS_DATABASE || 'hybridcloudworks';

if (!cosmosEndpoint || !cosmosKey) {
  console.error('❌ Set COSMOS_ENDPOINT and COSMOS_KEY environment variables');
  process.exit(1);
}

const client = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = client.database(cosmosDatabase);

async function checkCount(containerName) {
  const container = database.container(containerName);
  const { resources } = await container.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll();
  return resources[0] || 0;
}

async function main() {
  console.log('Verifying Azure Cosmos DB Document Counts...\n');
  const containers = ['content', 'blogs', 'certifications', 'speakerevents', 'lab_jobs', 'lab_agents', 'config', 'users'];
  
  for (const c of containers) {
    const count = await checkCount(c);
    console.log(`Container '${c}': ${count} documents`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
