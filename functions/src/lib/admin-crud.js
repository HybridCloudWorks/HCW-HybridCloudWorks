/**
 * Admin CRUD — certifications and social posts (api-surface adminWrites,
 * first two slices in the contract's page-usage order).
 *
 * Like the public reads, there is no backend source to port: the admin pages
 * called Firestore directly (CertificationsPage.jsx addDoc/updateDoc/
 * deleteDoc, SocialHubPage.jsx addDoc/deleteDoc + status-filtered list).
 * Semantics mirror those call sites so the pages can swap fetch targets
 * without behavior change:
 *
 *   - certifications: list ALL docs (the page filters/sorts client-side on
 *     display_order), create stamps _createdAt/_updatedAt, edits are PARTIAL
 *     patches stamping _updatedAt — the page's patchCert() sends single-field
 *     toggles, so a whole-doc replace would drop everything else.
 *   - social_posts: list filtered to status IN (scheduled, published) newest
 *     first (createdAt is sorted in memory — Cosmos ORDER BY drops docs
 *     missing the property, same trap as public-reads), create stamps
 *     createdAt, delete by id.
 *
 * Every route sits behind the editor role guard; these were previously
 * "protected" only by Firestore rules that trusted the admin custom claim.
 */
import { randomUUID } from 'node:crypto';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const MAX_DOC_JSON = 120_000;

function validBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (JSON.stringify(body).length > MAX_DOC_JSON) return null;
  return body;
}

