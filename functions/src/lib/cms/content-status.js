/**
 * Content status state machine — transitions table, per-status appliers, and
 * the update payload builder for transitionContentStatus.
 *
 * Ported from Site-Main cms-functions.js (VALID_TRANSITIONS :2322,
 * STATUS_APPLIERS + buildStatusUpdateData :558, validateTransitionRequest
 * :6750, canPublishFromStatus :2249 area). The transition table is the single
 * source of truth for "can this be published?" — the source comment records
 * that a second divergent copy once stranded items in retry/alert loops, so
 * this port keeps exactly one table.
 *
 * Adaptations for Cosmos, each deliberate:
 *   - `FieldValue.delete()` becomes `undefined`, the deletion convention
 *     patchDoc already defines (an undefined value removes the field via its
 *     read-modify-write path).
 *   - `FieldValue.serverTimestamp()` becomes an injected `now` Date, written
 *     as an ISO string — the same shape the migration gives every timestamp.
 *   - Dates resolved from existing docs may be ISO strings (migrated shape),
 *     so toValidDate parses strings as well as Date/Timestamp — mirroring the
 *     getDocDateValue adaptation in content-dedup.js.
 */
import { normalizePublishTarget } from './publish-targets.js';
import { normalizeCurrentStatusForBlogOnly } from './content-update-validation.js';

export const VALID_TRANSITIONS = {
  draft: ['ingested', 'in_review', 'approved', 'published', 'rejected'],
  ingested: ['inspected', 'in_review', 'approved', 'published', 'rejected'],
  inspected: ['in_review', 'approved', 'published', 'rejected'],
  needs_rework: ['inspected', 'in_review', 'approved', 'published', 'rejected'],
  in_review: ['approved', 'published', 'rejected'],
  approved: ['editing', 'published', 'rejected'],
  editing: ['approved', 'forge_ready', 'published', 'in_review', 'rejected'],
  // forge_ready — ContentForge generated + graded above threshold; staged for
  // one-click human publish. Set by the forgeArticle pipeline.
  forge_ready: ['published', 'editing', 'rejected'],
  published: ['archived', 'editing', 'inspected', 'rejected'],
  rejected: ['inspected', 'in_review', 'archived'],
  archived: ['in_review', 'rejected'],
};

export const VALID_STATUSES = Object.keys(VALID_TRANSITIONS);

// The single source of truth for "can this be published?", in normalized
// status terms — see the header for why there must be exactly one copy.
export const PUBLISHABLE_NORMALIZED_STATUSES = ['approved', 'forge_ready', 'published'];

/**
 * @param {string} status - raw or normalized contentStatus
 * @returns {boolean} whether the publish pipeline will accept it
 */
export function canPublishFromStatus(status) {
  return PUBLISHABLE_NORMALIZED_STATUSES.includes(normalizeCurrentStatusForBlogOnly(status));
}

