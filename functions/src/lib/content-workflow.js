/**
 * Content workflow write RPCs — saveEditorDraft, unpublishContentToInspected,
 * deleteContentItem, saveContentSchedule, softDeleteLivePage,
 * requestContentInspection, resetContentReviewState.
 *
 * Ported from Site-Main cms-functions.js (:3340-3564, :4635-4985, :5827-5906)
 * on patchDoc partial writes, with the sequential-writes-content-first
 * ordering established in content-update.js replacing Firestore transactions.
 *
 * Adaptations, each deliberate:
 *   - EDIT CONFLICT detection (saveEditorDraft): the source compared
 *     blogEditedAt via Timestamp .toMillis(). Cosmos stores ISO strings, so
 *     the comparison parses those too — without this, every migrated (or
 *     previously port-saved) document would read as 0 ms and force=false
 *     saves against stale editors would silently succeed instead of 409ing.
 *   - buildContentImageFieldUpdates' FieldValue.delete() becomes patchDoc's
 *     `undefined` deletion for cleared image slots.
 *   - deleteContentItem tolerates deleting a missing doc (Firestore .delete()
 *     is a no-op there; Cosmos 404s).
 *   - softDeleteLivePage keeps the source's resolution order (contentId, then
 *     blogId as a legacy alias for the content id) and its `blogRefs: []` —
 *     the legacy blogs fan-out was already retired upstream.
 */
import { randomUUID } from 'node:crypto';
import { ensureTldrSectionAtEnd } from './cms/content-quality.js';
import {
  assertStringLength,
  assertOptionalDateString,
  normalizeCurrentStatusForBlogOnly,
} from './cms/content-update-validation.js';
import { normalizePublishTarget } from './cms/publish-targets.js';
import { toValidDate } from './cms/content-status.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function assertImageUrlList(urls = []) {
  if (!Array.isArray(urls)) {
    throw new Error('orderedImageUrls must be an array');
  }
  return urls.map((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return normalized;
    if (!/^https?:\/\//i.test(normalized)) {
      throw new Error('orderedImageUrls must contain absolute http(s) URLs');
    }
    if (normalized.length > 2048) {
      throw new Error('orderedImageUrls contains an entry that exceeds 2048 characters');
    }
    return normalized;
  });
}

