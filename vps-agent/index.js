/**
 * hcw-vps-agent
 * 
 * Replaces the Firebase vps-agent.
 * Connects to Azure Cosmos DB instead of Firestore to pull jobs from the 'lab_jobs' container
 * and reports status back.
 * 
 * TODO: Port the original logic from Personal-Site_HCW/labs/vps-agent/index.js
 */

import { CosmosClient } from '@azure/cosmos';
import * as dotenv from 'dotenv';
dotenv.config();

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosDatabase = process.env.COSMOS_DATABASE || 'hybridcloudworks';

if (!cosmosEndpoint || !cosmosKey) {
  console.error('❌ Set COSMOS_ENDPOINT and COSMOS_KEY environment variables');
  process.exit(1);
}

const client = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = client.database(cosmosDatabase);
const jobsContainer = database.container('lab_jobs');
const agentsContainer = database.container('lab_agents');

// Mock Agent ID
const AGENT_ID = process.env.AGENT_ID || 'vps-hostinger-01';

async function registerAgent() {
  await agentsContainer.items.upsert({
    id: AGENT_ID,
    agentId: AGENT_ID,
    status: 'online',
    lastPing: new Date().toISOString()
  });
  console.log(`[Agent] Registered ${AGENT_ID} online.`);
}

async function pollJobs() {
  console.log('[Agent] Polling for pending jobs...');
  // TODO: Implement change feed listener or periodic polling loop to fetch jobs
  // where status = 'pending'
}

async function main() {
  console.log('Starting Azure-native VPS Lab Agent...');
  await registerAgent();
  
  // TODO: Start heartbeat interval
  
  // Start job polling
  await pollJobs();
}

main().catch(err => {
  console.error('Fatal agent error:', err);
  process.exit(1);
});
