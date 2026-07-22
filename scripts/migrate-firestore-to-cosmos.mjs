#!/usr/bin/env node

/**
 * migrate-firestore-to-cosmos.mjs
 *
 * Exports all Firestore collections from the Firebase project and imports
 * them into Azure Cosmos DB containers.
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a Firebase SA key
 *   - COSMOS_ENDPOINT and COSMOS_KEY env vars for the target Cosmos DB account
 *   - npm install firebase-admin @azure/cosmos in this script's context
 *
 * Usage:
 *   node scripts/migrate-firestore-to-cosmos.mjs [--dry-run] [--collections content,blogs]
 *
 * Options:
 *   --dry-run         Export from Firestore but don't write to Cosmos DB
 *   --collections     Comma-separated list of collections to migrate (default: all)
 *   --verify-only     Skip migration, just compare doc counts
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CosmosClient } from '@azure/cosmos';
import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FIRESTORE_PROJECT_ID = 'hybridcloudworks-61e8d';

// All Firestore collections to migrate, with their Cosmos DB partition key
const COLLECTION_MAP = [
  { name: 'content', partitionKey: '/cloudProvider', defaultPartition: 'unknown' },
  { name: 'blogs', partitionKey: '/cloudProvider', defaultPartition: 'unknown' },
  { name: 'certifications', partitionKey: '/issuer', defaultPartition: 'Other' },
  { name: 'speakerevents', partitionKey: '/id', defaultPartition: null },
  { name: 'lab_jobs', partitionKey: '/status', defaultPartition: 'unknown' },
  { name: 'lab_agents', partitionKey: '/agentId', defaultPartition: null },
  { name: 'config', partitionKey: '/id', defaultPartition: null },
  { name: 'dashboard_stats', partitionKey: '/id', defaultPartition: null },
  { name: 'image_prompts', partitionKey: '/id', defaultPartition: null },
  { name: 'image_prompt_sets', partitionKey: '/id', defaultPartition: null },
  { name: 'generated_content_images', partitionKey: '/contentId', defaultPartition: 'unknown' },
  { name: 'workflow_digests', partitionKey: '/id', defaultPartition: null },
  { name: 'users', partitionKey: '/id', defaultPartition: null },
  { name: 'audits', partitionKey: '/userId', defaultPartition: 'system' },
];

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify-only');

const collectionsArg = args.find((a) => a.startsWith('--collections'));
const collectionsArgValue = collectionsArg
  ? args[args.indexOf(collectionsArg) + 1]
  : null;
const targetCollections = collectionsArgValue
  ? collectionsArgValue.split(',').map((c) => c.trim())
  : null;

// ---------------------------------------------------------------------------
// Initialize Firebase Admin
// ---------------------------------------------------------------------------

const saKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saKeyPath) {
  console.error('❌ Set GOOGLE_APPLICATION_CREDENTIALS to the Firebase SA key JSON path');
  process.exit(1);
}

const saKey = JSON.parse(readFileSync(saKeyPath, 'utf8'));
initializeApp({ credential: cert(saKey), projectId: FIRESTORE_PROJECT_ID });
const firestore = getFirestore();

// ---------------------------------------------------------------------------
// Initialize Cosmos DB
// ---------------------------------------------------------------------------

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosDatabase = process.env.COSMOS_DATABASE || 'hybridcloudworks';

if (!cosmosEndpoint || !cosmosKey) {
  console.error('❌ Set COSMOS_ENDPOINT and COSMOS_KEY environment variables');
  process.exit(1);
}

const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = cosmosClient.database(cosmosDatabase);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert Firestore Timestamp fields to ISO 8601 strings.
 * Cosmos DB stores dates as strings; we use ISO 8601 for consistency.
 */
