/**
 * The publish pipeline — publishContent (batch, up to 25 ids) and its
 * single-item core processPublishContent, ported from Site-Main
 * cms-functions.js (:111-160, :218-360, :1337-1600, :6657-6745).
 *
 * Sequence per item, exactly as the source: publishable-status check (the one
 * canPublishFromStatus table) → quality gate → image gate (each persisting
 * its failed report onto the doc) → slug resolution (republish reuses the
 * stored slug; new publishes get a clean slug, suffixed only on a real
 * collision) → metadata validation (new publishes only) → cover trigger →
 * the publish write → forge format stats → version snapshot.
 *
 * Adaptations, each deliberate:
 *   - The scrapedImages re-hosting step (`_internal_archiveScrapedImageRefs`)
 *     is NOT ported: it re-uploads scraped assets between Firebase Storage
 *     paths, which belongs to the asset-migration phase. When refs need
 *     archiving the item still publishes and a warning is surfaced in the
 *     batch results, so nothing silently changes.
 *   - bumpForgeStats' FieldValue.increment becomes read-modify-patch on the
 *     whole totals/formats objects — formatKey is user-influenced text, and
 *     writing whole objects avoids dotted-path escaping entirely.
 *   - Timestamps/publish markers are ISO strings (the migrated shape).
 *   - uniqueSlug's collision probe is a parameterized Cosmos query; a failed
 *     probe falls back to the always-suffixed slug, exactly as the source
 *     ("ugly but always unique" — a lookup failure must not block a publish).
 */
import { randomUUID } from 'node:crypto';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { buildContentQualityReport, buildImageReadinessReport } from './content-quality.js';
import { normalizePublishTarget, SUPPORTED_PUBLISH_TARGETS } from './publish-targets.js';
import {
  canPublishFromStatus,
  PUBLISHABLE_NORMALIZED_STATUSES,
  resolvePreferredPublishedDate,
  toValidDate,
} from './content-status.js';
import {
  normalizeCurrentStatusForBlogOnly,
  normalizeProviderName,
} from './content-update-validation.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function slugify(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

const slugSuffix = (id = '') => (id ? String(id).slice(0, 6) : Date.now().toString(36).slice(-6));

export function toPublicUrl(pathValue) {
  if (!pathValue) return null;
  const path = String(pathValue).startsWith('/') ? String(pathValue) : `/${String(pathValue)}`;
  return `https://hybridcloudworks.com${path}`;
}

/**
 * The public URL a content document already carries, in the precedence the
 * Social Hub uses. '' when the document has none (never guessed). Shared by
 * the social-caption trigger and the related-posts interlinker.
 */
export function publicUrlOf(data = {}) {
  if (data.publishedUrl) return data.publishedUrl;
  if (data.publicUrl) return data.publicUrl;
  const path = data.curatedSubpagePath || data.slugPageUrl || '';
  return path ? toPublicUrl(path) : '';
}

export function getPublicSectionForPublishTarget(publishTarget) {
  switch (normalizePublishTarget(publishTarget)) {
    case 'framework':
      return 'frameworks';
    case 'architecture':
      return 'architecture-designs';
    case 'coder_corner':
      return 'code';
    case 'blog':
    default:
      return 'blog';
  }
}

const isValidDateValue = (value) => {
  if (!value) return true;
  return toValidDate(value) !== null;
};

export function validatePublishMetadata({ contentData = {}, publishTarget, cloudProvider, slug }) {
  const errors = [];
  if (!SUPPORTED_PUBLISH_TARGETS.has(normalizePublishTarget(publishTarget))) {
    errors.push(`Invalid publishTarget: ${publishTarget}`);
  }
  if (!normalizeProviderName(cloudProvider)) {
    errors.push('Missing or invalid cloud provider');
  }
  if (!slug || typeof slug !== 'string' || !slug.trim()) {
    errors.push('Missing slug for publish path');
  }
  if (
    !isValidDateValue(
      contentData.publishedDate ||
        contentData.datePublished ||
        contentData['Published At'] ||
        contentData.publishedAt
    )
  ) {
    errors.push('Invalid Published At timestamp');
  }
  if (!isValidDateValue(contentData.scheduledPublishDate)) {
    errors.push('Invalid scheduledPublishDate timestamp');
  }
  return errors;
}

