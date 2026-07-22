/**
 * Cosmos DB data access layer for Azure Functions.
 *
 * Replaces firebase-admin/firestore with @azure/cosmos.
 * Provides the same query patterns used in cms-functions.js.
 */

import { CosmosClient } from '@azure/cosmos';

let client = null;
let database = null;

/**
 * Initialize or return the singleton Cosmos DB client.
 * Connection details come from Azure Function App Settings
 * (set by Terraform in the azurerm_linux_function_app resource).
 */
export function getCosmosDb() {
  if (database) return database;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const databaseId = process.env.COSMOS_DATABASE || 'hybridcloudworks';

  if (!endpoint || !key) {
    throw new Error('Missing COSMOS_ENDPOINT or COSMOS_KEY environment variables');
  }

  client = new CosmosClient({ endpoint, key });
  database = client.database(databaseId);

  return database;
}

/**
 * Get a Cosmos DB container reference.
 * @param {string} containerName - e.g. 'content', 'blogs', 'lab_jobs'
 */
export function getContainer(containerName) {
  return getCosmosDb().container(containerName);
}

/**
 * Read a single document by ID.
 * Equivalent to: admin.firestore().collection(name).doc(id).get()
 *
 * @param {string} containerName
 * @param {string} id
 * @param {string} [partitionKey] - defaults to id
 * @returns {Promise<object|null>}
 */
export async function readDoc(containerName, id, partitionKey) {
  const container = getContainer(containerName);
  try {
    const { resource } = await container.item(id, partitionKey || id).read();
    return resource || null;
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

/**
 * Write or replace a document (upsert).
 * Equivalent to: admin.firestore().collection(name).doc(id).set(data, { merge: true })
 *
 * @param {string} containerName
 * @param {object} document - must include 'id' field
 * @returns {Promise<object>}
 */
export async function upsertDoc(containerName, document) {
  const container = getContainer(containerName);
  const { resource } = await container.items.upsert(document);
  return resource;
}

/**
 * Delete a document by ID.
 * Equivalent to: admin.firestore().collection(name).doc(id).delete()
 *
 * @param {string} containerName
 * @param {string} id
 * @param {string} [partitionKey]
 */
export async function deleteDoc(containerName, id, partitionKey) {
  const container = getContainer(containerName);
  await container.item(id, partitionKey || id).delete();
}

/**
 * Query documents with SQL.
 * Equivalent to: admin.firestore().collection(name).where(...).orderBy(...).limit(n).get()
 *
 * @param {string} containerName
 * @param {string} query - Cosmos DB SQL query
 * @param {Array<{name: string, value: any}>} [parameters]
 * @param {object} [options]
 * @param {number} [options.maxItemCount]
 * @returns {Promise<object[]>}
 */
export async function queryDocs(containerName, query, parameters = [], options = {}) {
  const container = getContainer(containerName);
  const { resources } = await container.items
    .query({ query, parameters }, { maxItemCount: options.maxItemCount })
    .fetchAll();
  return resources;
}

/**
 * Count documents matching a query.
 * Equivalent to: admin.firestore().collection(name).count().get()
 *
 * @param {string} containerName
 * @param {string} [whereClause] - SQL WHERE clause (omit 'WHERE')
 * @param {Array<{name: string, value: any}>} [parameters]
 * @returns {Promise<number>}
 */
export async function countDocs(containerName, whereClause, parameters = []) {
  const container = getContainer(containerName);
  const query = whereClause
    ? `SELECT VALUE COUNT(1) FROM c WHERE ${whereClause}`
    : 'SELECT VALUE COUNT(1) FROM c';
  const { resources } = await container.items
    .query({ query, parameters })
    .fetchAll();
  return resources[0] || 0;
}

/**
 * Batch read multiple documents by IDs.
 * No direct Firestore equivalent — uses Promise.all on individual reads.
 *
 * @param {string} containerName
 * @param {string[]} ids
 * @returns {Promise<object[]>}
 */
export async function batchRead(containerName, ids) {
  const results = await Promise.all(
    ids.map((id) => readDoc(containerName, id))
  );
  return results.filter(Boolean);
}

/**
 * Use the change feed to listen for new/updated documents.
 * This is the Cosmos DB equivalent of Firestore onSnapshot.
 * Intended for the VPS agent's job queue polling.
 *
 * @param {string} containerName
 * @param {function} handler - called with each changed document
 * @param {object} [options]
 * @param {string} [options.startFromBeginning] - start from the beginning of the change feed
 * @returns {Promise<object>} Change feed iterator (call .close() to stop)
 */
export async function watchChangeFeed(containerName, handler, options = {}) {
  const container = getContainer(containerName);
  const changeFeedIterator = container.items.changeFeed(
    undefined, // partition key (undefined = all partitions)
    {
      startFromBeginning: options.startFromBeginning || false,
    }
  );

  // Poll loop — the caller should run this in a setInterval or similar
  const poll = async () => {
    try {
      const response = await changeFeedIterator.fetchNext();
      if (response.resources && response.resources.length > 0) {
        for (const doc of response.resources) {
          await handler(doc);
        }
      }
    } catch (err) {
      if (err.code !== 304) {
        // 304 = no new changes, expected
        console.error(`[changeFeed] Error polling ${containerName}:`, err.message);
      }
    }
  };

  return { poll, iterator: changeFeedIterator };
}