const createdAtValue = (doc) => {
  const v = doc.createdAt || doc._createdAt || null;
  if (!v) return 0;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const SOCIAL_DEFAULT_STATUSES = ['scheduled', 'published'];
const LIST_WINDOW = 1000;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function, deleteDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createAdminCrudHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = randomUUID,
  unpublishSocialPost = null,
}) {
  return {
    // ── blogs ──────────────────────────────────────────────────────────────

    /**
     * DELETE /api/cms/blogs/{id} — publisher. Site-Main's createSlugPageOnTrigger
     * wrote the curated slug-page fields ONTO the blog document, so removing
     * the slug page is removing the document (T-324, the first of the three
     * deletes the change feed cannot see). Audited.
     */
    async deleteBlog(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const existing = await store.readDoc('blogs', id, id);
        if (!existing) return json(404, { error: `Blog ${id} not found` });
        await store.deleteDoc('blogs', id, id);
        const { user } = auth;
        await store.upsertDoc('admin_audit_logs', {
          id: uuid(),
          action: 'blog_deleted',
          userId: user?.oid || user?.sub || null,
          userEmail: user?.email || null,
          timestamp: now().toISOString(),
          details: {
            blogId: id,
            slug: existing.slug || existing.Slug || null,
            curatedSubpagePath: existing.curatedSubpagePath || null,
          },
          userAgent: request.headers?.get?.('user-agent') || null,
          contentId: existing.sourceContentId || null,
          contentTitle: existing.Title || existing.title || '',
          compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
        });
        return json(200, { success: true, blogId: id });
      } catch (error) {
        context.error('deleteBlog failed:', error);
        return json(500, { error: 'Failed to delete blog' });
      }
    },

    // ── certifications ─────────────────────────────────────────────────────

    /** GET /api/cms/certifications — all docs; the page sorts client-side. */
    async listCertifications(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const items = await store.queryDocs(
          'certifications',
          `SELECT TOP ${LIST_WINDOW} * FROM c`,
          []
        );
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listCertifications failed:', error);
        return json(500, { error: 'Failed to list certifications' });
      }
    },

    /** POST /api/cms/certifications — create; name is the page's one required field. */
    async createCertification(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        if (!body) return json(400, { error: 'Body must be a JSON object' });
        if (!String(body.name || '').trim()) return json(400, { error: 'name is required' });

        const nowIso = now().toISOString();
        const doc = {
          ...body,
          id: uuid(), // never client-chosen — matches addDoc semantics
          _createdAt: nowIso,
          _updatedAt: nowIso,
        };
        await store.upsertDoc('certifications', doc);
        return json(200, { success: true, id: doc.id, item: doc });
      } catch (error) {
        context.error('createCertification failed:', error);
        return json(500, { error: 'Failed to create certification' });
      }
    },

    /** PATCH /api/cms/certifications/{id} — partial update, stamps _updatedAt. */
    async patchCertification(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const body = validBody(await request.json().catch(() => null));
        if (!body || Object.keys(body).length === 0) {
          return json(400, { error: 'Body must be a non-empty JSON object' });
        }
        const existing = await store.readDoc('certifications', id, id);
        if (!existing) return json(404, { error: `certification ${id} not found` });

        const { id: _ignored, ...updates } = body;
        const updated = await store.patchDoc('certifications', id, {
          ...updates,
          _updatedAt: now().toISOString(),
        });
        return json(200, { success: true, item: updated });
      } catch (error) {
        context.error('patchCertification failed:', error);
        return json(500, { error: 'Failed to update certification' });
      }
    },

    /** DELETE /api/cms/certifications/{id} */
    async deleteCertification(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        await store.deleteDoc('certifications', id);
        return json(200, { success: true });
      } catch (error) {
        context.error('deleteCertification failed:', error);
        return json(500, { error: 'Failed to delete certification' });
      }
    },

    // ── social posts ───────────────────────────────────────────────────────

    /**
     * GET /api/cms/social-posts?status=a,b&limit= — SocialHubPage list.
     * status=all lists every post regardless of status (CalendarPage reads
     * the unfiltered collection).
     */
    async listSocialPosts(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const statusParam = String(request.query.get('status') || '').trim();
        const statuses = statusParam
          ? statusParam
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : SOCIAL_DEFAULT_STATUSES;
        const limit = Math.min(Math.max(Number(request.query.get('limit')) || 50, 1), 100);

        const unfiltered = statuses.includes('all');
        const items = await store.queryDocs(
          'social_posts',
          unfiltered
            ? `SELECT TOP ${LIST_WINDOW} * FROM c`
            : `SELECT TOP ${LIST_WINDOW} * FROM c WHERE ARRAY_CONTAINS(@statuses, c.status)`,
          unfiltered ? [] : [{ name: '@statuses', value: statuses }]
        );
        const sorted = items.sort((a, b) => createdAtValue(b) - createdAtValue(a)).slice(0, limit);
        return json(200, { success: true, items: sorted, total: sorted.length });
      } catch (error) {
        context.error('listSocialPosts failed:', error);
        return json(500, { error: 'Failed to list social posts' });
      }
    },

    /** POST /api/cms/social-posts — create, stamps createdAt (source :273). */
    async createSocialPost(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        if (!body) return json(400, { error: 'Body must be a JSON object' });

        const doc = {
          ...body,
          id: uuid(),
          createdAt: now().toISOString(),
        };
        await store.upsertDoc('social_posts', doc);
        return json(200, { success: true, id: doc.id, item: doc });
      } catch (error) {
        context.error('createSocialPost failed:', error);
        return json(500, { error: 'Failed to create social post' });
      }
    },

    /** DELETE /api/cms/social-posts/{id} */
    async deleteSocialPost(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        // The `!after` branch of Site-Main's syncSocialPostToPubler: the change
        // feed never delivers a delete, so the Publer un-publish happens here
        // (T-324). Best-effort, before the document goes.
        let publer = { attempted: 0, removed: 0 };
        if (unpublishSocialPost) {
          const existing = await store.readDoc('social_posts', id, id);
          if (existing) publer = await unpublishSocialPost(existing);
        }
        await store.deleteDoc('social_posts', id);
        return json(200, { success: true, publer });
      } catch (error) {
        context.error('deleteSocialPost failed:', error);
        return json(500, { error: 'Failed to delete social post' });
      }
    },
  };
}