export function resolvePublishContext(contentData, params) {
  const effectivePublishTarget = normalizePublishTarget(
    params.publishTarget,
    contentData.publishTarget || contentData.type
  );
  const inferredProvider =
    normalizeProviderName(params.cloudProvider) ||
    normalizeProviderName(
      contentData?.['Cloud Provider'] ||
        contentData?.cloudProvider ||
        contentData?.provider ||
        contentData?.Provider
    );
  return {
    effectivePublishTarget,
    persistedPublishedDate: resolvePreferredPublishedDate(contentData),
    curatedSection: getPublicSectionForPublishTarget(effectivePublishTarget),
    inferredProvider,
    resolvedLandingProvider:
      normalizeProviderName(params.landingProvider) ||
      normalizeProviderName(contentData?.landingProvider) ||
      inferredProvider,
  };
}

/** R1 — fire cover generation at publish when no cover exists (source :1366). */
export function applyPublishTimeCoverTrigger(contentUpdate, contentData) {
  const hasExistingCover =
    Boolean(contentData.altCoverImage) ||
    Boolean(contentData['Cover Image']) ||
    Boolean(contentData.contentImageUrl) ||
    Boolean(contentData.aiImageUrls?.hero) ||
    Boolean(contentData.heroImageUrl) ||
    Boolean(contentData.coverImage);
  const alreadyTriggered = contentData.altCoverImageTrigger === true;
  if (hasExistingCover || alreadyTriggered) return;
  contentUpdate.altCoverImageTrigger = true;
  if (!Array.isArray(contentData.aiImageTargets) || contentData.aiImageTargets.length === 0) {
    contentUpdate.aiImageTargets = ['hero'];
  }
}

function buildPublishMappingEntry(contentId, r, reused) {
  return {
    contentId,
    blogId: r.blogId,
    reused,
    slug: r.slug || null,
    curatedSubpagePath: r.curatedSubpagePath || null,
    expectedPublicUrl: r.expectedPublicUrl || null,
    sourceUrl: r.sourceUrl || null,
    landingProvider: r.landingProvider || null,
  };
}

