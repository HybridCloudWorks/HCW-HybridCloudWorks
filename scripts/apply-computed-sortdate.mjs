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
 *                   data can say whether any exist (REVIEW.md §0.3).
 *   2. `--apply`    Add cp_sortDate to both containers (idempotent).
 *   3. Flip `PUBLIC_LIST_SQL_ORDER=1` on the Function App. listContent then
 *      adds ORDER BY cp_sortDate DESC; without the flag nothing changes, so
 *      deploy order is safe in both directions.
 *
 * Needs COSMOS_ENDPOINT (+ optional COSMOS_DATABASE) and data-plane RBAC
 * (az login locally).
 */

import process from 'node:process';

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
  return client.database(process.env.COSMOS_DATABASE || 'hybridcloudworks');
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

async function apply() {
  const db = await getClient();
  for (const name of CONTAINERS) {
    const container = db.container(name);
    const { resource: def } = await container.read();
    const existing = def.computedProperties || [];
    const already = existing.find((p) => p.name === COMPUTED_PROPERTY.name);
    if (already && already.query === COMPUTED_PROPERTY.query) {
      console.log(`${name}: cp_sortDate already applied`);
      continue;
    }
    const next = [...existing.filter((p) => p.name !== COMPUTED_PROPERTY.name), COMPUTED_PROPERTY];
    // The default '/*' included path indexes the computed property too, which
    // is all a filter + single-property ORDER BY needs (public-reads.js).
    await container.replace({ ...def, computedProperties: next });
    console.log(`${name}: cp_sortDate ${already ? 'updated' : 'added'}`);
  }
  console.log('\nNow flip PUBLIC_LIST_SQL_ORDER=1 on the Function App and');
  console.log('re-run smoke-deployed.mjs — list order should be newest-first.');
}

const HELP = `Usage: node apply-computed-sortdate.mjs --inspect | --apply

  --inspect   report non-ISO date values in content/blogs (run FIRST;
              exits 1 if any exist — fix them before applying)
  --apply     add the cp_sortDate computed property to both containers

Needs COSMOS_ENDPOINT (+ COSMOS_DATABASE) and data-plane RBAC (az login).
`;

if (import.meta.url === `file://${process.argv[1]}`) {
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
