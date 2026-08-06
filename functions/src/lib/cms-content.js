/**
 * Content CRUD handler logic, ported from Site-Main cms-functions.js.
 *
 * Source semantics preserved (listContentItems :6622, getContentItem :3278):
 *   - list: optional contentStatus filter, limit clamped to 100 (default 25),
 *     NO ordering — the source query has no orderBy, and adding one here would
 *     change which items appear under the limit.
 *   - list returns the admin snapshot PROJECTION, not whole documents. Content
 *     bodies (postContent etc.) are large; the queue UI reads only these
 *     fields. Firestore `.select(...)` becomes a Cosmos SELECT projection.
 *   - get: accepts contentId via GET query or POST body, exactly as the
 *     source does; 400 without it, 404 when absent.
 *
 * Auth is the two-gate role guard (lib/auth/require-role.js), replacing the
 * stub-era requireAdminClaims middleware whose audience config (ENTRA_CLIENT_ID)
 * no longer exists in the infrastructure.
 */

/**
 * Ported verbatim from Site-Main cms-functions.js:2211
 * (ADMIN_CONTENT_SNAPSHOT_FIELDS). The duplicate casings and spaced names
 * ('CD Url', 'Created At', 'Published At', 'Cover Image') are real field names
 * written by different ingestion paths — project all of them or the queue UI
 * shows "Not provided" for data that exists.
 */
export const ADMIN_CONTENT_SNAPSHOT_FIELDS = [
  'Title', 'title', 'Summary', 'summary',
  'sourceUrl', 'sourceUrls', 'sourceFeed', 'CD Url',
  'type', 'contentType', 'publishTarget', 'targetLandingZone',
  'Cloud Provider', 'cloudProvider',
  'contentStatus', 'Live',
  'fetchedAt', 'createdAt', 'Created At', 'updatedAt', 'reviewedAt',
  'publishedAt', 'Published At', 'publishedDate', 'datePublished', 'pubDate',
  'keyTopics', 'Tags', 'aiTags',
  'forgeGrade', 'forgeMeta',
  'slug', 'Slug', 'category', 'wordCount', 'readTime', 'source',
  'altCoverImage', 'coverImage', 'Cover Image', 'heroImageUrl',
  'contentImageUrl', 'secondaryImageUrls', 'aiImageUrls',
  'slugPageUrl', 'publishedUrl', 'publicUrl', 'curatedSubpagePath',
  'format',
  'critiqueVerdict', 'critiqueGenericityScore', 'critiqueSpecificityScore',
  'critiqueIssues', 'draftRevised',
];

export const LIST_DEFAULT_LIMIT = 25;
export const LIST_MAX_LIMIT = 100;

/** `c["Cover Image"]` quoting handles the spaced/cased field names. */
const PROJECTION = ['c.id', ...ADMIN_CONTENT_SNAPSHOT_FIELDS.map((f) => `c["${f}"]`)].join(', ');

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard role guard (default-guard.js in prod)
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, deleteDoc: Function }} deps.store
 */
export function createCmsContentHandlers({ guard, store }) {
  return {
    /** GET /api/cms/content — source: listContentItems */
    async list(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const status = request.query.get('status') || '';
        const max = Math.min(Number(request.query.get('limit') || LIST_DEFAULT_LIMIT), LIST_MAX_LIMIT);

        let query = `SELECT TOP @limit ${PROJECTION} FROM c`;
        const parameters = [{ name: '@limit', value: max }];
        if (status) {
          query += ' WHERE c.contentStatus = @status';
          parameters.push({ name: '@status', value: status });
        }

        const items = await store.queryDocs('content', query, parameters);
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listContentItems failed:', error);
        return json(500, { error: 'Failed to list content items', message: error?.message || 'Unknown error' });
      }
    },

    /** GET|POST /api/cms/content/item — source: getContentItem */
    async get(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      let contentId;
      if (String(request.method).toUpperCase() === 'GET') {
        contentId = request.query.get('contentId');
      } else {
        const body = await request.json().catch(() => null);
        contentId = body?.contentId;
      }
      if (!contentId) return json(400, { error: 'contentId required' });

      try {
        const item = await store.readDoc('content', contentId, contentId);
        if (!item) return json(404, { error: `content ${contentId} not found` });
        return json(200, { success: true, item });
      } catch (error) {
        context.error('getContentItem failed:', error);
        return json(500, { error: 'Failed to get content item', message: error?.message || 'Unknown error' });
      }
    },

    /**
     * POST /api/cms/content — placeholder pending the createContentItem /
     * updateContentItem port (validation, dedup fields, AI hooks — see the
     * contract). Auth-hardened now so the route never ships behind the dead
     * middleware.
     */
    async save(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') return json(400, { error: 'Body must be a JSON object' });
        const saved = await store.upsertDoc('content', body);
        return json(200, { success: true, id: saved.id, doc: saved });
      } catch (error) {
        context.error('cmsSaveContent failed:', error);
        return json(500, { error: 'Failed to save content', message: error?.message || 'Unknown error' });
      }
    },

    /** DELETE /api/cms/content/{id} — blob cleanup still pending, as before. */
    async remove(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const id = request.params.id;
        if (!id) return json(400, { error: 'id required' });
        await store.deleteDoc('content', id);
        return json(200, { success: true });
      } catch (error) {
        context.error('cmsDeleteContent failed:', error);
        return json(500, { error: 'Failed to delete content', message: error?.message || 'Unknown error' });
      }
    },
  };
}
