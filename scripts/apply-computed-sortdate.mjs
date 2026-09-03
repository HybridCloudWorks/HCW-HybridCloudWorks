#!/usr/bin/env node
/**
 * T-206 step 3 — make ORDER BY safe on the public content list.
 *
 * The published date lives under five aliases, so a plain ORDER BY silently
 * drops any document missing the chosen field (public-reads.js rule 2). The
 * fix is a Cosmos COMPUTED PROPERTY, `cp_sortDate`: evaluated server-side on
 * every document, defined on every document (it falls back to '' when no alias
 * is present), and indexable — so `ORDER BY c.cp_sortDate DESC` makes the
 * TOP window return the NEWEST N documents instead of an arbitrary N, with no
 * backfill and no write-site maintenance.
 *
 * Why a script and not Terraform: the ARM container resource supports
 * `computedProperties`, but the `azurerm_cosmosdb_sql_container` resource the
 * repo provisions with does not model them. **Drift hazard, read this:** a
 * later `terraform apply` that updates a container PUTs azurerm's view of it,
 * which does not include computed properties — silently wiping them. Re-run
 * `--apply` after any Terraform change that touches `content` or `blogs`.
 * `infra/cosmos-containers.json` records the property as documentation.
 *
 * Order of operations (each step gates the next):
 *
 *   1. `--inspect`  Sample every date alias in `content` and `blogs` and
 *                   report non-ISO values. cp_sortDate sorts ISO-8601 strings
 *                   lexicographically = chronologically; a container holding
 *                   non-ISO date strings would mis-sort, and only the live
 *                   data can say whether any exist (TODO.md).
 *   2. `--apply`    Add cp_sortDate to both containers (idempotent).
 *   3. Flip `PUBLIC_LIST_SQL_ORDER=1` on the Function App. listContent then
 *      adds ORDER BY cp_sortDate DESC; without the flag nothing changes, so
 *      deploy order is safe in both directions.
 *
 * Needs COSMOS_ENDPOINT (+ optional COSMOS_DATABASE) and data-plane RBAC
 * (az login locally).
 */

import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CONTAINERS = ['content', 'blogs'];

/**
 * First defined of the five aliases, else '' so the property exists on every
 * document — presence is what makes ORDER BY total. Ternary chain because
 * Cosmos SQL has no COALESCE. Exported for the unit test.
 */
export function sortDateQuery() {
  const aliases = [
    'c.publishedDate',
    'c.datePublished',
    'c["Published At"]',
    'c.blogPublishedAt',
    'c.publishedAt',
  ];
  let expr = '""';
  for (const alias of [...aliases].reverse()) {
    expr = `(IS_STRING(${alias}) ? ${alias} : ${expr})`;
  }
  return `SELECT VALUE ${expr} FROM c`;
}

export const COMPUTED_PROPERTY = Object.freeze({
  name: 'cp_sortDate',
  query: sortDateQuery(),
});

/** ISO-8601-enough for lexicographic order: YYYY-MM-DD prefix. */
export const isSortableIso = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);

async function getClient() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (!endpoint) throw new Error('COSMOS_ENDPOINT is not set');
  const { CosmosClient } = await import('@azure/cosmos');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  return client.database(process.env.COSMOS_DATABASE || 'hcw');
}

async function inspect() {
  const db = await getClient();
  let dirty = 0;
  for (const name of CONTAINERS) {
    console.log(`\n== ${name}`);
    const container = db.container(name);
    // One pass, projecting only the aliases: cheap even on serverless.
    const { resources } = await container.items
      .query(
        'SELECT c.id, c.publishedDate, c.datePublished, c["Published At"] AS publishedAtSpaced, c.blogPublishedAt, c.publishedAt FROM c'
      )
      .fetchAll();
    console.log(`  ${resources.length} documents`);
    const bad = [];
    for (const doc of resources) {
      for (const [field, value] of Object.entries(doc)) {
        if (field === 'id' || value === undefined || value === null) continue;
        if (!isSortableIso(value)) bad.push({ id: doc.id, field, value });
      }
    }
    if (bad.length === 0) {
      console.log('  every present date alias is ISO-sortable — safe to --apply');
    } else {
      dirty += bad.length;
      console.log(`  ${bad.length} NON-ISO date values — fix these before --apply:`);
      for (const entry of bad.slice(0, 20)) {
        console.log(`    ${entry.id} ${entry.field} = ${JSON.stringify(entry.value)}`);
      }
      if (bad.length > 20) console.log(`    ... and ${bad.length - 20} more`);
    }
  }
  process.exit(dirty ? 1 : 0);
}

