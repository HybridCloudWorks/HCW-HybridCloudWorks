/**
 * Cosmos DB data access layer for Azure Functions.
 *
 * Uses DefaultAzureCredential (managed identity in production, az login locally).
 * No static key — COSMOS_KEY must NOT be set. Auth is RBAC via managed identity.
 *
 * Required app settings: COSMOS_ENDPOINT, COSMOS_DATABASE
 * Required RBAC role on the Function App MI: Cosmos DB Built-in Data Contributor
 */

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let client = null;
let database = null;

/**
 * Initialize or return the singleton Cosmos DB client.
 * Uses managed identity (DefaultAzureCredential) — no key required.
 */
export function getCosmosDb() {
  if (database) return database;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseId = process.env.COSMOS_DATABASE || 'hybridcloudworks';

  if (!endpoint) {
    throw new Error('Missing COSMOS_ENDPOINT environment variable');
  }

  client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });
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
 * Write or REPLACE a document.
 *
 * NOT equivalent to `.set(data, { merge: true })` — this comment used to say it
 * was, and that was wrong in the most expensive direction. `items.upsert()`
 * replaces the whole document: every field absent from `document` is deleted.
 *
 * Site-Main has 48 partial-write call sites (31 `.update()`, 17
 * `set(..., { merge: true })`). Porting any of them onto this function the way
 * the old comment invited silently wipes every field the payload omits, with no
 * error and no test failure. Use `patchDoc` for those.
 *
 * Equivalent to: admin.firestore().collection(name).doc(id).set(data)
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
 * Cosmos rejects a patch specification with more than ten operations:
 * "The number of patch operations can't exceed 10."
 * https://learn.microsoft.com/azure/cosmos-db/partial-document-update-faq
 */
export const MAX_PATCH_OPERATIONS = 10;

/** Cosmos refuses to patch these, and Firestore never exposed them. */
const SYSTEM_PROPERTIES = new Set(['id', '_id', '_ts', '_etag', '_rid', '_self', '_attachments']);

/**
 * Convert a Firestore field path to a JSON Pointer.
 *
 * Firestore addresses nested fields with dots — `.update({ 'a.b': 1 })` — while
 * Cosmos wants `/a/b`. Per RFC 6902, `~` and `/` inside a property NAME escape
 * to `~0` and `~1`; the escaping must happen per segment, after the split, or a
 * legitimate dotted path would escape its own separators.
 */
export function toJsonPointer(fieldPath) {
  return `/${String(fieldPath)
    .split('.')
    .map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/')}`;
}

/**
 * Partially update a document, leaving absent fields untouched.
 *
 * Equivalent to: admin.firestore().collection(name).doc(id).update(updates)
 *
 * Two execution paths, because Cosmos's patch API cannot express Firestore's
 * update semantics in every case:
 *
 *  - **Patch** (<= 10 operations, no deletions). One round trip, and
 *    conflict-resolved per PATH across regions rather than per document, so two
 *    writers touching different fields do not clobber each other.
 *  - **Read-modify-write with ETag** otherwise. Used when the update exceeds the
 *    ten-operation ceiling, or deletes a field. Deletion needs this because
 *    Cosmos `remove` FAILS on an absent path ("Node(PATH) to be removed is
 *    absent") while Firestore's `FieldValue.delete()` on a missing field is a
 *    no-op — routing deletions through RMW keeps the Firestore behaviour that 48
 *    call sites already depend on.
 *
 * The RMW path is guarded by `_etag` (`ifMatch`), so a concurrent write loses
 * with a 412 rather than silently overwriting. It retries once, because the
 * common case is two handlers touching the same document in the same second.
 *
 * Chunking a >10-operation update into several patch calls is deliberately NOT
 * done: it would drop atomicity silently, which is the same class of bug as the
 * upsert-as-merge comment above.
 *
 * @param {string} containerName
 * @param {string} id
 * @param {Record<string, any>} updates - field path -> value. `undefined` deletes.
 * @param {object} [options]
 * @param {string} [options.partitionKey] - defaults to id
 * @returns {Promise<object>} the document after the write
 */
export async function patchDoc(containerName, id, updates, options = {}) {
  const plan = planPatch(updates);
  if (plan.strategy === 'noop') {
    return readDoc(containerName, id, options.partitionKey);
  }

  const container = getContainer(containerName);
  const pk = options.partitionKey ?? id;

  if (plan.strategy === 'patch') {
    const { resource } = await container.item(id, pk).patch(plan.operations);
    return resource;
  }

  return readModifyWrite(container, id, pk, plan.entries);
}

/**
 * Decide how a set of updates must be written, and build the operations.
 *
 * Split out from `patchDoc` and exported because it is the part with the rules
 * in it — the ten-operation ceiling, the deletion carve-out, the system-property
 * refusal — and it is pure, so it is testable without a Cosmos account. The
 * house style in this directory is dependency injection over mocking
 * (`createRoleGuard`), and this follows it.
 *
 * @param {Record<string, any>} updates
 * @returns {{strategy: 'noop'} | {strategy: 'patch', operations: object[], entries: [string, any][]} | {strategy: 'rmw', entries: [string, any][], reason: string}}
 */
export function planPatch(updates) {
  const entries = Object.entries(updates ?? {});
  if (entries.length === 0) return { strategy: 'noop' };

  for (const [field] of entries) {
    const root = String(field).split('.')[0];
    if (SYSTEM_PROPERTIES.has(root)) {
      throw new Error(`patchDoc: refusing to modify system property ${JSON.stringify(root)}`);
    }
  }

  const hasDeletion = entries.some(([, value]) => value === undefined);
  if (hasDeletion) {
    return { strategy: 'rmw', entries, reason: 'deletion' };
  }
  if (entries.length > MAX_PATCH_OPERATIONS) {
    return { strategy: 'rmw', entries, reason: 'exceeds-operation-limit' };
  }

  return {
    strategy: 'patch',
    entries,
    operations: entries.map(([field, value]) => ({
      op: 'set',
      path: toJsonPointer(field),
      value,
    })),
  };
}

/**
 * ETag-guarded read-modify-write, applying dotted field paths onto a copy.
 * One retry: a 412 means someone else wrote between our read and our replace,
 * and re-reading resolves it unless the document is genuinely hot.
 */
async function readModifyWrite(container, id, pk, entries, attempt = 0) {
  const { resource: current } = await container.item(id, pk).read();
  if (!current) {
    throw new Error(`patchDoc: document ${id} does not exist`);
  }

  const next = structuredClone(current);
  for (const [field, value] of entries) {
    applyFieldPath(next, String(field).split('.'), value);
  }

  try {
    const { resource } = await container
      .item(id, pk)
      .replace(next, { accessCondition: { type: 'IfMatch', condition: current._etag } });
    return resource;
  } catch (err) {
    if (err.code === 412 && attempt === 0) {
      return readModifyWrite(container, id, pk, entries, attempt + 1);
    }
    throw err;
  }
}

/**
 * Set or delete a dotted path on a plain object, creating intermediates.
 * Exported for tests — it is the half of the read-modify-write path that can be
 * checked without a Cosmos account.
 */
export function applyFieldPath(target, segments, value) {
  const last = segments[segments.length - 1];
  let cursor = target;

  for (const segment of segments.slice(0, -1)) {
    if (cursor[segment] === null || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  if (value === undefined) {
    delete cursor[last];
  } else {
    cursor[last] = value;
  }
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
