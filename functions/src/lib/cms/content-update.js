/**
 * updateContentItem + transitionContentStatus — the two remaining writers on
 * the content container, ported from Site-Main cms-functions.js (:3564 and
 * :6813).
 *
 * Both are PARTIAL writes and therefore go through patchDoc, never upsertDoc:
 * an upsert here would replace the whole document and silently drop every
 * field the caller didn't send (the exact hazard #42's patchDoc exists to
 * prevent). Deletions ride patchDoc's `undefined` convention.
 *
 * Adaptations, each deliberate:
 *   - The source wrapped doc-update + version/audit writes in a Firestore
 *     transaction. Cosmos has no cross-container transaction, so the writes
 *     are sequential with the content patch FIRST: if a later bookkeeping
 *     write fails, the user-visible change has landed and the failure
 *     surfaces as a 500 the caller can retry; the reverse order could record
 *     history for an edit that never happened.
 *   - Version history goes to the `content_versions` container (partition key
 *     /contentId — the migration manifest's one non-/id container), with an
 *     explicit uuid id replacing Firestore's auto-id subcollection doc.
 *   - Audit rows carry ISO timestamps and a uuid id. ipAddress is null for
 *     now: Azure Functions has no trustworthy req.ip equivalent and logging a
 *     spoofable X-Forwarded-For into a compliance record is worse than null —
 *     wire lib/auth/client-identity.js here when its CF_ORIGIN_SECRET path is
 *     configured.
 *   - The publisher gate for going live reads the role resolved by the guard
 *     (admins/{oid} record), the same authority the source's user.adminRole
 *     carried.
 */
import { randomUUID } from 'node:crypto';
import { normalizeContentBodyFields } from './content-quality.js';
import { normalizePublishTarget } from './publish-targets.js';
import {
  validateAndNormalizeUpdateContentItemUpdates,
  normalizeContentUpdatesForBlogOnly,
  normalizeStatusForBlogOnly,
  normalizeCurrentStatusForBlogOnly,
} from './content-update-validation.js';
import {
  VALID_TRANSITIONS,
  buildStatusUpdateData,
  validateTransitionRequest,
} from './content-status.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * POST/PATCH updateContentItem — validated partial update + version history +
 * audit row. Source :3564.
 *
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createContentUpdateHandler({ guard, store, now = () => new Date(), uuid = randomUUID }) {
  return async function updateContentItem(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    const { user } = auth;

    try {
      const body = await request.json().catch(() => null);
      const { contentId, updates = {} } = body || {};
      if (!contentId || typeof updates !== 'object') {
        return json(400, { error: 'contentId and updates object required' });
      }

      let validatedUpdates;
      try {
        validatedUpdates = validateAndNormalizeUpdateContentItemUpdates(updates);
      } catch (error) {
        return json(400, { error: String(error.message || error) });
      }

      const normalizedUpdates = normalizeContentBodyFields(
        normalizeContentUpdatesForBlogOnly(validatedUpdates)
      );

      const currentData = await store.readDoc('content', contentId, contentId);
      if (!currentData) {
        return json(404, { error: `Content ${contentId} not found` });
      }

      const editor = user.email || user.preferred_username || user.oid || user.sub || 'admin';
      const nowIso = now().toISOString();

      // Content patch first — see the ordering note in the header.
      await store.patchDoc('content', contentId, {
        ...normalizedUpdates,
        updatedAt: nowIso,
        updatedBy: editor,
      });

      await store.upsertDoc('content_versions', {
        id: uuid(),
        contentId,
        title:
          normalizedUpdates.Title ||
          normalizedUpdates.title ||
          currentData.Title ||
          currentData.title ||
          '',
        summary:
          normalizedUpdates.Summary ||
          normalizedUpdates.summary ||
          currentData.Summary ||
          currentData.summary ||
          '',
        draft:
          normalizedUpdates.blogDraft ||
          normalizedUpdates.content ||
          currentData.blogDraft ||
          currentData.content ||
          '',
        updatedFields: Object.keys(normalizedUpdates),
        versionCreatedAt: nowIso,
        versionCreatedBy: editor,
        versionReason: 'review_updated',
      });

      await store.upsertDoc('admin_audit_logs', {
        id: uuid(),
        action: 'content_item_updated',
        userId: user.oid || user.sub || null,
        userEmail: user.email || null,
        timestamp: nowIso,
        details: { contentId, updatedFields: Object.keys(normalizedUpdates) },
        userAgent: request.headers?.get?.('user-agent') || null,
        contentId,
        contentTitle: currentData.Title || currentData.title || '',
        compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
      });

      return json(200, { success: true, contentId });
    } catch (error) {
      context.error('updateContentItem failed:', error);
      return json(500, {
        error: 'Failed to update content item',
        message: error?.message || 'Unknown error',
      });
    }
  };
}

