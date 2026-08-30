/**
 * The published corpus, projected to the fields the pre-render manifest keeps.
 *
 * ## Why this route exists (T-718)
 *
 * `scripts/build-content-manifest.mjs` used to query Cosmos directly from a
 * GitHub-hosted runner. That single workload is what held the `0.0.0.0`
 * sentinel open on the Cosmos firewall — the documented "accept connections
 * from within Azure datacenters" switch, which admits any workload in any Azure
 * tenant at the network layer.
 *
 * Every way of closing that while keeping the query in CI was worse than the
 * finding: the firewall has no narrower control-plane action than
 * `Microsoft.DocumentDb/databaseAccounts/*​/write`, which also sets
 * `disableLocalAuth`, and a per-run window cannot be isolated from the read
 * because separate jobs get separate runner IPs. See
 * `wiki/0025-cosmos-firewall-datacenter-sentinel.md`.
 *
 * So the query moves in here, where it runs from the integration subnet the
 * Cosmos firewall already admits, and the runner fetches the result over HTTP
 * instead. CI stops needing Cosmos data-plane access at all.
 *
 * ## Why it is safe to serve anonymously
 *
 * It returns published documents only — asserted in the query rather than
 * filtered afterwards — projected to `ARTICLE_FIELDS`, an explicit allowlist.
 * Every one of those fields is already served by `public/content` and rendered
 * on the public article page. There is no field here the site does not already
 * publish, and no unpublished document can reach it.
 *
 * What it *is* is a bulk endpoint: one request instead of ~120. That is a
 * convenience difference rather than a confidentiality one, and it is the
 * reason the workflow reaches it through a per-run origin window rather than
 * over the public Cloudflare hostname.
 *
 * ## Why it does not rate-limit
 *
 * Deliberate, and it is what makes the origin window work. `anonymousKey()`
 * throws in production when a request did not arrive through Cloudflare — that
 * is the origin lock — so any route that rate-limits anonymously is
 * unreachable from a runner hitting the origin directly. `/api/health` is
 * reachable through `deploy-functions.yml`'s existing window for exactly this
 * reason. This route follows it.
 */

/**
 * The fields the manifest keeps, and therefore the only fields this returns.
 *
 * DUPLICATED from `scripts/build-content-manifest.mjs`, deliberately, and
 * `public-content-manifest.test.js` fails if the two drift. `functions/` and
 * `scripts/` are independent npm packages with no workspace between them, and
 * this repository already carries that trade for `terraform-source` — one copy
 * each side, a guard that reads the other, and a note saying change both.
 *
 * The consequence of drift is specific rather than cosmetic: a field added
 * there but not here is silently absent from every pre-rendered article, which
 * presents as a rendering bug in the static HTML and nowhere else.
 */
export const ARTICLE_FIELDS = Object.freeze([
  // identity and routing
  'id',
  'slug',
  'Slug',
  'cloudProvider',
  'Cloud Provider',
  // the body, in the shapes the template looks for
  'Content',
  'content',
  'blogDraft',
  'code',
  'codeLanguage',
  'codeSnippet',
  'terraformCode',
  // headings and summary
  'Title',
  'title',
  'Summary',
  'summary',
  'description',
  'excerpt',
  'keyTopics',
  // taxonomy
  'Category',
  'category',
  'Tags',
  'tags',
  'language',
  // attribution and dates
  'Author',
  'siteAuthor',
  'editorAuthor',
  'createdByName',
  'publishedByName',
  'Published At',
  'publishedAt',
  'publishedDate',
  'datePublished',
  'blogPublishedAt',
  'ReadTime',
  'readTime',
  // media
  'imageUrl',
  'heroImageUrl',
  'contentImageUrl',
  'altCoverImage',
  'altCoverImageVariants',
  'aiImageUrls',
  'aiImageVariants',
  // outbound links
  'url',
  'sourceUrl',
  'Source URL',
  'repoUrl',
  'CD Url',
]);

/**
 * Keep only the allowlisted fields, and only when present.
 *
 * Named rather than spread: a spread would carry every field the document
 * happens to hold, which is the whole thing this route must not do.
 */
export function projectArticle(item) {
  const out = {};
  for (const field of ARTICLE_FIELDS) {
    if (item?.[field] !== undefined) out[field] = item[field];
  }
  return out;
}

/**
 * The published-only predicate. Three spellings because the corpus carries all
 * three — the Firestore-era `Status`, the current `contentStatus`, and a
 * lowercase variant. Asserted in the QUERY rather than filtered after, so an
 * unpublished article cannot reach a public URL through an oversight here.
 */
export const PUBLISHED_PREDICATE =
  "c.contentStatus = 'published' OR c.Status = 'Published' OR c.status = 'published'";

/**
 * PROJECTED IN SQL, not just in JavaScript.
 *
 * The first version selected `*` and relied on `projectArticle` to drop the
 * rest. That was correct and wasteful: Cosmos returned whole documents —
 * article bodies and every internal field — across the wire for a daily bulk
 * read, and the allowlist was enforced only after they had already arrived in
 * the app's memory. Projecting here means the fields never leave the database.
 *
 * `c["Published At"]`-style bracket quoting is what handles the spaced and
 * cased names in the list (`Published At`, `Cloud Provider`, `Source URL`,
 * `CD Url`); `public-reads.js` builds LIST_PROJECTION the same way, which is
 * the proven form in this repository rather than one invented here.
 *
 * Built FROM `ARTICLE_FIELDS` rather than written out, so the projection and
 * the allowlist cannot disagree — a field added to one is in the other by
 * construction.
 *
 * `projectArticle` still runs on the result and is not redundant: it is what
 * holds if this query is ever edited back to `*`, and it costs one pass over
 * an object whose keys are already correct.
 */
const ARTICLE_PROJECTION = ARTICLE_FIELDS.map((field) => `c["${field}"]`).join(', ');

export const PUBLISHED_QUERY = `SELECT ${ARTICLE_PROJECTION} FROM c WHERE ${PUBLISHED_PREDICATE}`;

export function createPublicContentManifestHandlers({ store }) {
  return {
    /** GET /api/public/content-manifest */
    async getManifest(_request, context) {
      try {
        const rows = await store.queryDocs('content', PUBLISHED_QUERY, []);
        const items = (Array.isArray(rows) ? rows : []).map(projectArticle);
        return {
          status: 200,
          jsonBody: { success: true, items, count: items.length },
          // The build reads this once a day and commits the result; a cached
          // copy would silently pre-render yesterday's corpus.
          headers: { 'Cache-Control': 'no-store' },
        };
      } catch (error) {
        context?.error?.('public content manifest failed', error);
        return { status: 500, jsonBody: { success: false, error: 'manifest_unavailable' } };
      }
    },
  };
}
