/**
 * The `cp_sortDate` computed property, defined once (#816).
 *
 * The published date lives under five aliases, so a plain ORDER BY silently
 * drops any document missing the chosen field (public-reads.js rule 2). The
 * fix is a Cosmos computed property: evaluated server-side on every document,
 * defined on every document (it falls back to '' when no alias is present),
 * and indexable, so `ORDER BY c.cp_sortDate DESC` returns the newest N
 * documents rather than an arbitrary N.
 *
 * `generate-cosmos-container-spec.mjs` writes this definition into
 * `infra/cosmos-containers.json`, and Terraform applies it from there in the
 * same apply that manages the container (`azapi_update_resource.cosmos_computed_properties`
 * in infra/cosmos.tf). Cosmos stores the query as written, so a healthy
 * container matches it exactly and the update plans nothing. The six-hourly
 * healer that compared against the same string was deleted in #816.
 */

/** The containers the public list orders by `cp_sortDate`. */
export const SORT_DATE_CONTAINERS = Object.freeze(['content', 'blogs']);

/**
 * First defined of the five aliases, else '' so the property exists on every
 * document — presence is what makes ORDER BY total. Ternary chain because
 * Cosmos SQL has no COALESCE.
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