export function accumulatePublishResult(results, contentId, r) {
  if (r.error) {
    results.errors.push({ contentId, error: r.error });
    return;
  }
  // Distinct from `reused`: nothing was written and there is no mapping to
  // report. Counted as skipped rather than published, because falling through
  // to the tail of this function would report a publish that did not happen.
  if (r.skipped) {
    results.skipped += 1;
    results.warnings.push({ contentId, warning: r.reason || 'Skipped' });
    return;
  }
  if (r.warning) {
    results.warnings.push({ contentId, warning: r.warning });
  }
  if (r.reused) {
    results.skipped += 1;
    results.mappings.push(buildPublishMappingEntry(contentId, r, true));
    if (!r.expectedPublicUrl) {
      results.warnings.push({
        contentId,
        warning: 'Published via existing mapping but expectedPublicUrl is missing.',
      });
    }
    return;
  }
  results.published += 1;
  results.mappings.push(buildPublishMappingEntry(contentId, r, false));
  if (!r.expectedPublicUrl) {
    results.warnings.push({
      contentId,
      warning: 'Publish completed but expectedPublicUrl is missing from mapping.',
    });
  }
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createPublishHandlers({ guard, store, now = () => new Date(), uuid = randomUUID }) {
  async function uniqueSlug(baseSlug, id = '') {
    if (!baseSlug) return slugSuffix(id);
    try {
      const clash = await store.queryDocs(
        'content',
        'SELECT TOP 2 c.id FROM c WHERE c.slug = @slug',
        [{ name: '@slug', value: baseSlug }]
      );
      const takenByAnother = clash.some((doc) => doc.id !== id);
      if (!takenByAnother) return baseSlug;
    } catch {
      // Fall through to the always-suffixed slug — never block a publish.
    }
    return `${baseSlug}-${slugSuffix(id)}`;
  }

  async function bumpForgeStats(formatKey) {
    try {
      const doc =
        (await store.readDoc('admin_config', 'forge_stats', ADMIN_CONFIG_PARTITION)) || {};
      const totals = { ...(doc.totals || {}) };
      totals.published = (totals.published || 0) + 1;
      const formats = { ...(doc.formats || {}) };
      formats[formatKey] = { ...(formats[formatKey] || {}) };
      formats[formatKey].published = (formats[formatKey].published || 0) + 1;
      if (doc.id) {
        await store.patchDoc(
          'admin_config',
          'forge_stats',
          { totals, formats },
          { partitionKey: ADMIN_CONFIG_PARTITION }
        );
      } else {
        await store.upsertDoc('admin_config', {
          id: 'forge_stats',
          configScope: ADMIN_CONFIG_PARTITION,
          totals,
          formats,
        });
      }
    } catch {
      // Stats are best-effort; a failed bump must not fail the publish.
    }
  }

  async function processPublishContent(contentId, params) {
    try {
      const contentData = await store.readDoc('content', contentId, contentId);
      if (!contentData) return { error: 'Content not found' };

      const currentStatus = normalizeCurrentStatusForBlogOnly(
        contentData.contentStatus || 'ingested'
      );
      if (!canPublishFromStatus(currentStatus)) {
        return {
          error: `Cannot publish from status '${currentStatus}'. Allowed statuses: ${PUBLISHABLE_NORMALIZED_STATUSES.join(', ')}`,
        };
      }

      const nowIso = now().toISOString();
      const resolvedTarget = normalizePublishTarget(
        params.publishTarget || contentData.publishTarget,
        contentData.type || contentData.contentType
      );
      const contentQuality = buildContentQualityReport(
        contentData,
        contentData.contentQuality?.critique,
        resolvedTarget
      );
      const imageReadiness = buildImageReadinessReport(contentData, resolvedTarget);
      if (!params.forceQualityBypass && !contentQuality.ready) {
        await store.patchDoc('content', contentId, { contentQuality, updatedAt: nowIso });
        return {
          error: `Content quality gate failed: ${contentQuality.issues.join('; ')}`,
          contentQuality,
        };
      }
      if (!params.forceImageBypass && !imageReadiness.ready) {
        await store.patchDoc('content', contentId, {
          imageReadiness,
          imageQuality: imageReadiness,
          updatedAt: nowIso,
        });
        return {
          error: `Image readiness gate failed: ${imageReadiness.issues.join('; ')}`,
          imageReadiness,
        };
      }

      const ctx = resolvePublishContext(contentData, params);
      const isRepublish = currentStatus === 'published';

      const rawTitle = contentData.Title || contentData.title || 'Untitled Article';
      const baseSlug = slugify(rawTitle);
      const existingSlug = contentData.slug || contentData.Slug;
      const slug = isRepublish && existingSlug ? existingSlug : await uniqueSlug(baseSlug, contentId);

      const curatedSubpagePath =
        contentData.curatedSubpagePath ||
        (ctx.resolvedLandingProvider
          ? `/${String(ctx.resolvedLandingProvider).toLowerCase()}/${ctx.curatedSection}/${slug}`
          : null);

      if (!isRepublish) {
        const metadataErrors = validatePublishMetadata({
          contentData,
          publishTarget: ctx.effectivePublishTarget,
          cloudProvider: ctx.inferredProvider,
          slug,
        });
        if (metadataErrors.length > 0) {
          return { error: `Publish metadata validation failed: ${metadataErrors.join('; ')}` };
        }
      }

      const contentUpdate = {};

      // scrapedImages re-hosting deliberately not ported — see module header.
      const refs = Array.isArray(contentData.scrapedImages) ? contentData.scrapedImages : [];
      const needsArchive = refs.length > 0 && refs.some((r) => !r.stored);
      let warning;
      if (needsArchive) {
        warning =
          'scrapedImages not re-hosted (asset-migration phase); published with original refs.';
      }

      applyPublishTimeCoverTrigger(contentUpdate, contentData);

      // Social caption auto-queue (backlog #1): armed once per document, on a
      // LIVE publish only — a republish or an edit-and-republish must not
      // post to social again. The change-feed trigger
      // (lib/triggers/social-caption-trigger.js) decides everything else,
      // including whether autoposting is enabled at all.
      if (params.markLive && !contentData.socialCaptionGeneratedAt) {
        contentUpdate.socialCaptionTrigger = true;
      }

      const persistedIso = ctx.persistedPublishedDate
        ? ctx.persistedPublishedDate.toISOString()
        : null;
      const publishMarker = persistedIso || contentData.publishedAt || nowIso;

      Object.assign(contentUpdate, {
        contentStatus: 'published',
        Live: Boolean(params.markLive),
        publishTarget: ctx.effectivePublishTarget,
        contentQuality,
        imageReadiness,
        imageQuality: imageReadiness,
        slug,
        Slug: slug,
        ...(curatedSubpagePath && {
          curatedSubpagePath,
          slugPageUrl: toPublicUrl(curatedSubpagePath),
          publishedUrl: toPublicUrl(curatedSubpagePath),
          publicUrl: toPublicUrl(curatedSubpagePath),
        }),
        ...(ctx.resolvedLandingProvider && {
          landingProvider: ctx.resolvedLandingProvider,
          targetLandingZone: `/${String(ctx.resolvedLandingProvider).toLowerCase()}/${ctx.curatedSection}`,
        }),
        ...(ctx.inferredProvider && {
          'Cloud Provider': ctx.inferredProvider,
          cloudProvider: ctx.inferredProvider,
        }),
        publishedAt: publishMarker,
        ...(persistedIso && {
          'Published At': persistedIso,
          publishedDate: persistedIso,
          datePublished: persistedIso,
        }),
      });

      // Conditioned on the ETag from the read at the top of this function.
      // Everything above — the status gate, the quality and image reports, the
      // slug — was decided from `contentData`; without the precondition two
      // concurrent runs both pass the gate and both publish, which the
      // scheduled publisher makes reachable rather than theoretical
      // (TODO.md T-301).
      try {
        await store.patchDoc('content', contentId, contentUpdate, { ifMatch: contentData._etag });
      } catch (error) {
        if (error?.code === 412 || error?.statusCode === 412) {
          return { skipped: true, reason: 'Content changed while publishing; not retried' };
        }
        throw error;
      }

      if (contentData.forgeMeta?.formatKey && !isRepublish) {
        await bumpForgeStats(contentData.forgeMeta.formatKey);
      }

      try {
        const snapToSave = { ...contentData, ...contentUpdate };
        await store.upsertDoc('content_versions', {
          id: uuid(),
          contentId,
          title: snapToSave.Title || snapToSave.title || '',
          summary: snapToSave.Summary || snapToSave.summary || '',
          draft:
            snapToSave.blogDraft ||
            snapToSave.content ||
            snapToSave.Content ||
            snapToSave.postContent ||
            '',
          authorName:
            snapToSave.editorAuthor ||
            snapToSave.siteAuthor ||
            snapToSave.publishedByName ||
            snapToSave.createdByName ||
            '',
          tags: snapToSave.Tags || snapToSave.keyTopics || [],
          sidebarContent: snapToSave.sidebarContent || '',
          publishedDate:
            snapToSave.publishedDate || snapToSave.datePublished || snapToSave['Published At'] || '',
          orderedImageUrls: snapToSave.contentImages || snapToSave.orderedImageUrls || [],
          versionCreatedAt: nowIso,
          versionCreatedBy:
            params.user?.email || params.user?.preferred_username || params.user?.oid || 'system',
          versionReason: isRepublish ? 'republished' : 'published',
        });
      } catch {
        // Version history is best-effort, exactly as the source.
      }

      return {
        blogId: contentId,
        reused: isRepublish,
        slug,
        curatedSubpagePath,
        expectedPublicUrl: curatedSubpagePath ? toPublicUrl(curatedSubpagePath) : null,
        sourceUrl: contentData.sourceUrl || contentData.url || contentData['CD Url'] || null,
        landingProvider: ctx.resolvedLandingProvider || null,
        publishTarget: ctx.effectivePublishTarget || null,
        ...(warning && { warning }),
      };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  }

  return {
    /** POST /api/publishContent — publisher; batch of up to 25 ids. */
    async publishContent(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const {
          contentIds = [],
          publishTarget = null,
          markLive = true,
          createSlugPageTrigger = true,
          addToCurated = true,
          cloudProvider = null,
          landingProvider = null,
          forceQualityBypass = false,
          forceImageBypass = false,
        } = body;

        if (!Array.isArray(contentIds) || contentIds.length === 0) {
          return json(400, { error: 'contentIds array required' });
        }
        const normalizedPublishTarget = normalizePublishTarget(publishTarget);

        const results = { published: 0, skipped: 0, errors: [], mappings: [], warnings: [] };
        for (const contentId of contentIds.slice(0, 25)) {
          const r = await processPublishContent(contentId, {
            user,
            publishTarget: normalizedPublishTarget,
            markLive,
            createSlugPageTrigger,
            addToCurated,
            cloudProvider,
            landingProvider,
            forceQualityBypass,
            forceImageBypass,
          });
          accumulatePublishResult(results, contentId, r);
        }

        return json(200, { success: true, ...results });
      } catch (error) {
        context.error('publishContent failed:', error);
        return json(500, { error: 'Failed to publish content', message: error?.message || 'Unknown error' });
      }
    },

    // Not a route. Exposed so the scheduled publisher runs the same pipeline
    // rather than a second implementation of it — the status gate, quality and
    // image gates, slug resolution and version snapshot are the publish
    // semantics, and a timer that reimplemented them would drift
    // (TODO.md T-301).
    processPublishContent,
  };
}
