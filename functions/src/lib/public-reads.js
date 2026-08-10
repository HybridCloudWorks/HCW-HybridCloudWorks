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
const PUBLIC_STATUSES = new Set(['published', 'published_blog', 'published_news', 'published_both']);

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
// The in-memory sort window. Content is ~1k docs total; the published subset
// is well inside this. Bounded so a runaway container can't OOM the handler.
const FETCH_WINDOW = 1000;

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
        const type = String(request.query.get('type') || '').trim().toLowerCase();
        const provider = String(request.query.get('provider') || '').trim().toLowerCase();
        const requestedSource = String(request.query.get('source') || 'content').trim();
        if (!LIST_SOURCES.has(requestedSource)) {
          return json(400, { error: 'Invalid source' });
        }
        const limit = Math.min(
          Math.max(Number(request.query.get('limit')) || LIST_DEFAULT_LIMIT, 1),
          LIST_MAX_LIMIT
        );
        const offset = Math.max(Number(request.query.get('offset')) || 0, 0);

        let query = `SELECT TOP ${FETCH_WINDOW} * FROM c`;
        const clauses = [];
        const parameters = [];
        if (type) {
          clauses.push('LOWER(c.type) = @type');
          parameters.push({ name: '@type', value: type });
        }
        if (provider) {
          const labels = PROVIDER_ALIASES[provider] || [provider, provider.toUpperCase()];
          clauses.push('(ARRAY_CONTAINS(@providers, c["Cloud Provider"]) OR ARRAY_CONTAINS(@providers, c["cloudProvider"]))');
          parameters.push({ name: '@providers', value: labels });
        }
        if (clauses.length > 0) query += ` WHERE ${clauses.join(' AND ')}`;

        const rows = await store.queryDocs(requestedSource, query, parameters);
        const items = rows
          .filter(isPublicDocument)
          .sort((a, b) => resolvePublishedDateValue(b) - resolvePublishedDateValue(a))
          .slice(offset, offset + limit)
          .map(stripInternalFields);

        return json(200, { success: true, items, total: items.length }, 300);
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
            return json(200, { success: true, item: stripInternalFields(byId), source: container }, 300);
          }
          for (const field of ['slug', 'Slug']) {
            const rows = await store.queryDocs(
              container,
              `SELECT TOP 1 * FROM c WHERE c["${field}"] = @slug`,
              [{ name: '@slug', value: slugOrId }]
            );
            if (rows[0] && isPublicDocument(rows[0])) {
              return json(200, { success: true, item: stripInternalFields(rows[0]), source: container }, 300);
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
        const items = rows
          .filter((doc) => !isSoftDeleted(doc))
          .sort((a, b) => resolvePublishedDateValue(b) - resolvePublishedDateValue(a))
          .slice(0, limit)
          .map(stripInternalFields);
        return json(200, { success: true, items, total: items.length }, 300);
      } catch (error) {
        context.error('publicListPodcasts failed:', error);
        return json(500, { error: 'Failed to list podcasts' });
      }
    },

    /**
     * GET /api/public/feed?provider= — rss_cache docs plus active ai_insights
     * for one provider (useNewsData.js). Docs returned as stored; the
     * flatten/sort of cache items stays client-side where it lives today.
     */
    async getFeed(request, context) {
      try {
        const provider = String(request.query.get('provider') || '').trim();
        if (!provider) return json(400, { error: 'provider required' });

        // Both queries were unbounded on an anonymous endpoint, and queryDocs
        // calls .fetchAll() (TODO.md T-203). rss_cache is TTL-bounded at seven
        // days, but that bound is enforced by syncRssFeeds — a scheduler that
        // is still a stub — so today nothing limits either container.
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
            rssCache: rssCache.filter((doc) => !isSoftDeleted(doc)).map(stripInternalFields),
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
  };
}