// ---------------------------------------------------------------------------
// --apply goes through ARM, not the data plane.
//
// `container.replace()` on the SDK sends the new container definition to the
// data-plane endpoint, and Cosmos refuses that with an AAD token regardless of
// which roles the identity holds: "cannot be authorized by AAD token in data
// plane" (run 32420399977, 2026-08-20). computedProperties is a control-plane
// attribute. The write is therefore a PUT on the ARM resource
// Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers, authorized
// by the narrow custom role infra/oidc.tf defines for exactly this (containers
// read + write at the account, nothing else).
//
// Needs, besides COSMOS_ENDPOINT: SUBSCRIPTION_ID and COSMOS_RESOURCE_GROUP.
// The account name is the first label of the endpoint host.
// ---------------------------------------------------------------------------
const ARM_API = '2024-11-15';
const ARM_READ_ONLY = new Set([
  '_rid', '_ts', '_self', '_etag', '_docs', '_sprocs', '_triggers', '_udfs', '_conflicts', 'statistics',
]);

/** The PUT body ARM accepts: the GET's `properties.resource` minus read-only keys, with our property merged in. */
export function buildArmBody(armResource, property = COMPUTED_PROPERTY) {
  const resource = {};
  for (const [k, v] of Object.entries(armResource)) if (!ARM_READ_ONLY.has(k)) resource[k] = v;
  const existing = Array.isArray(resource.computedProperties) ? resource.computedProperties : [];
  resource.computedProperties = [...existing.filter((p) => p.name !== property.name), property];
  return { properties: { resource, options: {} } };
}

/** True when the container already carries exactly this property. */
export function hasProperty(armResource, property = COMPUTED_PROPERTY) {
  return (armResource.computedProperties || []).some((p) => p.name === property.name && p.query === property.query);
}

function armContainerUrl(name) {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const sub = process.env.SUBSCRIPTION_ID;
  const rg = process.env.COSMOS_RESOURCE_GROUP;
  if (!endpoint) throw new Error('COSMOS_ENDPOINT is not set');
  if (!sub || !rg) throw new Error('SUBSCRIPTION_ID and COSMOS_RESOURCE_GROUP are required for --apply (ARM write)');
  const account = new URL(endpoint).hostname.split('.')[0];
  const db = process.env.COSMOS_DATABASE || 'hcw';
  return (
    `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}` +
    `/providers/Microsoft.DocumentDB/databaseAccounts/${account}/sqlDatabases/${db}/containers/${name}` +
    `?api-version=${ARM_API}`
  );
}

async function armFetch(url, init = {}, token) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  return res;
}

async function apply() {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const { token } = await new DefaultAzureCredential().getToken('https://management.azure.com/.default');

  for (const name of CONTAINERS) {
    const url = armContainerUrl(name);
    const got = await armFetch(url, {}, token);
    if (!got.ok) throw new Error(`${name}: ARM GET ${got.status} — ${(await got.text()).slice(0, 300)}`);
    const current = (await got.json()).properties.resource;

    if (hasProperty(current)) {
      console.log(`${name}: cp_sortDate already applied`);
      continue;
    }

    const body = buildArmBody(current);
    const put = await armFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, token);
    if (!put.ok) throw new Error(`${name}: ARM PUT ${put.status} — ${(await put.text()).slice(0, 300)}`);

    // ARM container writes are asynchronous: poll the operation until it settles.
    const poll = put.headers.get('azure-asyncoperation') || put.headers.get('location');
    if (put.status === 202 && poll) {
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await armFetch(poll, {}, token);
        const js = st.ok ? await st.json().catch(() => ({})) : {};
        const state = js.status || js.properties?.provisioningState;
        if (state && /succeeded/i.test(state)) break;
        if (state && /failed|canceled/i.test(state)) throw new Error(`${name}: ARM operation ${state}`);
      }
    }

    const check = await armFetch(url, {}, token);
    const after = (await check.json()).properties.resource;
    if (!hasProperty(after)) throw new Error(`${name}: PUT accepted but cp_sortDate is not on the container afterwards`);
    console.log(`${name}: cp_sortDate ${current.computedProperties?.some((p) => p.name === COMPUTED_PROPERTY.name) ? 'updated' : 'added'}`);
  }
  console.log('\nNow flip PUBLIC_LIST_SQL_ORDER=1 on the Function App and');
  console.log('re-run smoke-deployed.mjs — list order should be newest-first.');
}

const HELP = `Usage: node apply-computed-sortdate.mjs --inspect | --apply

  --inspect   report non-ISO date values in content/blogs (run FIRST;
              exits 1 if any exist — fix them before applying)
  --apply     add the cp_sortDate computed property to both containers

--inspect needs COSMOS_ENDPOINT (+ COSMOS_DATABASE) and data-plane RBAC.
--apply additionally needs SUBSCRIPTION_ID and COSMOS_RESOURCE_GROUP, and
writes through ARM (containers read+write on the account — infra/oidc.tf).
`;

// pathToFileURL, not `file://${argv[1]}`: on Windows argv[1] is `C:\...`, which
// never string-matches import.meta.url, so the script would exit 0 having run
// nothing. Same fix as check-deploy-drift.mjs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  const run = mode === '--inspect' ? inspect : mode === '--apply' ? apply : null;
  if (!run) {
    console.log(HELP);
    process.exit(mode === '--help' || mode === '-h' ? 0 : 2);
  }
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
