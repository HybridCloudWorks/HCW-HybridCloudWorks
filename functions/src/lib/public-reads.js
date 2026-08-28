/**
 * Public read endpoints — anonymous, cache-friendly replacements for the
 * browser's direct Firestore reads (api-surface.json rest.publicReads).
 *
 * These endpoints have no Site-Main backend source to port: the frontend read
 * Firestore directly and relied on security rules to scope what was visible.
 * The semantics here are derived from the consumers they replace —
 * useCoderCornerData.js (public filter, provider aliases), the detail
 * templates (content-then-legacy-blogs fallback, slug/Slug/id resolution),
 * usePodcastData.js, useNewsData.js, AboutPage/CustomSessionizeWidget
 * (_snapshots) — so the browser can swap fetch targets without behavior
 * change.
 *
 * Two rules every handler obeys:
 *   1. VISIBILITY FILTERED SERVER-SIDE. The browser used to apply
 *      isPublicDocument after Firestore rules; here the rules are gone, so the
 *      server is the only thing keeping drafts and soft-deleted docs out of
 *      anonymous responses. A non-public document 404s identically to a
 *      missing one.
 *
 *      Which filter depends on the collection, and this used to say
 *      "isPublicDocument" flatly, which was wrong in a way that mattered:
 *      `content` and `blogs` have an editorial workflow and use
 *      isPublicDocument; `podcasts`, `rss_cache` and `ai_insights` have none
 *      and use isSoftDeleted (plus `active` for insights). Applying
 *      isPublicDocument to the latter three rejects every document — see the
 *      note on isSoftDeleted. The invariant is that a handler filters, not
 *      that every handler filters identically.
 *   2. NO ORDER BY ON published-date fields in Cosmos SQL. The published
 *      date lives under five aliases and ORDER BY silently drops documents
 *      missing the property — a legacy doc with only 'Published At' would
 *      vanish. Handlers fetch a bounded window and sort in memory on the
 *      resolved date, exactly as the frontend does today.
 *
 * Detail reads strip a denylist of internal review/audit fields. The old
 * rules exposed whole documents, but no public template reads these fields
 * (verified against components/templates), so this is a strict hardening.
 */

const json = (status, body, cacheSeconds = 0) => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...(cacheSeconds > 0 ? { 'Cache-Control': `public, max-age=${cacheSeconds}` } : {}),
  },
  body: JSON.stringify(body),
});

/** Mirrors PROVIDER_ALIASES in useCoderCornerData.js. */
export const PROVIDER_ALIASES = {
  aws: ['AWS', 'Aws', 'aws'],
  azure: ['Azure', 'azure'],
  gcp: ['GCP', 'Gcp', 'gcp', 'Google Cloud'],
  finops: ['FinOps', 'Finops', 'finops'],
  github: ['Github', 'GitHub', 'github'],
  terraform: ['Terraform', 'terraform'],
  vmware: ['VMware', 'Vmware', 'vmware'],
  ansible: ['Ansible', 'ansible'],
};

/**
 * Mirrors isPublicDocument in useCoderCornerData.js, plus the normalized
 * 'published' status the new state machine writes (the frontend's
 * 'published_blog' set predates it — both must pass or freshly published
 * documents disappear from public pages).
 */
const PUBLIC_STATUSES = new Set([
  'published',
  'published_blog',
  'published_news',
  'published_both',
]);

export function isPublicDocument(doc = {}) {
  if (!doc) return false;
  if (isSoftDeleted(doc)) return false;
  return (
    doc.Live === true ||
    doc.Status === 'Live' ||
    PUBLIC_STATUSES.has(String(doc.contentStatus || ''))
  );
}

/**
 * The half of `isPublicDocument` that applies to every collection.
 *
 * `isPublicDocument` combines two independent questions: has this document been
 * deleted, and has it been published. Only the first is universal. Publication
 * status is the *editorial content* model — `Live`, `Status`, `contentStatus` —
 * and three of the collections served anonymously have no editorial workflow at
 * all:
 *
 *   - `rss_cache` is a fetch cache, refilled by a scheduled job with a 7-day
 *     TTL (`infra/cosmos-containers.json`). Its documents are `{provider,
 *     feedName, items[]}`.
 *   - `ai_insights` is generated, and carries its own visibility flag,
 *     `active` — which is in its composite index precisely because that is how
 *     the collection expresses hidden.
 *   - `podcasts` is indexed on `provider + publishedAt`, with no status field.
 *
 * TODO.md T-202 prescribed `.filter(isPublicDocument)` on the podcasts and feed
 * handlers. Applied literally it would have returned `false` for **every**
 * document in all three, silently emptying the podcasts page, the news feed and
 * the insights panel — the same shape of failure as T-101, arrived at through a
 * security fix. The contract the module header states ("the server must
 * filter") is honoured by applying the part that is actually meaningful.
 *
 * If a publication workflow is ever added to one of these collections, the
 * corresponding handler should move to `isPublicDocument`.
 */
