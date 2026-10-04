/**
 * Content workflow write RPCs — saveEditorDraft, unpublishContentToInspected,
 * deleteContentItem, saveContentSchedule, unscheduleContent, softDeleteLivePage,
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
 *
 * Each handler is a module-level function over `ctx` — the factory's deps —
 * and the factory only binds them (PR #841). The editor save and its pure
 * rules are in ./content-workflow/editor.js, the schedule routes in
 * ./content-workflow/schedule.js; both are re-exported here so every caller
 * and test keeps its import path.
 */
import { randomUUID } from 'node:crypto';
import { normalizeCurrentStatusForBlogOnly } from './cms/content-update-validation.js';
import { actor, auditRow, json, readBody, workflowFailure } from './content-workflow/shared.js';
import { saveEditorDraft } from './content-workflow/editor.js';
import { saveContentSchedule, unscheduleContent } from './content-workflow/schedule.js';

export {
  assertImageUrlList,
  buildContentImageUpdates,
  buildContentImageFieldUpdates,
  editedAtMillis,
  assertNoEditConflict,
  validateSaveEditorDraftBody,
} from './content-workflow/editor.js';

const UNPUBLISHABLE_STATUSES = ['published', 'approved'];

/** Why an unpublish cannot proceed, as the response to send, or null. */
function unpublishRefusal({ contentId, validId, notesOk, currentData, previousStatus }) {
  if (!validId) return json(400, { error: 'contentId required' });
  if (!notesOk) return json(400, { error: 'reviewNotes exceeds 5000 characters' });
  if (!currentData) return json(404, { error: `content ${contentId} not found` });
  if (!UNPUBLISHABLE_STATUSES.includes(previousStatus)) {
    return json(400, {
      error: `Cannot unpublish content from status ${previousStatus}`,
      allowedStatuses: UNPUBLISHABLE_STATUSES,
    });
  }
  return null;
}

/** POST /api/unpublishContentToInspected — source :4635; publisher. */
async function unpublishContentToInspected({ guard, store, now, uuid }, request, context) {
  const auth = await guard.requireRole(request, 'publisher');
  if (auth.error) return auth.error;
  const { user } = auth;

  try {
    const { contentId, reviewNotes = '' } = await readBody(request);
    const validId = Boolean(contentId) && typeof contentId === 'string';
    const notesOk = String(reviewNotes || '').length <= 5000;
    const currentData =
      validId && notesOk ? await store.readDoc('content', contentId, contentId) : null;
    const previousStatus = normalizeCurrentStatusForBlogOnly(
      currentData?.contentStatus || 'ingested'
    );
    const refusal = unpublishRefusal({ contentId, validId, notesOk, currentData, previousStatus });
    if (refusal) return refusal;
    const contentTitle = currentData.Title || currentData.title || '';

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
      auditRow(uuid, {
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

    return json(200, {
      success: true,
      contentId,
      from: previousStatus,
      to: 'inspected',
    });
  } catch (error) {
    return workflowFailure(
      context,
      'unpublishContentToInspected',
      error,
      'Failed to unpublish content'
    );
  }
}

/** POST /api/deleteContentItem — source :4724; publisher; hard delete. */
async function deleteContentItem({ guard, store, onContentDeleted }, request, context) {
  const auth = await guard.requireRole(request, 'publisher');
  if (auth.error) return auth.error;

  try {
    const { contentId } = await readBody(request);
    if (!contentId) return json(400, { error: 'contentId required' });

    try {
      await store.deleteDoc('content', contentId);
    } catch (err) {
      // Firestore .delete() on a missing doc is a no-op; keep that.
      if (err?.code !== 404) throw err;
    }
    // The change feed never delivers a delete (T-324): move the dashboard
    // counters here, best-effort.
    if (onContentDeleted) {
      await onContentDeleted(contentId).catch((err) =>
        context.warn?.(`deleteContentItem: counters not updated for ${contentId}: ${err?.message}`)
      );
    }
    return json(200, { success: true, contentId });
  } catch (error) {
    return workflowFailure(context, 'deleteContentItem', error, 'Failed to delete content');
  }
}

/** The live page a soft delete names: by contentId, then blogId as a legacy alias. */
async function resolveLivePage(store, { contentId, blogId }) {
  const doc = contentId ? await store.readDoc('content', contentId, contentId) : null;
  if (!doc && blogId) return store.readDoc('content', blogId, blogId);
  return doc;
}

/** POST /api/softDeleteLivePage — source :5840; publisher; 24h grace. */
async function softDeleteLivePage({ guard, store, now }, request, context) {
  const auth = await guard.requireRole(request, 'publisher');
  if (auth.error) return auth.error;
  const { user } = auth;

  try {
    const { contentId = '', blogId = '', reason = '' } = await readBody(request);
    if (!contentId && !blogId) {
      return json(400, { error: 'contentId or blogId required' });
    }

    const doc = await resolveLivePage(store, { contentId, blogId });
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
    return workflowFailure(context, 'softDeleteLivePage', error, 'Failed to soft-delete page');
  }
}

/**
 * The two editor resets share a shape: a valid id, an existing document,
 * one patch. `fields` is what each one writes beside the stamps.
 */
async function patchExistingContent(
  { guard, store, now },
  request,
  context,
  { label, message, fields }
) {
  const auth = await guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  const { user } = auth;

  try {
    const { contentId } = await readBody(request);
    if (!contentId || typeof contentId !== 'string') {
      return json(400, { error: 'contentId required' });
    }

    const doc = await store.readDoc('content', contentId, contentId);
    if (!doc) return json(404, { error: `content ${contentId} not found` });

    await store.patchDoc('content', contentId, {
      ...fields,
      updatedAt: now().toISOString(),
      updatedBy: actor(user),
    });

    return json(200, { success: true, contentId });
  } catch (error) {
    return workflowFailure(context, label, error, message);
  }
}

/** POST /api/requestContentInspection — source :4839; editor. */
const requestContentInspection = (ctx, request, context) =>
  patchExistingContent(ctx, request, context, {
    label: 'requestContentInspection',
    message: 'Failed to request inspection',
    fields: { inspectTrigger: true, contentStatus: 'ingested' },
  });

/** POST /api/resetContentReviewState — source :4931; editor. */
const resetContentReviewState = (ctx, request, context) =>
  patchExistingContent(ctx, request, context, {
    label: 'resetContentReviewState',
    message: 'Failed to reset review state',
    fields: {
      inspectTrigger: false,
      contentStatus: 'ingested',
      inspectError: null,
      Live: false,
      scheduledPublishDate: null,
    },
  });

const HANDLERS = Object.freeze({
  saveEditorDraft,
  unpublishContentToInspected,
  deleteContentItem,
  saveContentSchedule,
  unscheduleContent,
  softDeleteLivePage,
  requestContentInspection,
  resetContentReviewState,
});

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function, deleteDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createContentWorkflowHandlers({
  guard,
  store,
  onContentDeleted = null,
  now = () => new Date(),
  uuid = randomUUID,
}) {
  const ctx = { guard, store, onContentDeleted, now, uuid };
  return Object.fromEntries(
    Object.entries(HANDLERS).map(([name, handler]) => [
      name,
      (request, context) => handler(ctx, request, context),
    ])
  );
}
