/**
 * createContentItem — the write path for new content documents.
 *
 * Ported from Site-Main cms-functions.js createContentItem (:3047-3140),
 * composing the already-ported pieces in source order: normalize type and
 * publish target → shape body fields → four-stage dedup (409) → editorial
 * critique unless the caller opts out → content-quality gate on elevated
 * statuses (422, unless forceQualityBypass) → write the document.
 *
 * Adaptations, each deliberate:
 *   - Firestore `.add()` minted the document id; Cosmos requires an explicit
 *     one, so the handler stamps `id: uuid()` after the data spread — a client
 *     -supplied `id` never picks the document key, exactly like `.add()`.
 *   - `FieldValue.serverTimestamp()` becomes one ISO string used for both
 *     'Created At' and updatedAt — the shape scripts/lib/firestore-transform
 *     .mjs already gives migrated documents.
 *   - `critiqueDraft` is injected and defaults to a null critique: the AI
 *     model-router slice has not landed, and every scorer is specified to
 *     grade correctly with critique=null (the runEditorialCritique:false
 *     path). Wiring the real critique later changes this one default.
 *   - createdBy falls back through the Entra claim names (email is often
 *     absent on access tokens; preferred_username usually is not) before the
 *     source's literal 'admin'.
 */
import { randomUUID } from 'node:crypto';
import {
  normalizeContentBodyFields,
  getPrimaryContentBody,
  buildContentQualityReport,
  buildImageReadinessReport,
  buildImageLineage,
} from './content-quality.js';
import { findDuplicateContent, buildDedupFields } from './content-dedup.js';
import { normalizePublishTarget, SUPPORTED_PUBLISH_TARGETS } from './publish-targets.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Statuses that must pass the quality gate to be set at creation time. */
export const QUALITY_ENFORCED_STATUSES = ['inspected', 'approved', 'forge_ready', 'published'];

const nullCritique = async () => null;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, upsertDoc: Function }} deps.store
 * @param {Function} [deps.critiqueDraft] async ({title, postContent}) => critique|null
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createContentCreateHandler({
  guard,
  store,
  critiqueDraft = nullCritique,
  now = () => new Date(),
  uuid = randomUUID,
}) {
  return async function createContentItem(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    const { user } = auth;

    try {
      const body = await request.json().catch(() => null);
      const data =
        body && typeof body.data === 'object' && body.data !== null && !Array.isArray(body.data)
          ? body.data
          : {};

      const requestedType = String(data.type || '').toLowerCase();
      const normalizedType = SUPPORTED_PUBLISH_TARGETS.has(requestedType)
        ? requestedType
        : 'blog';

      const normalizedData = normalizeContentBodyFields({
        ...data,
        publishTarget: normalizePublishTarget(data.publishTarget, normalizedType),
        type: normalizedType,
      });

      const sourceUrl =
        normalizedData.sourceUrl || normalizedData.url || normalizedData['CD Url'] || '';
      const duplicate = await findDuplicateContent(store, {
        url: sourceUrl,
        canonicalUrl: normalizedData.canonicalUrl,
        title: normalizedData.Title || normalizedData.title,
        publishedAt:
          normalizedData.publishedAt ||
          normalizedData.publishedDate ||
          normalizedData['Published At'],
      });
      if (duplicate.duplicate) {
        return json(409, {
          success: false,
          error: 'Duplicate content detected',
          duplicateReason: duplicate.reason,
          existingId: duplicate.existingId,
        });
      }

      const qualityCritique =
        body?.runEditorialCritique === false
          ? null
          : await critiqueDraft({
              title: normalizedData.Title || normalizedData.title || '',
              postContent: getPrimaryContentBody(normalizedData),
            });
      const contentQuality = buildContentQualityReport(normalizedData, qualityCritique);
      const imageReadiness = buildImageReadinessReport(normalizedData);
      const requestedStatus = normalizedData.contentStatus || 'draft';
      const shouldEnforceQuality = QUALITY_ENFORCED_STATUSES.includes(requestedStatus);
      if (shouldEnforceQuality && !contentQuality.ready && body?.forceQualityBypass !== true) {
        return json(422, {
          success: false,
          error: 'Content quality gate failed',
          contentQuality,
        });
      }

      const dedupFields = buildDedupFields({
        url: sourceUrl,
        canonicalUrl: normalizedData.canonicalUrl,
        title: normalizedData.Title || normalizedData.title,
      });
      const imageLineage = buildImageLineage(normalizedData);

      const timestamp = now().toISOString();
      const doc = {
        ...normalizedData,
        ...dedupFields,
        id: uuid(),
        contentStatus: requestedStatus,
        storageCollection: 'content',
        contentQuality,
        imageReadiness,
        // Source wrote the readiness report under both names; callers read both.
        imageQuality: imageReadiness,
        imageLineage,
        createdBy: user.email || user.preferred_username || user.oid || user.sub || 'admin',
        'Created At': timestamp,
        updatedAt: timestamp,
      };
      // New doc with a fresh uuid — upsert can never overwrite (matches .add()).
      await store.upsertDoc('content', doc);

      return json(200, { success: true, contentId: doc.id });
    } catch (error) {
      context.error('createContentItem failed:', error);
      return json(500, {
        error: 'Failed to create content item',
        message: error?.message || 'Unknown error',
      });
    }
  };
}
