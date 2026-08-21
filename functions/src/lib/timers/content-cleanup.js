/**
 * content-cleanup.js — the two reapers behind `cleanupRejectedContent`
 * (04:00 Chicago) and `cleanupSoftDeletedContent` (every 4 h).
 *
 * Ported from Site-Main `cms/cleanup.js` (088f458). The first is soft: a
 * rejection older than the cutoff gets `softDeletedAt`, so a misclick stays
 * recoverable for the second reaper's grace window (7 days at the call
 * site). The second is hard: the content document, every blog linked to it
 * (`publishedBlogId`, and `blogs.sourceContentId`), and its `content_versions`
 * rows (a container here, not a subcollection — so they CAN be deleted).
 *
 * Firestore's 500-write batch cap shaped the upstream code; Cosmos has no
 * batch here, so each document is its own operation and a failure stops the
 * run at that document rather than rolling anything back.
 */
import { getDocDateValue } from '../cms/content-dedup.js';
import { writeSystemAudit } from './workflow-records.js';

export function getRejectionReferenceDate(data) {
  return (
    getDocDateValue(data?.rejectedAt) ||
    getDocDateValue(data?.reviewedAt) ||
    getDocDateValue(data?.updatedAt) ||
    null
  );
}

export function createContentCleanup({ store, now = () => new Date(), uuid, log = {} }) {
  const auditOpts = { now, ...(uuid && { uuid }) };

  /** Mark rejected content older than `olderThanHours` as soft-deleted. */
  async function softDeleteRejected({ olderThanHours = null, limit = 500 } = {}) {
    const maxLimit = Math.min(Number(limit) || 500, 500);
    const cutoff =
      typeof olderThanHours === 'number' && olderThanHours > 0
        ? new Date(now().getTime() - olderThanHours * 60 * 60 * 1000)
        : null;
    const rows = await store.queryDocs(
      'content',
      `SELECT TOP ${maxLimit} c.id, c.softDeletedAt, c.rejectedAt, c.reviewedAt, c.updatedAt FROM c WHERE c.contentStatus = 'rejected'`,
      []
    );
    const examined = (rows || []).length;
    const toMark = (rows || []).filter((data) => {
      if (data.softDeletedAt) return false;
      if (!cutoff) return true;
      const reference = getRejectionReferenceDate(data);
      return reference && reference < cutoff;
    });
    if (!toMark.length) {
      return {
        deletedCount: 0,
        softDeletedCount: 0,
        examinedCount: examined,
        hasMore: examined === maxLimit,
      };
    }
    const stamp = now().toISOString();
    for (const doc of toMark) {
      await store.patchDoc('content', doc.id, {
        softDeletedAt: stamp,
        softDeletedReason: 'rejected_aged_out',
      });
    }
    await writeSystemAudit(
      store,
      {
        action: 'cron_soft_deleted_rejected_content',
        source: 'cleanupRejectedContent',
        details: {
          affectedCount: toMark.length,
          examinedCount: examined,
          olderThanHours: typeof olderThanHours === 'number' ? olderThanHours : null,
          affectedIds: toMark.slice(0, 50).map((d) => d.id),
          truncatedAffectedIds: toMark.length > 50,
        },
      },
      auditOpts
    );
    log.log?.(`[cleanupRejectedContent] soft-deleted ${toMark.length} of ${examined}`);
    return {
      deletedCount: toMark.length,
      softDeletedCount: toMark.length,
      examinedCount: examined,
      hasMore: examined === maxLimit,
    };
  }

  /** Hard-delete content soft-deleted longer than `olderThanHours` ago, with its blogs and versions. */
  async function hardDeleteSoftDeleted({ olderThanHours = 24, limit = 200 } = {}) {
    const maxLimit = Math.min(Number(limit) || 200, 500);
    const cutoff = new Date(now().getTime() - olderThanHours * 60 * 60 * 1000).toISOString();
    const rows = await store.queryDocs(
      'content',
      `SELECT TOP ${maxLimit} c.id, c.publishedBlogId FROM c WHERE IS_DEFINED(c.softDeletedAt) AND c.softDeletedAt != null AND c.softDeletedAt <= @cutoff`,
      [{ name: '@cutoff', value: cutoff }]
    );
    if (!rows || !rows.length)
      return { deletedContentCount: 0, deletedBlogCount: 0, examinedCount: 0, hasMore: false };

    let deletedBlogCount = 0;
    let versionsDeleted = 0;
    for (const doc of rows) {
      const blogIds = new Set();
      if (
        doc.publishedBlogId &&
        (await store.readDoc('blogs', doc.publishedBlogId, doc.publishedBlogId))
      ) {
        blogIds.add(doc.publishedBlogId);
      }
      const related = await store.queryDocs(
        'blogs',
        'SELECT c.id FROM c WHERE c.sourceContentId = @id',
        [{ name: '@id', value: doc.id }]
      );
      for (const blog of related || []) blogIds.add(blog.id);
      for (const blogId of blogIds) {
        await store.deleteDoc('blogs', blogId, blogId);
        deletedBlogCount += 1;
      }
      await store.deleteDoc('content', doc.id, doc.id);
      // Best-effort, after the delete that matters.
      try {
        const versions = await store.queryDocs(
          'content_versions',
          'SELECT c.id FROM c WHERE c.contentId = @id',
          [{ name: '@id', value: doc.id }]
        );
        for (const version of versions || []) {
          await store.deleteDoc('content_versions', version.id, doc.id);
          versionsDeleted += 1;
        }
      } catch (err) {
        log.warn?.(
          `[cleanupSoftDeletedContent] versions cleanup failed for ${doc.id}: ${err?.message || err}`
        );
      }
    }
    await writeSystemAudit(
      store,
      {
        action: 'cron_hard_deleted_soft_deleted_content',
        source: 'cleanupSoftDeletedContent',
        details: {
          deletedContentCount: rows.length,
          deletedBlogCount,
          deletedVersionCount: versionsDeleted,
          olderThanHours,
          affectedIds: rows.slice(0, 50).map((d) => d.id),
          truncatedAffectedIds: rows.length > 50,
        },
      },
      auditOpts
    );
    log.log?.(
      `[cleanupSoftDeletedContent] content=${rows.length} blogs=${deletedBlogCount} versions=${versionsDeleted}`
    );
    return {
      deletedContentCount: rows.length,
      deletedBlogCount,
      examinedCount: rows.length,
      hasMore: rows.length === maxLimit,
    };
  }

  return { softDeleteRejected, hardDeleteSoftDeleted };
}