export function isSoftDeleted(doc = {}) {
  return Boolean(doc?.softDeletedAt || doc?.softDeleteExpiresAt);
}

/** Published-date resolution across the five aliases (useCoderCornerData). */
export function resolvePublishedDateValue(doc = {}) {
  const candidate =
    doc.publishedDate ||
    doc.datePublished ||
    doc['Published At'] ||
    doc.blogPublishedAt ||
    doc.publishedAt ||
    null;
  if (!candidate) return 0;
  const parsed = candidate?.toDate ? candidate.toDate() : new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

/** Internal fields stripped from public detail responses — see header. */
const INTERNAL_FIELDS = [
  'reviewNotes',
  'reviewedBy',
  'createdBy',
  'updatedBy',
  'contentQuality',
  'imageQuality',
  'imageReadiness',
  'imageLineage',
  'forgeMeta',
  'critiqueVerdict',
  'critiqueGenericityScore',
  'critiqueSpecificityScore',
  'critiqueIssues',
];

export function stripInternalFields(doc) {
  const out = { ...doc };
  for (const field of INTERNAL_FIELDS) delete out[field];
  // Cosmos system properties are meaningless to the browser.
  for (const key of Object.keys(out)) {
    if (key.startsWith('_')) delete out[key];
  }
  return out;
}

const LIST_DEFAULT_LIMIT = 60;
// Ceiling matches the widest client fetch window (useFrameworkData and
// useProviderLandingContent ask for 250 and filter by provider client-side —
// a smaller cap would silently hide older provider-specific documents).
const LIST_MAX_LIMIT = 250;
// The in-memory sort window. Bounded so a runaway container can't OOM the
// handler. This used to be the failure threshold too: with no WHERE clause the
// window applied to ALL documents, and the file's own comment noted content is
// ~1k docs total — the bound and the count were the same number, past which
// published articles vanish arbitrarily. The public filter now runs in SQL
// (see listContent), so the window applies to the PUBLISHED subset of the
// requested type/provider, which moves the threshold far from the data
// (TODO.md T-206).
const FETCH_WINDOW = 1000;

/**
 * The SQL half of the public filter (TODO.md T-206), mirroring
 * `isPublicDocument` — which STILL runs on every row afterwards. Two layers on
 * purpose, with an asymmetry that matters:
 *
 *  - The SQL layer exists so `TOP ${FETCH_WINDOW}` counts published documents,
 *    not all documents. It is deliberately written WIDE: where JS truthiness
 *    and SQL comparison could disagree (a soft-delete marker holding '', 0 or
 *    false is NOT deleted to `isSoftDeleted`), the SQL admits the row and lets
 *    the JS filter decide. Erring wide costs a few rows of window; erring
 *    narrow silently drops a published article, which is this finding's
 *    defect reintroduced through its own fix.
 *  - The JS layer stays the authority. If the two ever disagree, the response
 *    is what `isPublicDocument` says, and the SQL only affects which rows made
 *    the window.
 *
 * PUBLIC_STATUSES is inlined as literals rather than parameterized because the
 * values are this module's own constants, not caller input.
 */
const SQL_PUBLIC_CLAUSE =
  '(c.Live = true OR c.Status = "Live" OR c.contentStatus IN ' +
  `(${[...PUBLIC_STATUSES].map((s) => `"${s}"`).join(', ')}))`;

/** A marker counts as set only when it holds a JS-truthy value — see above. */
const sqlNotTruthy = (field) =>
  `(NOT IS_DEFINED(c.${field}) OR IS_NULL(c.${field}) OR c.${field} = "" OR c.${field} = false OR c.${field} = 0)`;

const SQL_NOT_SOFT_DELETED = `${sqlNotTruthy('softDeletedAt')} AND ${sqlNotTruthy('softDeleteExpiresAt')}`;

/**
 * What the public LIST endpoint returns per document (TODO.md T-206).
 *
 * This replaces `SELECT *`, which transferred whole documents — body fields
 * included — at ~20 KB average, making one anonymous list request the dominant
 * RU line (~12–24k RU against a 5,000 RU/s serverless budget: two concurrent
 * page loads were enough for 429s).
 *
 * The list is NOT guessed and NOT copied from the admin projection
 * (cms-content.js ADMIN_CONTENT_SNAPSHOT_FIELDS): it is the union of every
 * field the public list consumers actually read, from a file-by-file audit of
 * useCoderCornerData / useBlogData / useFrameworkData /
 * useProviderLandingContent, the five provider ArchitecturePages, SocialHubPage
 * and LivePagesPage, following items through every spread and normalizer.
 * A missing field here silently renders blank on a public page, so
 * public-reads.test.js pins the audited requirements against this list —
 * removing an entry fails a test naming the consumer that needs it.
 *
 * Of the nine heavy body fields, exactly ONE is read by a list consumer:
 * `explanation`, a third-priority excerpt fallback in useCoderCornerData
 * (:41, :53). `content`/`Content`/`postContent`/`blogDraft`/`overviewHtml`/
 * `codeSnippet`/`commandExample`/`sidebarContent` are read only by DETAIL
 * consumers (blogUtils normalizeContentFields), so this projection must stay
 * scoped to listContent — getContent keeps returning whole documents.
 */
export const PUBLIC_CONTENT_LIST_FIELDS = [
  // identity / typing
  'id',
  'type',
  'contentType',
  'publishTarget',
  'targetLandingZone',
  // titles and copy (excerpt fallbacks included — see header for explanation)
  'Title',
  'title',
  'name',
  'Summary',
  'summary',
  'description',
  'excerpt',
  'explanation',
  // slugs, categorisation, tags
  'slug',
  'Slug',
  'category',
  'Category',
  'primaryCategory',
  'complexity',
  'Complexity',
  'technicalLevel',
  'TechnicalLevel',
  'level',
  'tags',
  'Tags',
  'keyTopics',
  'featured',
  'Featured',
  // visibility — what isPublicDocument and the workflow badges read
  'Live',
  'Status',
  'contentStatus',
  'softDeletedAt',
  'softDeleteExpiresAt',
  // provider spellings
  'Cloud Provider',
  'cloudProvider',
  'provider',
  'Provider',
  'primaryProvider',
  // the five published-date aliases plus recency fields
  'publishedDate',
  'datePublished',
  'Published At',
  'blogPublishedAt',
  'publishedAt',
  'updatedAt',
  'createdAt',
  // links
  'slugPageUrl',
  'expectedPublicUrl',
  'publishedUrl',
  'publicUrl',
  'blogUrl',
  'curatedSubpagePath',
  'sourceUrl',
  'url',
  'CD Url',
  'Source URL',
  'link',
  'docLink',
  // reading stats and attribution
  'readTime',
  'ReadTime',
  'wordCount',
  'WordCount',
  'words',
  'editorAuthor',
  'siteAuthor',
  'publishedByName',
  'createdByName',
  // imagery
  'contentImageUrl',
  'altCoverImage',
  'altCoverImageVariants',
  'imageUrl',
  'ImageUrl',
  'coverImage',
  'thumbnail',
  // coder corner cards
  'language',
  'stack',
  'repoUrl',
  'icon',
  'categoryColor',
  // architecture cards
  'costColor',
  'cost',
  'costAnalysis',
  'rpo',
  'RPO',
  'rto',
  'RTO',
  'waf',
  'wellArchitectedScore',
  // framework pages (arrays project whole; element fields ride along)
  'frameworkConcepts',
  'frameworkNodes',
  'frameworkPillars',
  'keyPillars',
  'pillars',
  'officialSources',
  'frameworkSourceUrls',
  'sourceUrls',
  'architectureRecommendation',
  'recommendation',
  'summaryRecommendation',
  'frameworkKnowledgePrompt',
  'frameworkImagePrompt',
  'frameworkDiagramPrompt',
  // cross-document identity (LivePages delete path, SocialHub dedup)
  'sourceContentId',
  'publishedContentId',
  'publishedBlogId',
  'blogId',
];

/** `c["Cover Image"]`-style quoting handles spaced and cased names. */
const LIST_PROJECTION = PUBLIC_CONTENT_LIST_FIELDS.map((f) => `c["${f}"]`).join(', ');

/**
 * Document ceilings for the feed endpoint (TODO.md T-203).
 *
 * These are runaway guards, NOT page sizes, and the distinction is the whole
 * of why they are not smaller. T-203 suggested sizing them to "what
 * useNewsData.js renders", which is 30 — but 30 is the count of *items* the
 * client keeps after flattening every `cache.items[]` array together and
 * sorting by `pubDate`. One `rss_cache` document is one FEED, holding many
 * items. `TOP 30` would therefore bound feeds, not articles, and a provider
 * with more feeds than the ceiling would lose whole feeds' worth of recent
 * news.
 *
 * Worse, it would lose an *arbitrary* set of them: there is no ORDER BY here,
 * and there deliberately is not. Rule 2 in the module header forbids ordering
 * on a field that may be absent, because Cosmos drops documents missing the
 * sort key — and `lastFetched` / `generatedAt` are only in the containers'
 * composite indexes, which does not guarantee presence. So `TOP N` returns an
 * arbitrary N, which is acceptable precisely because N is set above the
 * realistic document count: the arbitrary case only arises once a container
 * has already run away, which is the case being defended against.
 *
 * Do not tighten these to a render count.
 */
const FEED_CACHE_MAX_DOCS = 200;
const FEED_INSIGHTS_MAX_DOCS = 200;

/**
 * Items served per `rss_cache` document (TODO.md T-319).
 *
 * FEED_CACHE_MAX_DOCS bounds the number of feeds; this bounds the number of
 * articles inside each one, which is the other half of the same runaway. One
 * document holds a whole feed, so a hundred bounded documents can still be an
 * unbounded anonymous response — and `items[]` is the part of the document
 * that grows with the world rather than with the site.
 *
 * The value equals the ingest writer's own cap (MAX_CACHE_ITEMS_PER_FEED in
 * rss/feeds.js), so a document written by the current writer is served whole
 * and this trim only engages on one that is not: a document written before
 * that cap existed, or one an unusually large feed produced. The two constants
 * are deliberately not shared by import — this module has no imports so the
 * anonymous read path cannot be broken by an ingest-side change — and
 * public-reads.test.js asserts they agree so the pair cannot silently drift.
 */
const FEED_CACHE_MAX_ITEMS_PER_DOC = 20;

/**
 * Listen & Learn containers and the per-set episode ceiling.
 *
 * Named here rather than imported from listen-and-learn/publish.js because
 * this module deliberately has no imports (see the getFeed ceiling note): the
 * anonymous read path must not be breakable by a change on the generation
 * side. public-reads.test.js asserts the names agree.
 *
 * Eight areas is the largest real study guide, so fifty is a runaway guard
 * rather than a page size.
 */
const LISTEN_AND_LEARN_SET_CONTAINER = 'listen_and_learn';
const LISTEN_AND_LEARN_EPISODE_CONTAINER = 'listen_and_learn_episodes';
const LISTEN_AND_LEARN_MAX_EPISODES = 50;

/**
 * Newest-first by `pubDate`, with undated items last in their stored order.
 *
 * Undated items sort to the tail rather than to "now": an item with no date is
 * the one we know least about, and treating a missing date as current would
 * let a malformed feed evict every dated article. Comparing for equality
 * before subtracting keeps two undated items at 0 rather than at `-Infinity -
 * -Infinity`, which is NaN — the sort is stable, so 0 preserves feed order.
 */
function feedItemTime(item) {
  const parsed = Date.parse(item?.pubDate ?? '');
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Bound one `rss_cache` document's `items[]`, keeping the newest.
 *
 * Documents whose `items` is absent or not an array are returned untouched:
 * there is no array to bound, and inventing an empty one would turn a
 * malformed document into a plausible-looking empty feed.
 *
 * `itemCount` is rewritten alongside a trim because the writer's invariant is
 * `itemCount === items.length`; leaving the stored count would tell a client
 * there are items in the response that are not.
 */
function boundFeedItems(doc) {
  const items = doc?.items;
  if (!Array.isArray(items) || items.length <= FEED_CACHE_MAX_ITEMS_PER_DOC) return doc;

  const newest = [...items]
    .sort((a, b) => {
      const at = feedItemTime(a);
      const bt = feedItemTime(b);
      return at === bt ? 0 : bt - at;
    })
    .slice(0, FEED_CACHE_MAX_ITEMS_PER_DOC);

  return { ...doc, items: newest, itemCount: newest.length };
}

/**
 * A curated article's image changes only when someone regenerates it, so a HIT
 * is cached hard — and this is the endpoint a news page hits up to twelve times
 * per load, which is the other reason.
 *
 * A MISS is not, and the asymmetry is the point. Caching "there is no image"
 * for an hour means that after an admin generates one, visitors and any CDN in
 * front of them keep being told there is none until the hour is out — turning
 * "no image yet" into "no image for an hour", which is a slower version of the
 * bug this endpoint exists to fix. A minute still absorbs reloads without
 * making a freshly generated image wait.
 */
const CURATED_IMAGE_HIT_CACHE_SECONDS = 3600;
const CURATED_IMAGE_MISS_CACHE_SECONDS = 60;

/**
 * Ids the batched curated-image read will answer for in one request (T-739).
 *
 * The news grid asks for twelve. 50 leaves room for a longer grid without
 * making this an amplifier: an unbounded `ids` list on an anonymous endpoint
 * means one request can cost as many reads as the caller names, which is the
 * shape of the fan-out T-711 removed from the ops-health probe.
 */
export const CURATED_IMAGE_BATCH_MAX = 50;

/**
 * How many same-slug documents the detail lookup considers.
 *
 * Slugs are meant to be unique, so this is normally 1 row. It is >1 because
 * they are not *enforced* unique, and the previous `SELECT TOP 1` with no
 * `ORDER BY` picked arbitrarily among duplicates and only then asked whether
 * the winner was public — so a published article could 404 forever because an
 * unpublished draft shared its slug (TODO.md T-305).
 *
 * `ORDER BY c._ts DESC` is safe here for a reason that does not generalize:
 * `_ts` is a system property Cosmos writes on every document, so the
 * "never ORDER BY on a possibly-missing field" rule — which silently drops
 * documents lacking the sort key — does not apply. No composite index is
 * needed; a filter plus a single-property ORDER BY runs on the range index
 * that `/*` already provides, at a slightly higher RU cost that a
 * near-unique predicate makes irrelevant.
 */
const SLUG_CANDIDATES = 10;

// Containers the list endpoint may serve. 'blogs' is the legacy fallback the
// list hooks query when 'content' comes back empty — the browser read it
// directly under the old Firestore rules, so exposing it (public-filtered,
// internal fields stripped) grants nothing new.
const LIST_SOURCES = new Set(['content', 'blogs']);

/**
 * @param {object} deps
 * @param {{ queryDocs: Function, readDoc: Function }} deps.store
 */
export function createPublicReadHandlers({ store }) {
  return {
    /**
     * GET /api/public/content?type=&provider=&limit=&offset=&source=
     * Returns full documents (internal fields stripped) — the list consumers
     * read far more than card fields (frameworkConcepts, featured,
     * altCoverImageVariants, curatedSubpagePath, costAnalysis, …), exactly as
     * they did when Firestore handed them whole documents.
     */
    async listContent(request, context) {
      try {
        const type = String(request.query.get('type') || '')
          .trim()
          .toLowerCase();
        const provider = String(request.query.get('provider') || '')
          .trim()
          .toLowerCase();
        const requestedSource = String(request.query.get('source') || 'content').trim();
        if (!LIST_SOURCES.has(requestedSource)) {
          return json(400, { error: 'Invalid source' });
        }
        const limit = Math.min(
          Math.max(Number(request.query.get('limit')) || LIST_DEFAULT_LIMIT, 1),
          LIST_MAX_LIMIT
        );
        const offset = Math.max(Number(request.query.get('offset')) || 0, 0);

        // The public filter runs in SQL so the TOP window counts published
        // documents rather than all documents, and the projection replaces
        // `SELECT *` so a list request stops transferring article bodies —
        // both halves of TODO.md T-206. `isPublicDocument` still re-filters
        // every row below; see SQL_PUBLIC_CLAUSE for why both layers exist.
        const clauses = [SQL_PUBLIC_CLAUSE, SQL_NOT_SOFT_DELETED];
        const parameters = [];
        if (type) {
          clauses.push('LOWER(c.type) = @type');
          parameters.push({ name: '@type', value: type });
        }
        if (provider) {
          const labels = PROVIDER_ALIASES[provider] || [provider, provider.toUpperCase()];
          clauses.push(
            '(ARRAY_CONTAINS(@providers, c["Cloud Provider"]) OR ARRAY_CONTAINS(@providers, c["cloudProvider"]))'
          );
          parameters.push({ name: '@providers', value: labels });
        }
        // T-206 step 3, behind a flag so deploy order is safe in either
        // direction. With PUBLIC_LIST_SQL_ORDER=1 the window becomes the
        // NEWEST N documents instead of an arbitrary N — the last part of the
        // finding. `cp_sortDate` is a COMPUTED property (defined on every
        // document, '' when no date alias is present), which is what makes
        // this exempt from rule 2's "never ORDER BY a possibly-missing field":
        // it cannot be missing.
        //
        // Three preconditions, all three required, learned the hard way on
        // 2026-08-21 when the flag went live and every list call failed with
        // "The index path corresponding to the specified order-by item is
        // excluded": (1) apply-computed-sortdate.mjs --inspect clean;
        // (2) --apply has run, so the property exists; (3) `/cp_sortDate/?` is
        // an INCLUDED PATH in the container's indexing policy — computed
        // properties are not covered by the `/*` wildcard (Cosmos docs), and an
        // ORDER BY on an unindexed property is an error, not a slow query.
        // infra/cosmos-containers.json carries the path for content and blogs.
        // The in-memory sort below stays either way — it is the authority on
        // order exactly as isPublicDocument is on visibility.
        const orderBy =
          process.env.PUBLIC_LIST_SQL_ORDER === '1' ? ' ORDER BY c.cp_sortDate DESC' : '';
        const query = `SELECT TOP ${FETCH_WINDOW} ${LIST_PROJECTION} FROM c WHERE ${clauses.join(' AND ')}${orderBy}`;

        const rows = await store.queryDocs(requestedSource, query, parameters);
        const matching = rows
          .filter(isPublicDocument)
          .sort((a, b) => resolvePublishedDateValue(b) - resolvePublishedDateValue(a));
        const items = matching.slice(offset, offset + limit).map(stripInternalFields);

        // `total` is the number of matching documents, not the size of this
        // page — it was measured after the slice, so it always equalled
        // `items.length` and any paginating consumer would have concluded there
        // was exactly one page (TODO.md T-407).
        //
        // It is still bounded by FETCH_WINDOW, so on a collection larger than
        // that it under-reports. That is a smaller lie than the page size and
        // it is the honest one available without a second COUNT query; a
        // consumer that needs an exact total needs the cursor API tracked in
        // T-206.
        return json(200, { success: true, items, total: matching.length }, 300);
      } catch (error) {
        context.error('publicListContent failed:', error);
        return json(500, { error: 'Failed to list content' });
      }
    },

    /**
     * GET /api/public/content/{slugOrId} — id, then slug/Slug in content,
     * then the same three lookups in legacy blogs: the fallback chain the
     * detail templates run client-side today, folded server-side.
     */
    async getContent(request, context) {
      try {
        const slugOrId = String(request.params.slugOrId || '').trim();
        if (!slugOrId) return json(400, { error: 'slugOrId required' });

        for (const container of ['content', 'blogs']) {
          const byId = await store.readDoc(container, slugOrId, slugOrId);
          if (byId && isPublicDocument(byId)) {
            return json(
              200,
              { success: true, item: stripInternalFields(byId), source: container },
              300
            );
          }
          for (const field of ['slug', 'Slug']) {
            const rows = await store.queryDocs(
              container,
              `SELECT TOP ${SLUG_CANDIDATES} * FROM c WHERE c["${field}"] = @slug ORDER BY c._ts DESC`,
              [{ name: '@slug', value: slugOrId }]
            );
            // `find`, not `rows[0] && isPublicDocument(...)`. Filtering after
            // taking one row meant a published article 404'd whenever an
            // unpublished document happened to share its slug and win the
            // arbitrary pick (TODO.md T-305).
            const match = rows.find(isPublicDocument);
            if (match) {
              return json(
                200,
                { success: true, item: stripInternalFields(match), source: container },
                300
              );
            }
          }
        }
        // Non-public and missing answer identically — see header rule 1.
        return json(404, { error: 'Content not found' });
      } catch (error) {
        context.error('publicGetContent failed:', error);
        return json(500, { error: 'Failed to get content' });
      }
    },

    /**
     * GET /api/public/curated-image/{articleId} — the cached hero image for a
     * curated news article.
     *
     * This exists because the public news pages were calling an EDITOR-gated
     * endpoint. #63 moved the cache lookup off an anonymous Firestore read onto
     * `getJSON('cms/images/curated/...')`, which runs through `acquireApiToken`
     * and throws without an MSAL account — so on `/{provider}/news`, an
     * anonymous visitor's lookups all failed and no curated imagery rendered
     * where cached images used to (TODO.md T-210).
     *
     * **Only `imageUrl` is returned, never the document.** The admin endpoint
     * answers with the whole thing, and the whole thing is not public: a
     * `curated_article_images` document also carries `storagePath` (an internal
     * blob path) and the prompt metadata the gallery writes — `promptSet`,
     * `promptName`, `promptTemplateVersion`, `theme`, `style`. That is
     * editorial IP and internal layout, and none of it is needed to render an
     * `<img>`.
     *
     * Archived images are withheld, which the finding did not ask for. It is a
     * deliberate hardening in the same direction as the module's other filters:
     * `archived` is set by an admin explicitly retiring an image, and the only
     * thing this can do is stop a retired image appearing on a public page.
     *
     * Absence answers 200 with `imageUrl: null`, not 404. The caller's question
     * is "is there a cached image?", and "no" is a successful answer to it —
     * matching the admin endpoint, whose `item: null` the hook already treats
     * as "not cached" rather than as an error.
     */
    async getCuratedImage(request, context) {
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'articleId required' });

        const doc = await store.readDoc('curated_article_images', id, id);
        // Trimmed, so a whitespace-only value is uncached rather than being
        // handed to the browser as an `<img src>` that resolves to the page
        // itself.
        const stored = typeof doc?.imageUrl === 'string' ? doc.imageUrl.trim() : '';
        const imageUrl = doc && doc.archived !== true && stored ? stored : null;

        return json(
          200,
          { success: true, imageUrl },
          imageUrl ? CURATED_IMAGE_HIT_CACHE_SECONDS : CURATED_IMAGE_MISS_CACHE_SECONDS
        );
      } catch (error) {
        context.error('publicGetCuratedImage failed:', error);
        return json(500, { error: 'Failed to get curated image' });
      }
    },

    /**
     * GET /api/public/curated-images?ids=a,b,c — the same lookup as
     * `getCuratedImage`, for a whole grid in one round trip (T-739).
     *
     * The news grid rendered twelve cards and issued twelve
     * `public/curated-image/{id}` requests, on a route that had already
     * fetched the feed. Twelve round trips before any cover appeared.
     *
     * **Every disclosure rule of the single-id route applies here unchanged**,
     * and that is the property to protect if this is ever edited: only
     * `imageUrl` is returned, never the document — a `curated_article_images`
     * row also carries `storagePath` and the gallery's prompt metadata
     * (`promptSet`, `promptName`, `promptTemplateVersion`, `theme`, `style`),
     * which is editorial IP and internal layout. Archived images are withheld,
     * and a whitespace-only value is treated as uncached rather than handed to
     * a browser as an `<img src>` that resolves to the page itself.
     * `public-reads.curated-images.test.js` asserts the two routes agree, so a
     * change to one that is not made to the other fails.
     *
     * Absence is a null entry, not an omission and not a 404: the caller's
     * question is "which of these have covers?", and "this one does not" is a
     * successful answer that the client needs in order to stop asking.
     *
     * Bounded at `CURATED_IMAGE_BATCH_MAX`. An unbounded `ids` list on an
     * anonymous endpoint is a point-read amplifier — one request costing as
     * many reads as the caller cares to name — which is the shape of the
     * fan-out T-711 removed from the ops-health probe.
     */
    async getCuratedImages(request, context) {
      try {
        const raw = String(request.query?.get?.('ids') ?? '').trim();
        if (!raw) return json(400, { error: 'ids required' });

        const ids = [
          ...new Set(
            raw
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          ),
        ];
        if (ids.length === 0) return json(400, { error: 'ids required' });
        if (ids.length > CURATED_IMAGE_BATCH_MAX) {
          return json(400, { error: `At most ${CURATED_IMAGE_BATCH_MAX} ids per request` });
        }

        // One query rather than N point reads — the same shape T-711 applied
        // to the orphan probe. `images` is keyed by id so a caller can tell
        // "no cover" from "not asked about".
        const rows = await store.queryDocs(
          'curated_article_images',
          'SELECT c.id, c.imageUrl, c.archived FROM c WHERE ARRAY_CONTAINS(@ids, c.id)',
          [{ name: '@ids', value: ids }]
        );

        const byId = new Map((rows || []).map((row) => [row.id, row]));
        const images = {};
        let anyHit = false;
        for (const id of ids) {
          const doc = byId.get(id);
          const stored = typeof doc?.imageUrl === 'string' ? doc.imageUrl.trim() : '';
          const imageUrl = doc && doc.archived !== true && stored ? stored : null;
          images[id] = imageUrl;
          if (imageUrl) anyHit = true;
        }

        // The shorter miss TTL when nothing was found, so a grid whose covers
        // are still generating is not pinned to the long hit TTL.
        return json(
          200,
          { success: true, images },
          anyHit ? CURATED_IMAGE_HIT_CACHE_SECONDS : CURATED_IMAGE_MISS_CACHE_SECONDS
        );
      } catch (error) {
        context.error('publicGetCuratedImages failed:', error);
        return json(500, { error: 'Failed to get curated images' });
      }
    },

    /**
     * GET /api/public/snapshots/{id} — the build-time projections that
     * PublishSnapshotButton writes. Allowlisted to the two snapshots public
     * pages consume; this endpoint must not become a generic container read.
     */
    async getSnapshot(request, context) {
      const PUBLIC_SNAPSHOTS = new Set(['certifications', 'speakerevents']);
      try {
        const id = String(request.params.id || '').trim();
        if (!PUBLIC_SNAPSHOTS.has(id)) return json(404, { error: 'Snapshot not found' });
        const doc = await store.readDoc('_snapshots', id, id);
        if (!doc) return json(404, { error: 'Snapshot not found' });

        // Defence in depth. The publish-side sanitizers
        // (lib/snapshots-publish.js) are the real boundary — they decide which
        // fields exist in the stored snapshot at all. But stripInternalFields
        // used to be applied to the wrapper only, so `createdBy` and
        // `updatedBy` inside items[] were never reached, and a collection with
        // no sanitizer leaked wholesale (TODO.md T-201).
        //
        // Descending here means a future snapshot collection added without a
        // sanitizer still cannot publish admin emails. It is not a substitute
        // for the sanitizer: a missing one still leaks every non-internal
        // field, and display:false rows.
        const snapshot = stripInternalFields(doc);
        if (Array.isArray(snapshot.items)) {
          snapshot.items = snapshot.items.map((item) =>
            item && typeof item === 'object' && !Array.isArray(item)
              ? stripInternalFields(item)
              : item
          );
        }
        return json(200, { success: true, snapshot }, 600);
      } catch (error) {
        context.error('publicGetSnapshot failed:', error);
        return json(500, { error: 'Failed to get snapshot' });
      }
    },

    /** GET /api/public/podcasts?provider=&limit= (usePodcastData.js) */
    async listPodcasts(request, context) {
      try {
        const provider = String(request.query.get('provider') || '').trim();
        const limit = Math.min(
          Math.max(Number(request.query.get('limit')) || LIST_DEFAULT_LIMIT, 1),
          LIST_MAX_LIMIT
        );

        let query = `SELECT TOP ${FETCH_WINDOW} * FROM c`;
        const parameters = [];
        if (provider) {
          query += ' WHERE c.provider = @provider';
          parameters.push({ name: '@provider', value: provider });
        }
        const rows = await store.queryDocs('podcasts', query, parameters);
        // Soft-delete only: podcasts have no publication workflow, so
        // isPublicDocument would reject every row. See isSoftDeleted.
        const matching = rows
          .filter((doc) => !isSoftDeleted(doc))
          .sort((a, b) => resolvePublishedDateValue(b) - resolvePublishedDateValue(a));
        const items = matching.slice(0, limit).map(stripInternalFields);
        // Counted before the slice — see listContent above (TODO.md T-407).
        return json(200, { success: true, items, total: matching.length }, 300);
      } catch (error) {
        context.error('publicListPodcasts failed:', error);
        return json(500, { error: 'Failed to list podcasts' });
      }
    },

    /**
     * GET /api/public/feed?provider= — rss_cache docs plus active ai_insights
     * for one provider (useNewsData.js). Cache documents are trimmed to their
     * newest items (T-319) and otherwise returned as stored; the flatten/sort
     * across feeds stays client-side where it lives today.
     */
    async getFeed(request, context) {
      try {
        const provider = String(request.query.get('provider') || '').trim();
        if (!provider) return json(400, { error: 'provider required' });

        // Both queries were unbounded on an anonymous endpoint, and queryDocs
        // calls .fetchAll() (TODO.md T-203). rss_cache is TTL-bounded at seven
        // days and syncRssFeeds now enforces that bound, but a document count
        // is not an item count and the timer only rewrites feeds it still
        // fetches — a retired feed's document keeps whatever it last held. The
        // ceilings stay, and boundFeedItems below bounds the rest.
        const [rssCache, insights] = await Promise.all([
          store.queryDocs(
            'rss_cache',
            `SELECT TOP ${FEED_CACHE_MAX_DOCS} * FROM c WHERE c.provider = @provider`,
            [{ name: '@provider', value: provider }]
          ),
          store.queryDocs(
            'ai_insights',
            `SELECT TOP ${FEED_INSIGHTS_MAX_DOCS} * FROM c WHERE c.provider = @provider`,
            [{ name: '@provider', value: provider }]
          ),
        ]);

        return json(
          200,
          {
            success: true,
            // Soft-delete applies to both; publication status applies to
            // neither (see isSoftDeleted). `active !== false` is the
            // ai_insights visibility model — it is in the container's composite
            // index for exactly that reason — and a soft-deleted insight passed
            // it, which is the half of T-202 that was a real leak.
            // T-319: each surviving document is trimmed to its newest items so
            // the response is bounded in articles, not just in feeds.
            rssCache: rssCache
              .filter((doc) => !isSoftDeleted(doc))
              .map((doc) => boundFeedItems(stripInternalFields(doc))),
            insights: insights
              .filter((doc) => doc.active !== false && !isSoftDeleted(doc))
              .map(stripInternalFields),
          },
          120
        );
      } catch (error) {
        context.error('publicGetFeed failed:', error);
        return json(500, { error: 'Failed to get feed' });
      }
    },

    /**
     * GET /api/public/listen-and-learn?platform=&examCode= — the approved
     * episodes for one certification (components/education/ListenAndLearn.jsx).
     *
     * `status === 'published'` is the ONLY thing standing between a draft and a
     * visitor. These are AI-written summaries of a paid exam's objectives,
     * generated as drafts and approved one at a time in the admin portal, so
     * this filter is the whole review gate rather than a display preference —
     * which is why it is an equality test on an explicit value and not a
     * `!== 'draft'`. An episode whose status a future writer misspells stays
     * hidden, which is the safe direction.
     *
     * A set with no approved episodes returns `episodes: []` and a 200 rather
     * than a 404: the certification exists and the page renders its own
     * "nothing published yet" state, which is a different thing from a
     * certification that has never been generated.
     */
    async getListenAndLearn(request, context) {
      try {
        const platform = String(request.query.get('platform') || '')
          .trim()
          .toLowerCase();
        const examCode = String(request.query.get('examCode') || '').trim();
        if (!platform || !examCode) {
          return json(400, { error: 'platform and examCode are required' });
        }

        const id = `${platform}_${examCode.toLowerCase()}`;
        const [set, episodes] = await Promise.all([
          store.readDoc(LISTEN_AND_LEARN_SET_CONTAINER, id, id),
          store.queryDocs(
            LISTEN_AND_LEARN_EPISODE_CONTAINER,
            `SELECT TOP ${LISTEN_AND_LEARN_MAX_EPISODES} * FROM c WHERE c.setId = @setId AND c.status = @status`,
            [
              { name: '@setId', value: id },
              { name: '@status', value: 'published' },
            ]
          ),
        ]);

        if (!set) return json(404, { error: 'Not found' });

        return json(
          200,
          {
            success: true,
            set: stripInternalFields(set),
            // Study-guide order. Episodes are meant to be heard in the order
            // the exam presents the areas, which is neither the order a query
            // returns nor the order exam weighting would give.
            episodes: episodes
              .filter((doc) => !isSoftDeleted(doc))
              .map(stripInternalFields)
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
          },
          300
        );
      } catch (error) {
        context.error('publicGetListenAndLearn failed:', error);
        return json(500, { error: 'Failed to get Listen & Learn episodes' });
      }
    },
  };
}