function transformDocument(doc, collectionConfig) {
  const data = { ...doc };

  // Ensure 'id' field exists (Cosmos DB requires it)
  if (!data.id) {
    data.id = doc._firestoreId || `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // Ensure partition key field exists
  const pkField = collectionConfig.partitionKey.replace('/', '');
  if (!data[pkField] && collectionConfig.defaultPartition) {
    data[pkField] = collectionConfig.defaultPartition;
  } else if (!data[pkField] && collectionConfig.partitionKey === '/id') {
    // For /id partitions, ensure the partition key matches the id
    data[pkField] = data.id;
  }

  // Convert all Firestore Timestamp objects to ISO strings
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        // Firestore Timestamp → ISO string
        data[key] = value.toDate().toISOString();
      } else if (value._seconds !== undefined && value._nanoseconds !== undefined) {
        // Serialized Firestore Timestamp
        data[key] = new Date(value._seconds * 1000 + value._nanoseconds / 1e6).toISOString();
      } else if (value instanceof Date) {
        data[key] = value.toISOString();
      }
    }
  }

  // Remove Firestore internal fields
  delete data._firestoreId;

  return data;
}

// ---------------------------------------------------------------------------
// Migration Functions
// ---------------------------------------------------------------------------

async function exportCollection(collectionName) {
  console.log(`📥 Exporting Firestore collection: ${collectionName}`);

  const snapshot = await firestore.collection(collectionName).get();
  const docs = [];

  snapshot.forEach((doc) => {
    docs.push({
      _firestoreId: doc.id,
      id: doc.id,
      ...doc.data(),
    });
  });

  console.log(`   → ${docs.length} documents exported`);
  return docs;
}

async function importToCosmosDB(collectionConfig, documents) {
  const containerName = collectionConfig.name;
  console.log(`📤 Importing ${documents.length} documents to Cosmos DB container: ${containerName}`);

  const container = database.container(containerName);
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const rawDoc of documents) {
    const doc = transformDocument(rawDoc, collectionConfig);

    try {
      await container.items.upsert(doc);
      successCount++;

      if (successCount % 50 === 0) {
        console.log(`   → ${successCount}/${documents.length} imported...`);
      }
    } catch (err) {
      errorCount++;
      errors.push({ id: doc.id, error: err.message });
      console.error(`   ❌ Failed to import ${doc.id}: ${err.message}`);
    }
  }

  console.log(`   ✅ ${successCount} imported, ${errorCount} errors`);

  if (errors.length > 0) {
    console.log(`   Errors:`, JSON.stringify(errors, null, 2));
  }

  return { successCount, errorCount, errors };
}

async function verifyCollection(collectionConfig) {
  const containerName = collectionConfig.name;

  // Count Firestore docs
  const firestoreSnapshot = await firestore.collection(containerName).get();
  const firestoreCount = firestoreSnapshot.size;

  // Count Cosmos DB docs
  const container = database.container(containerName);
  const { resources } = await container.items
    .query('SELECT VALUE COUNT(1) FROM c')
    .fetchAll();
  const cosmosCount = resources[0] || 0;

  const match = firestoreCount === cosmosCount;
  const symbol = match ? '✅' : '❌';

  console.log(
    `${symbol} ${containerName}: Firestore=${firestoreCount}, CosmosDB=${cosmosCount}` +
      (match ? '' : ' ⚠️  MISMATCH')
  );

  return { collection: containerName, firestoreCount, cosmosCount, match };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  HCW Firestore → Cosmos DB Migration');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Mode: ${verifyOnly ? 'VERIFY ONLY' : isDryRun ? 'DRY RUN' : '🔴 LIVE MIGRATION'}`);
  console.log(`  Source: Firestore project ${FIRESTORE_PROJECT_ID}`);
  console.log(`  Target: Cosmos DB ${cosmosEndpoint}`);
  console.log(`  Database: ${cosmosDatabase}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const collections = targetCollections
    ? COLLECTION_MAP.filter((c) => targetCollections.includes(c.name))
    : COLLECTION_MAP;

  if (collections.length === 0) {
    console.error('❌ No matching collections found');
    process.exit(1);
  }

  console.log(`Migrating ${collections.length} collections: ${collections.map((c) => c.name).join(', ')}\n`);

  if (verifyOnly) {
    console.log('--- Verification ---\n');
    const results = [];
    for (const config of collections) {
      const result = await verifyCollection(config);
      results.push(result);
    }

    console.log('\n--- Summary ---');
    const mismatches = results.filter((r) => !r.match);
    if (mismatches.length === 0) {
      console.log('✅ All collections match!');
    } else {
      console.log(`❌ ${mismatches.length} collection(s) have mismatches:`);
      mismatches.forEach((m) =>
        console.log(`   - ${m.collection}: Firestore=${m.firestoreCount}, Cosmos=${m.cosmosCount}`)
      );
    }
    return;
  }

  // Run migration
  const summary = [];

  for (const config of collections) {
    console.log(`\n--- ${config.name} ---\n`);

    const docs = await exportCollection(config.name);

    if (isDryRun) {
      console.log(`   [DRY RUN] Would import ${docs.length} documents to Cosmos DB`);
      // Show a sample transformed doc
      if (docs.length > 0) {
        const sample = transformDocument(docs[0], config);
        console.log(`   Sample transformed document:`, JSON.stringify(sample, null, 2).slice(0, 500));
      }
      summary.push({ collection: config.name, exported: docs.length, imported: 0, errors: 0 });
    } else {
      const result = await importToCosmosDB(config, docs);
      summary.push({
        collection: config.name,
        exported: docs.length,
        imported: result.successCount,
        errors: result.errorCount,
      });
    }
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Migration Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  let totalExported = 0;
  let totalImported = 0;
  let totalErrors = 0;

  for (const s of summary) {
    const status = s.errors > 0 ? '⚠️' : '✅';
    console.log(`  ${status} ${s.collection}: ${s.exported} exported, ${s.imported} imported, ${s.errors} errors`);
    totalExported += s.exported;
    totalImported += s.imported;
    totalErrors += s.errors;
  }

  console.log('');
  console.log(`  Total: ${totalExported} exported, ${totalImported} imported, ${totalErrors} errors`);
  console.log('═══════════════════════════════════════════════════════════');

  if (totalErrors > 0) {
    console.log('\n⚠️  Some documents failed to import. Review errors above.');
    process.exit(1);
  }

  if (!isDryRun) {
    console.log('\n✅ Migration complete! Run with --verify-only to confirm counts match.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
