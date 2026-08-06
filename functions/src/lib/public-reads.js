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
 *   1. PUBLIC FILTER SERVER-SIDE. The browser used to apply isPublicDocument
 *      after Firestore rules; here the rules are gone, so the filter is the
 *      only thing keeping drafts and soft-deleted docs out of anonymous
 *      responses. A non-public document 404s identically to a missing one.
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
  if (doc.softDeletedAt || doc.softDeleteExpiresAt) return false;
  return (
    doc.Live === true ||
    doc.Status === 'Live' ||
    PUBLIC_STATUSES.has(String(doc.contentStatus || ''))
  );
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
const LIST_MAX_LIMIT = 100;
// The in-memory sort window. Content is ~1k docs total; the published subset
// is well inside this. Bounded so a runaway container can't OOM the handler.
const FETCH_WINDOW = 1000;

/**
 * Fields a public list card renders — the union of what the list consumers
 * (useCoderCornerData normalizeItem, archive/list pages) actually read.
 * Bracket-quoted at query time; detail pages fetch the full document.
 */
const PUBLIC_LIST_FIELDS = [
  'Title', 'title', 'Summary', 'summary', 'explanation', 'description',
  'type', 'contentType', 'publishTarget',
  'Cloud Provider', 'cloudProvider',
  'contentStatus', 'Live', 'Status',
  'softDeletedAt', 'softDeleteExpiresAt',
  'publishedAt', 'Published At', 'publishedDate', 'datePublished', 'blogPublishedAt',
  'slug', 'Slug', 'category', 'Category', 'complexity', 'Complexity',
  'tags', 'Tags', 'keyTopics',
  'language', 'stack', 'repoUrl', 'sourceUrl', 'url',
  'heroImageUrl', 'altCoverImage', 'coverImage', 'Cover Image', 'contentImageUrl',
  'readTime', 'wordCount', 'createdByName',
];

const LIST_PROJECTION = ['c.id', ...PUBLIC_LIST_FIELDS.map((f) => `c["${f}"]`)].join(', ');

/**
 * @param {object} deps
 * @param {{ queryDocs: Function, readDoc: Function }} deps.store
 */
export function createPublicReadHandlers({ store }) {
  return {
    /** GET /api/public/content?type=&provider=&limit=&offset= */
    async listContent(request, context) {
      try {
        const type = String(request.query.get('type') || '').trim().toLowerCase();
        const provider = String(request.query.get('provider') || '').trim().toLowerCase();
        const limit = Math.min(
          Math.max(Number(request.query.get('limit')) || LIST_DEFAULT_LIMIT, 1),
          LIST_MAX_LIMIT
        );
        const offset = Math.max(Number(request.query.get('offset')) || 0, 0);

        let query = `SELECT TOP ${FETCH_WINDOW} ${LIST_PROJECTION} FROM c`;
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

        const rows = await store.queryDocs('content', query, parameters);
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
        return json(200, { success: true, snapshot: stripInternalFields(doc) }, 600);
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
        const items = rows
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

        const [rssCache, insights] = await Promise.all([
          store.queryDocs('rss_cache', 'SELECT * FROM c WHERE c.provider = @provider', [
            { name: '@provider', value: provider },
          ]),
          store.queryDocs('ai_insights', 'SELECT * FROM c WHERE c.provider = @provider', [
            { name: '@provider', value: provider },
          ]),
        ]);

        return json(
          200,
          {
            success: true,
            rssCache: rssCache.map(stripInternalFields),
            insights: insights.filter((i) => i.active !== false).map(stripInternalFields),
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