/**
 * POST transitionContentStatus — the state machine's single writer.
 * Source :6813.
 *
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function, queryDocs: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createContentTransitionHandler({ guard, store, now = () => new Date(), uuid = randomUUID }) {
  return async function transitionContentStatus(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    const { user } = auth;

    try {
      const body = (await request.json().catch(() => null)) || {};
      const {
        contentId,
        blogId,
        newStatus,
        publishTarget = null,
        markLive = null,
        reviewNotes = '',
        reviewedBy = user.email || user.preferred_username || user.oid || 'admin',
      } = body;

      const normalizedStatus = normalizeStatusForBlogOnly(newStatus);
      const normalizedPublishTarget = normalizePublishTarget(publishTarget);

      // Editors may move content through the review workflow, but the live
      // transition is reserved for publishers. The dedicated publishContent
      // endpoint enforces the same boundary.
      if (
        normalizedStatus === 'published' &&
        !['publisher', 'super_admin'].includes(String(auth.role || '').toLowerCase())
      ) {
        return json(403, { error: 'publisher access required for live publishing' });
      }

      const validation = validateTransitionRequest({
        contentId,
        blogId,
        normalizedStatus,
        markLive,
        reviewNotes,
        reviewedBy,
      });
      if (!validation.ok) {
        return json(validation.status, validation.error);
      }

      // Fallback for older API calls that pass blogId instead of contentId.
      let resolvedContentId = contentId || null;
      let legacyBlogId = null;
      if (!resolvedContentId) {
        const rows = await store.queryDocs(
          'content',
          'SELECT TOP 1 c.id FROM c WHERE c.publishedBlogId = @blogId',
          [{ name: '@blogId', value: blogId }]
        );
        if (rows.length === 0) {
          return json(404, { error: 'legacy content document not found for this blogId' });
        }
        resolvedContentId = rows[0].id;
        legacyBlogId = blogId;
      }

      const data = await store.readDoc('content', resolvedContentId, resolvedContentId);
      if (!data) {
        return json(404, { error: `Content ${resolvedContentId} not found` });
      }

      const currentStatus = data.contentStatus || 'ingested';
      const normalizedCurrentStatus = normalizeCurrentStatusForBlogOnly(currentStatus);
      const previousStatus = normalizedCurrentStatus;

      const allowed = VALID_TRANSITIONS[normalizedCurrentStatus];
      if (!allowed || !allowed.includes(normalizedStatus)) {
        return json(400, {
          error: `Invalid transition: ${normalizedCurrentStatus} → ${normalizedStatus}`,
          allowedTransitions: allowed || [],
        });
      }

      const nowDate = now();
      const updateData = buildStatusUpdateData(data, normalizedStatus, reviewedBy, reviewNotes, {
        publishTarget: normalizedPublishTarget,
        markLive,
        now: nowDate,
      });

      // Enforce additional invariants tied to the state machine.
      if (normalizedStatus === 'archived') {
        updateData.archivedAt = nowDate.toISOString();
      }
      if (normalizedCurrentStatus === 'rejected' && normalizedStatus === 'inspected') {
        // "Restore" should remove rejection marker so the doc no longer appears as rejected.
        updateData.rejectedAt = null;
      }

      await store.patchDoc('content', resolvedContentId, updateData);

      const changedFields = Object.keys(updateData);
      await store.upsertDoc('audits', {
        id: uuid(),
        timestamp: nowDate.toISOString(),
        action: 'status_transition',
        resourceType: 'content',
        resourceId: resolvedContentId,
        resourceTitle: data.Title || data.title || '',
        userId: user.oid || user.sub || reviewedBy,
        userName: user.name || null,
        userEmail: user.email || null,
        changes: {
          before: { contentStatus: currentStatus },
          after: { contentStatus: normalizedStatus },
          changedFields,
          notes: reviewNotes,
        },
        ipAddress: null, // see header — no trustworthy source until client-identity is wired
        userAgent: request.headers?.get?.('user-agent') || null,
        metadata: {
          ...(legacyBlogId ? { legacyBlogId } : {}),
          authMethod: 'entra_bearer_token',
          reviewedBy,
        },
        compliance: {
          dataClassification: 'internal',
          retentionMonths: 24,
          identityVerified: true,
        },
      });

      context.warn(
        `transitionStatus ${resolvedContentId}: ${previousStatus} → ${normalizedStatus} by ${reviewedBy}`
      );
      return json(200, {
        success: true,
        contentId: resolvedContentId,
        legacyBlogId,
        collectionName: 'content',
        from: previousStatus,
        to: normalizedStatus,
      });
    } catch (error) {
      context.error('transitionContentStatus failed:', error);
      return json(500, {
        error: 'Failed to transition content status',
        message: error?.message || 'Unknown error',
      });
    }
  };
}