/** Source :596 — hero/secondary/aiImageUrls slots from the ordered list. */
export function buildContentImageUpdates(urls = [], existing = {}) {
  const normalized = (Array.isArray(urls) ? urls : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  const heroImageUrl = normalized[0] || null;
  const secondaryImageUrls = normalized.slice(1, 4);
  const nextAiImageUrls = {};
  ['hero', 'secondary1', 'secondary2', 'secondary3'].forEach((slot, index) => {
    if (normalized[index]) {
      nextAiImageUrls[slot] = normalized[index];
    }
  });

  if (existing?.aiImageUrls?.content && normalized.includes(existing.aiImageUrls.content)) {
    nextAiImageUrls.content = existing.aiImageUrls.content;
  }

  return {
    heroImageUrl,
    contentImageUrl: heroImageUrl,
    altCoverImage: heroImageUrl,
    secondaryImageUrls,
    aiImageUrls: nextAiImageUrls,
  };
}

/** Source :625 — cleared slots become deletions (undefined = patchDoc delete). */
export function buildContentImageFieldUpdates(imageUpdates = {}) {
  return {
    heroImageUrl: imageUpdates.heroImageUrl || undefined,
    contentImageUrl: imageUpdates.contentImageUrl || undefined,
    altCoverImage: imageUpdates.altCoverImage || undefined,
    secondaryImageUrls:
      Array.isArray(imageUpdates.secondaryImageUrls) && imageUpdates.secondaryImageUrls.length > 0
        ? imageUpdates.secondaryImageUrls
        : undefined,
    aiImageUrls: imageUpdates.aiImageUrls || {},
  };
}

/** Millis from Timestamp-like, Date, or ISO string — see header. */
export function editedAtMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function assertNoEditConflict(currentData, expectedEditedAtMs, force) {
  const currentEditedAtMs = editedAtMillis(currentData.blogEditedAt);
  if (!force && Number(currentEditedAtMs) !== Number(expectedEditedAtMs || 0)) {
    throw new Error('EDIT_CONFLICT');
  }
}

/** Source :3396 — validate/normalize the saveEditorDraft body. */
export function validateSaveEditorDraftBody(body) {
  try {
    const normalizedDraft = ensureTldrSectionAtEnd(
      assertStringLength(body.draft, 'draft', 200000, { allowEmpty: true })
    );
    assertStringLength(body.title, 'title', 250, { allowEmpty: true });
    const resolvedAuthor =
      assertStringLength(body.authorName, 'authorName', 120, { allowEmpty: true }).trim() ||
      'Hybrid Cloud Works';
    assertStringLength(body.summary, 'summary', 5000, { allowEmpty: true });
    assertStringLength(body.sidebarContent, 'sidebarContent', 12000, { allowEmpty: true });
    const validatedImageUrls = assertImageUrlList(body.orderedImageUrls)
      .filter(Boolean)
      .slice(0, 4);
    const nextPublishedDate = assertOptionalDateString(body.publishedDate, 'publishedDate');
    const normalizedTags = String(body.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (normalizedTags.length > 25) {
      throw new Error('tags exceeds 25 entries');
    }
    normalizedTags.forEach((tag) => {
      if (tag.length > 80) {
        throw new Error('tag exceeds 80 characters');
      }
    });
    return {
      ok: true,
      normalizedDraft,
      resolvedAuthor,
      normalizedTags,
      validatedImageUrls,
      nextPublishedDate,
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function, deleteDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createContentWorkflowHandlers({ guard, store, now = () => new Date(), uuid = randomUUID }) {
  const actor = (user) => user.email || user.preferred_username || user.oid || 'admin';

  const auditRow = ({ action, user, request, details, contentId, contentTitle, nowIso }) => ({
    id: uuid(),
    action,
    userId: user.oid ?? user.sub ?? null,
    userEmail: user.email || null,
    timestamp: nowIso,
    details,
    userAgent: request.headers?.get?.('user-agent') || null,
    contentId,
    contentTitle,
    compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
  });

  return {
    /** POST /api/saveEditorDraft — source :3437; 409 on edit conflict. */
    async saveEditorDraft(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const {
          contentId,
          expectedEditedAtMs = 0,
          force = false,
          draft = '',
          title = '',
          authorName = '',
          publishedDate = '',
          summary = '',
          tags = '',
          sidebarContent = '',
          orderedImageUrls = [],
        } = body;

        if (!contentId || typeof contentId !== 'string') {
          return json(400, { error: 'contentId required' });
        }

        const validation = validateSaveEditorDraftBody({
          draft, title, authorName, summary, sidebarContent, orderedImageUrls, publishedDate, tags,
        });
        if (!validation.ok) return json(400, { error: validation.error });
        const { normalizedDraft, resolvedAuthor, normalizedTags, validatedImageUrls, nextPublishedDate } =
          validation;

        const currentData = await store.readDoc('content', contentId, contentId);
        if (!currentData) return json(404, { error: `content ${contentId} not found` });
        const currentTitle = currentData.Title || currentData.title || '';

        try {
          assertNoEditConflict(currentData, expectedEditedAtMs, force);
        } catch {
          return json(409, { error: 'EDIT_CONFLICT' });
        }

        const nowIso = now().toISOString();
        const currentStatus = String(currentData.contentStatus || '');
        const nextStatus = currentStatus.startsWith('published_') ? currentStatus : 'editing';
        const imageUpdates = buildContentImageUpdates(validatedImageUrls, currentData);

        await store.patchDoc('content', contentId, {
          blogDraft: normalizedDraft,
          Title: String(title || ''),
          title: String(title || ''),
          editorAuthor: resolvedAuthor,
          siteAuthor: resolvedAuthor,
          publishedDate: nextPublishedDate,
          Summary: String(summary || ''),
          summary: String(summary || ''),
          sidebarContent: String(sidebarContent || ''),
          Tags: normalizedTags,
          ...buildContentImageFieldUpdates(imageUpdates),
          blogEditedAt: nowIso,
          contentStatus: nextStatus,
          updatedAt: nowIso,
          updatedBy: actor(user),
        });

        await store.upsertDoc('content_versions', {
          id: uuid(),
          contentId,
          title: title || currentTitle || '',
          summary: summary || currentData.Summary || currentData.summary || '',
          draft: normalizedDraft || '',
          authorName: resolvedAuthor || '',
          tags: normalizedTags || [],
          sidebarContent: sidebarContent || '',
          publishedDate: nextPublishedDate || currentData.publishedDate || '',
          orderedImageUrls: validatedImageUrls || [],
          versionCreatedAt: nowIso,
          versionCreatedBy: actor(user),
          versionReason: force ? 'draft_force_saved' : 'draft_saved',
        });

        await store.upsertDoc(
          'admin_audit_logs',
          auditRow({
            action: force ? 'draft_force_saved' : 'draft_saved',
            user,
            request,
            details: {
              contentId,
              force: Boolean(force),
              fieldUpdated: 'blogDraft',
              imageCount: validatedImageUrls.length,
            },
            contentId,
            contentTitle: currentTitle,
            nowIso,
          })
        );

        return json(200, {
          success: true,
          contentId,
          normalizedDraft,
          editorAuthor: resolvedAuthor,
          tagCount: normalizedTags.length,
        });
      } catch (error) {
        context.error('saveEditorDraft failed:', error);
        return json(500, { error: 'Failed to save draft', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/unpublishContentToInspected — source :4635; publisher. */
    async unpublishContentToInspected(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { contentId, reviewNotes = '' } = body;
        if (!contentId || typeof contentId !== 'string') {
          return json(400, { error: 'contentId required' });
        }
        if (String(reviewNotes || '').length > 5000) {
          return json(400, { error: 'reviewNotes exceeds 5000 characters' });
        }

        const currentData = await store.readDoc('content', contentId, contentId);
        if (!currentData) return json(404, { error: `content ${contentId} not found` });

        const previousStatus = normalizeCurrentStatusForBlogOnly(
          currentData.contentStatus || 'ingested'
        );
        const contentTitle = currentData.Title || currentData.title || '';
        const allowedStatuses = ['published', 'approved'];
        if (!allowedStatuses.includes(previousStatus)) {
          return json(400, {
            error: `Cannot unpublish content from status ${previousStatus}`,
            allowedStatuses,
          });
        }

        const nowIso = now().toISOString();
        await store.patchDoc('content', contentId, {
          contentStatus: 'inspected',
          Live: false,
          approvedForNews: false,
          scheduledPublishDate: null,
          reviewNotes: String(reviewNotes || ''),
          reviewedAt: nowIso,
          reviewedBy: actor(user),
          updatedAt: nowIso,
          updatedBy: actor(user),
        });

        await store.upsertDoc(
          'admin_audit_logs',
          auditRow({
            action: 'content_unpublished',
            user,
            request,
            details: {
              contentId,
              fromStatus: previousStatus,
              toStatus: 'inspected',
              reviewNotes: String(reviewNotes || ''),
            },
            contentId,
            contentTitle,
            nowIso,
          })
        );

        return json(200, { success: true, contentId, from: previousStatus, to: 'inspected' });
      } catch (error) {
        context.error('unpublishContentToInspected failed:', error);
        return json(500, { error: 'Failed to unpublish content', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/deleteContentItem — source :4724; publisher; hard delete. */
    async deleteContentItem(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { contentId } = body;
        if (!contentId) return json(400, { error: 'contentId required' });

        try {
          await store.deleteDoc('content', contentId);
        } catch (err) {
          // Firestore .delete() on a missing doc is a no-op; keep that.
          if (err?.code !== 404) throw err;
        }
        return json(200, { success: true, contentId });
      } catch (error) {
        context.error('deleteContentItem failed:', error);
        return json(500, { error: 'Failed to delete content', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/saveContentSchedule — source :4866; publisher. */
    async saveContentSchedule(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const {
          contentId,
          instantPublish = true,
          scheduledPublishDate = null,
          publishTarget = null,
        } = body;

        if (!contentId || typeof contentId !== 'string') {
          return json(400, { error: 'contentId required' });
        }

        const contentData = await store.readDoc('content', contentId, contentId);
        if (!contentData) return json(404, { error: `content ${contentId} not found` });

        const resolvedPublishTarget = normalizePublishTarget(
          publishTarget,
          contentData.publishTarget || contentData.type || contentData.contentType
        );
        const nowIso = now().toISOString();
        const updates = {
          contentStatus: 'approved',
          publishTarget: resolvedPublishTarget,
          Live: false,
          updatedAt: nowIso,
          updatedBy: actor(user),
        };

        let scheduledIso = null;
        if (instantPublish) {
          updates.scheduledPublishDate = null;
        } else {
          const scheduleDate = toValidDate(scheduledPublishDate);
          if (!scheduleDate) {
            return json(400, { error: 'Valid scheduledPublishDate required' });
          }
          if (scheduleDate.getTime() <= now().getTime()) {
            return json(400, { error: 'scheduledPublishDate must be in the future' });
          }
          scheduledIso = scheduleDate.toISOString();
          updates.scheduledPublishDate = scheduledIso;
        }

        await store.patchDoc('content', contentId, updates);

        return json(200, {
          success: true,
          contentId,
          instantPublish: Boolean(instantPublish),
          scheduledPublishDate: scheduledIso,
        });
      } catch (error) {
        context.error('saveContentSchedule failed:', error);
        return json(500, { error: 'Failed to save schedule', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/softDeleteLivePage — source :5840; publisher; 24h grace. */
    async softDeleteLivePage(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { contentId = '', blogId = '', reason = '' } = body;
        if (!contentId && !blogId) {
          return json(400, { error: 'contentId or blogId required' });
        }

        // Source resolution order: contentId, then blogId as a legacy alias.
        let resolvedId = contentId || null;
        let doc = resolvedId ? await store.readDoc('content', resolvedId, resolvedId) : null;
        if (!doc && blogId) {
          resolvedId = blogId;
          doc = await store.readDoc('content', blogId, blogId);
        }
        if (!doc) return json(404, { error: 'No matching live page record found' });

        const nowDate = now();
        const deletedAtIso = nowDate.toISOString();
        const expiresAtIso = new Date(nowDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

        await store.patchDoc('content', doc.id, {
          Live: false,
          Status: 'Archived',
          contentStatus: 'archived',
          archivedAt: deletedAtIso,
          softDeletedAt: deletedAtIso,
          softDeleteExpiresAt: expiresAtIso,
          scheduledPublishDate: null,
          deletionRequestedBy: actor(user),
          deletionReason: String(reason || '').trim(),
          updatedAt: deletedAtIso,
        });

        return json(200, {
          success: true,
          contentId: doc.id,
          blogIds: [], // the legacy blogs fan-out was retired upstream
          softDeleteExpiresAt: expiresAtIso,
        });
      } catch (error) {
        context.error('softDeleteLivePage failed:', error);
        return json(500, { error: 'Failed to soft-delete page', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/requestContentInspection — source :4839; editor. */
    async requestContentInspection(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { contentId } = body;
        if (!contentId || typeof contentId !== 'string') {
          return json(400, { error: 'contentId required' });
        }

        const doc = await store.readDoc('content', contentId, contentId);
        if (!doc) return json(404, { error: `content ${contentId} not found` });

        await store.patchDoc('content', contentId, {
          inspectTrigger: true,
          contentStatus: 'ingested',
          updatedAt: now().toISOString(),
          updatedBy: actor(user),
        });

        return json(200, { success: true, contentId });
      } catch (error) {
        context.error('requestContentInspection failed:', error);
        return json(500, { error: 'Failed to request inspection', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/resetContentReviewState — source :4931; editor. */
    async resetContentReviewState(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { contentId } = body;
        if (!contentId || typeof contentId !== 'string') {
          return json(400, { error: 'contentId required' });
        }

        const doc = await store.readDoc('content', contentId, contentId);
        if (!doc) return json(404, { error: `content ${contentId} not found` });

        await store.patchDoc('content', contentId, {
          inspectTrigger: false,
          contentStatus: 'ingested',
          inspectError: null,
          Live: false,
          scheduledPublishDate: null,
          updatedAt: now().toISOString(),
          updatedBy: actor(user),
        });

        return json(200, { success: true, contentId });
      } catch (error) {
        context.error('resetContentReviewState failed:', error);
        return json(500, { error: 'Failed to reset review state', message: error?.message || 'Unknown error' });
      }
    },
  };
}