/** Date from Date / Firestore-style Timestamp / ISO string, else null. */
export function toValidDate(value) {
  if (!value) return null;
  const parsed = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolvePreferredPublishedDate(data = {}) {
  const candidates = [
    data.publishedDate,
    data.datePublished,
    data['Published At'],
    data.publishedAt,
  ];

  for (const candidate of candidates) {
    const parsed = toValidDate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function applyStatusApproved(updateData, data, ctx) {
  updateData.approvedForNews = false;
  updateData.publishTarget = ctx.resolvedPublishTarget;
  if (!data.blogDraft) {
    updateData.blogDraft = data.content || data.Content || '';
  }
}

function applyStatusEditing(updateData, data) {
  if (!data.blogDraft) {
    updateData.blogDraft = data.content || data.Content || '';
  }
}

function applyStatusPublished(updateData, data, ctx) {
  const fallbackTimestamp = ctx.nowIso;
  const resolvedIso = ctx.resolvedPublishedDate ? ctx.resolvedPublishedDate.toISOString() : null;
  updateData.publishedAt = resolvedIso || fallbackTimestamp;
  if (resolvedIso) {
    updateData['Published At'] = resolvedIso;
    updateData.publishedDate = resolvedIso;
    updateData.datePublished = resolvedIso;
  }
  updateData.publishTarget = ctx.resolvedPublishTarget;
  updateData.Live = ctx.markLive === null ? true : Boolean(ctx.markLive);
  updateData.approvedForNews = false;
}

function applyStatusRejected(updateData, data, ctx) {
  updateData.Live = false;
  updateData.rejectedAt = ctx.nowIso;
}

function applyStatusArchived(updateData) {
  updateData.Live = false;
}

function applyStatusForgeReady(updateData) {
  updateData.Live = false;
}

const STATUS_APPLIERS = {
  approved: applyStatusApproved,
  editing: applyStatusEditing,
  forge_ready: applyStatusForgeReady, // Live=false while staged for publish
  published: applyStatusPublished,
  rejected: applyStatusRejected,
  archived: applyStatusArchived,
};

/**
 * The patch payload for a status transition. `undefined` values are deletions
 * (patchDoc's convention, replacing FieldValue.delete()).
 *
 * @param {object} data current document
 * @param {string} newStatus normalized target status
 * @param {string} reviewedBy
 * @param {string} reviewNotes
 * @param {{publishTarget?: string|null, markLive?: boolean|null, now?: Date}} options
 */
export function buildStatusUpdateData(data, newStatus, reviewedBy, reviewNotes, options = {}) {
  const { publishTarget = null, markLive = null, now = new Date() } = options;
  const ctx = {
    resolvedPublishTarget: normalizePublishTarget(
      publishTarget,
      data.publishTarget || data.type || data.contentType
    ),
    resolvedPublishedDate: resolvePreferredPublishedDate(data),
    markLive,
    nowIso: now.toISOString(),
  };
  const updateData = {
    contentStatus: newStatus,
    reviewedBy,
    reviewedAt: ctx.nowIso,
    reviewNotes,
  };

  const applier = STATUS_APPLIERS[newStatus];
  if (applier) applier(updateData, data, ctx);

  if (newStatus !== 'rejected') {
    updateData.softDeletedAt = undefined;
    updateData.softDeletedReason = undefined;
    updateData.rejectedAt = undefined;
  }

  return updateData;
}

/** Request-shape validation for transitionContentStatus (source :6750). */
export function validateTransitionRequest({
  contentId,
  blogId,
  normalizedStatus,
  markLive,
  reviewNotes,
  reviewedBy,
}) {
  if (contentId && typeof contentId !== 'string') {
    return { ok: false, status: 400, error: { error: 'contentId must be a string' } };
  }
  if (blogId && typeof blogId !== 'string') {
    return { ok: false, status: 400, error: { error: 'blogId must be a string' } };
  }
  if (markLive !== null && markLive !== undefined && typeof markLive !== 'boolean') {
    return {
      ok: false,
      status: 400,
      error: { error: 'markLive must be boolean when provided' },
    };
  }
  if (String(reviewNotes || '').length > 5000) {
    return { ok: false, status: 400, error: { error: 'reviewNotes exceeds 5000 characters' } };
  }
  if (String(reviewedBy || '').length > 240) {
    return { ok: false, status: 400, error: { error: 'reviewedBy exceeds 240 characters' } };
  }
  if ((!contentId && !blogId) || !normalizedStatus) {
    return {
      ok: false,
      status: 400,
      error: { error: 'contentId (or blogId) and newStatus required' },
    };
  }
  if (!VALID_STATUSES.includes(normalizedStatus)) {
    return {
      ok: false,
      status: 400,
      error: { error: `Invalid status: ${normalizedStatus}`, validStatuses: VALID_STATUSES },
    };
  }
  return { ok: true };
}
