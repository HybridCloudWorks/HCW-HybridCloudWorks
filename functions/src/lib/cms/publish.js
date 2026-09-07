/**
 * The publish pipeline — publishContent (batch, up to 25 ids) and its
 * single-item core processPublishContent, ported from Site-Main
 * cms-functions.js (:111-160, :218-360, :1337-1600, :6657-6745).
 *
 * Sequence per item, exactly as the source: publishable-status check (the one
 * canPublishFromStatus table) → quality gate → image gate (each persisting
 * its failed report onto the doc) → slug resolution (see resolveSlug) →
 * metadata validation (new publishes only) → cover trigger → the publish
 * write → forge format stats → version snapshot.
 *
 * Adaptations, each deliberate:
 *   - The scrapedImages re-hosting step (`_internal_archiveScrapedImageRefs`)
 *     is NOT ported: it re-uploads scraped assets between Firebase Storage
 *     paths, which belongs to the asset-migration phase. When refs need
 *     archiving the item still publishes and a warning is surfaced in the
 *     batch results, so nothing silently changes.
 *   - Inline body images ARE re-hosted, since 2026-09-06 (issue #374): every
 *     external `<img>` / `![](…)` URL in any body field is fetched
 *     through the guarded fetcher, stored under the article id in the public
 *     `covers` container and rewritten to the site's media path. A URL that
 *     fails is left in place and counted in the `inlineImages` summary the
 *     completed step writes; if the step itself throws, it is logged and the
 *     article publishes untouched with no summary. Nothing here can fail a
 *     publish. See ./inline-images.js. Injected as `inlineImages`; absent,
 *     nothing runs.
 *   - `params.reason === REHOST_IMAGES_REASON` (the #374 backfill, from
 *     POST cms/content/rehost-images) is a republish that touches NOTHING but
 *     the body fields and their `inlineImages` summary. A full republish of a
 *     live article would also re-run the gates, re-arm the cover trigger on an
 *     article without one, re-arm the social-caption trigger on one that never
 *     posted, rewrite Live from the caller's markLive, and re-stamp the
 *     publish dates and URLs — none of which sixteen articles need for their
 *     images to stop hotlinking. The branch shares the read, the status table,
 *     the ETag precondition and the version snapshot, and nothing else.
 *   - bumpForgeStats' FieldValue.increment becomes read-modify-patch on the
 *     whole totals/formats objects — formatKey is user-influenced text, and
 *     writing whole objects avoids dotted-path escaping entirely.
 *   - Timestamps/publish markers are ISO strings (the migrated shape).
 *   - The source's uniqueSlug becomes pure `resolveSlug` plus the
 *     `slugHolders` probe (issue #400). Same shape — keep the bare slug when
 *     the probe finds no other holder, suffix with the document id otherwise,
 *     and never let a lookup failure block a publish — with the two gaps that
 *     put three articles on one URL closed: the probe now reads `c.Slug` as
 *     well as `c.slug`, and a republish runs it instead of reusing its stored
 *     slug unexamined. The residual a read cannot close is documented at
 *     resolveSlug.
 */
import { randomUUID } from 'node:crypto';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { buildContentQualityReport, buildImageReadinessReport } from './content-quality.js';
import { normalizePublishTarget, SUPPORTED_PUBLISH_TARGETS } from './publish-targets.js';
import { buildInlineImageUpdate, findInlineImageUrls, resolveBodyFields } from './inline-images.js';
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

/**
 * `params.reason` value that turns processPublishContent into the narrow
 * re-host-only republish described in the module header. A string rather than
 * a boolean so a future narrow republish (a related-posts refresh, say) is a
 * second named reason and not a second flag that interacts with this one.
 */
export const REHOST_IMAGES_REASON = 'rehost-images';

export function slugify(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

const slugSuffix = (id = '') => (id ? String(id).slice(0, 6) : Date.now().toString(36).slice(-6));

/**
 * The slug a publish writes. Pure: the caller runs the probe, this decides.
 *
 * WHAT WENT WRONG (issue #400). Three published articles share one slug, so
 * two of them have no URL. None of the three was assigned that slug here: they
 * arrived from Site-Main already `contentStatus: published`, and the branch
 * that reuses a stored slug never probed at all. Two things follow, and both
 * are the rules below:
 *
 *   - EVERY publish probes, republishes included. Keeping the URL an article
 *     already serves is right; keeping one another document holds is not.
 *   - The probe reads `c.slug` AND `c.Slug`. They are two fields with two
 *     different values on ten of the twenty-two published articles, and the
 *     manifest routes on `slug || Slug` (scripts/build-content-manifest.mjs),
 *     so a document whose site slug lives in `Slug` alone holds a URL that
 *     `c.slug` on its own cannot see.
 *
 * WHAT THIS STILL DOES NOT PROVE, said plainly. A clean probe is a read, and a
 * read cannot establish that a slug is free at the moment of the write. Three
 * callers publish independently — the batch route, the scheduled publisher
 * (lib/scheduled-publish.js) and the Telegram approve worker
 * (functions/publish-jobs.js) — so two first publishes of two documents whose
 * titles slugify alike can both probe clean and both write the bare slug. That
 * residual is deliberate and it is bounded: the manifest build refuses to route
 * the duplicate (#386), so one article is temporarily unreachable rather than
 * two articles being served at one URL, and `scripts/report-slug-collisions.mjs`
 * names it from a checkout. Renaming one article in the CMS recovers it.
 * Suffixing every slug instead would close that window and cost every future
 * URL its readable form — and once articles are indexed at suffixed URLs, going
 * back breaks links, which is the harm that does not recover. If that trade is
 * ever wanted, it is one line here: return the suffixed slug unconditionally
 * when `reuse` is false.
 *
 * `holders` is what the probe found, or `null` when it could not answer. The
 * two paths read `null` differently, on purpose:
 *
 *   - a FIRST assignment treats it as "not established" and takes the
 *     always-suffixed slug — ugly but always unique, and the publish is never
 *     blocked by a lookup failure (the source's rule, kept);
 *   - a REPUBLISH keeps the URL the article already serves, because a failed
 *     lookup is not evidence of a clash and inventing a new URL out of one
 *     would break every inbound link to an article that was fine.
 *
 * @param {object} args
 * @param {string} args.candidate slugify(title) on a first publish, the stored slug on a republish
 * @param {string} args.contentId
 * @param {boolean} [args.reuse] true when the candidate is the slug this document already serves
 * @param {string[]|null} [args.holders] ids holding the candidate, or null when not established
 */
export function resolveSlug({ candidate = '', contentId = '', reuse = false, holders = null }) {
  // A guard for direct callers, NOT what keeps the read and the write about
  // one string — processPublishContent normalises before it probes, because a
  // trim here alone would leave the probe asking about a different value than
  // the one written. Keep the two in step if either moves.
  const base = String(candidate || '').trim();
  if (!base) return slugSuffix(contentId);
  const heldByAnother = Array.isArray(holders) && holders.some((id) => id && id !== contentId);
  if (heldByAnother) return `${base}-${slugSuffix(contentId)}`;
  if (!reuse && !Array.isArray(holders)) return `${base}-${slugSuffix(contentId)}`;
  return base;
}

/**
 * The curated path a publish writes, and with it `slugPageUrl`,
 * `publishedUrl` and `publicUrl`.
 *
 * The stored path wins, because it is the URL the article already serves and a
 * hand-curated one has to survive a republish — but only while it still names
 * the slug being written. When a republish moves off a slug another document
 * holds (resolveSlug), a stored path taken unconditionally would keep
 * advertising the contested URL while `slug` said otherwise: the article would
 * move and its own links would not, which is the bug wearing a different hat.
 * Found by Copilot's review of #403 on the first revision of this change.
 *
 * The LAST SEGMENT is replaced rather than the whole path rebuilt, so a curated
 * path sitting under some other prefix keeps that prefix. With neither a stored
 * path nor a provider to derive one from there is no path at all, exactly as
 * before.
 *
 * ALWAYS ABSOLUTE. Three frontend hooks infer an article's provider with
 * `String(doc.curatedSubpagePath || '').split('/')[1]` — useBlogData.js,
 * useFrameworkData.js and useProviderLandingContent.js — and that index is the
 * provider only when the path starts with a slash. On a relative `aws/x` it
 * reads the SECOND segment instead and the article lands under the wrong
 * provider, silently. So every path returned here is normalised, not only the
 * one whose last segment was replaced: a stored relative path echoed back
 * unchanged mis-infers exactly the same way.
 */
export function resolveCuratedSubpagePath({
  stored = '',
  provider = '',
  section = '',
  slug = '',
} = {}) {
  const raw = String(stored || '').replace(/\/+$/, '');
  if (!raw) {
    return provider && slug ? `/${String(provider).toLowerCase()}/${section}/${slug}` : null;
  }
  const segments = (raw.startsWith('/') ? raw : `/${raw}`).split('/');
  if (!slug || segments[segments.length - 1] === slug) return segments.join('/');
  segments[segments.length - 1] = slug;
  return segments.join('/');
}

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
export function createPublishHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = randomUUID,
  inlineImages = null,
  log = console,
}) {
  /**
   * The ids of every document holding `slug` in EITHER field, or null when the
   * probe could not answer. Run on every publish — a republish included, which
   * is the one that was missing (#400).
   *
   * BOTH FIELDS. Cosmos property lookup is case-sensitive, so `c.slug` alone
   * cannot see a document whose site slug is in `Slug` — and the manifest
   * routes on `slug || Slug` (scripts/build-content-manifest.mjs), so such a
   * document does hold the URL.
   *
   * TOP 2 is enough: at most one of the rows can be this document, so two rows
   * are enough to establish that somebody else holds it.
   *
   * Never throws. A lookup failure returns null, which resolveSlug reads as
   * "not established" — see there for what each path does with that.
   */
  async function slugHolders(slug) {
    try {
      const rows = await store.queryDocs(
        'content',
        'SELECT TOP 2 c.id FROM c WHERE c.slug = @slug OR c.Slug = @slug',
        [{ name: '@slug', value: slug }]
      );
      return (Array.isArray(rows) ? rows : []).map((row) => row?.id).filter(Boolean);
    } catch {
      return null;
    }
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

  /** Version history is best-effort, exactly as the source: a failed row never fails the write it records. */
  async function snapshotVersion(contentId, snapToSave, nowIso, params, versionReason) {
    try {
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
        versionReason,
      });
    } catch {
      // Best-effort, see above.
    }
  }

  /**
   * The re-host-only republish (module header, REHOST_IMAGES_REASON). Reached
   * from processPublishContent once the document is read and its status has
   * passed the one publishable table; from here on only a document that is
   * already published is accepted, because on anything else "re-host" would
   * be a first publish wearing a smaller name.
   *
   * The patch carries the rewritten body field(s), the `inlineImages` summary
   * and `updatedAt` — never contentStatus, Live, the slug, the URLs, the
   * dates, the quality reports or either trigger. Conditioned on the ETag
   * like the publish write; a lost race is a skip, not a retry.
   */
  async function rehostInlineImages(contentId, contentData, currentStatus, nowIso, params) {
    if (currentStatus !== 'published') {
      return { error: `Only a published document can be re-hosted; status is '${currentStatus}'` };
    }
    if (typeof inlineImages !== 'function') {
      return { error: 'Inline image re-hosting is not configured on this deployment' };
    }
    const hasExternal = resolveBodyFields(contentData).some(
      (field) => findInlineImageUrls(contentData[field]).length > 0
    );
    if (!hasExternal) {
      return { skipped: true, reason: 'No third-party image URLs in the body fields' };
    }

    const update = await buildInlineImageUpdate({
      contentData,
      contentId,
      rehost: inlineImages,
      nowIso,
      log,
    });
    // Null here cannot mean "nothing to do" (checked above); it means the
    // rehoster threw whole and the step logged it. Say so instead of
    // reporting a re-host that did not happen.
    if (!update) {
      return { error: 'Re-hosting failed before any image was stored; see the function log' };
    }

    const contentUpdate = { ...update, updatedAt: nowIso };
    try {
      await store.patchDoc('content', contentId, contentUpdate, { ifMatch: contentData._etag });
    } catch (error) {
      if (error?.code === 412 || error?.statusCode === 412) {
        return { skipped: true, reason: 'Content changed while re-hosting; not retried' };
      }
      throw error;
    }

    await snapshotVersion(
      contentId,
      { ...contentData, ...contentUpdate },
      nowIso,
      params,
      REHOST_IMAGES_REASON
    );

    const slug = contentData.slug || contentData.Slug || null;
    return {
      blogId: contentId,
      reused: true,
      rehosted: true,
      slug,
      curatedSubpagePath: contentData.curatedSubpagePath || null,
      expectedPublicUrl: publicUrlOf(contentData) || null,
      sourceUrl: contentData.sourceUrl || contentData.url || contentData['CD Url'] || null,
      landingProvider: contentData.landingProvider || null,
      publishTarget: normalizePublishTarget(contentData.publishTarget, contentData.type) || null,
      inlineImages: update.inlineImages,
    };
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
      if (params.reason === REHOST_IMAGES_REASON) {
        return await rehostInlineImages(contentId, contentData, currentStatus, nowIso, params);
      }

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
      const existingSlug = contentData.slug || contentData.Slug;
      // A republish keeps the URL it already serves; anything else is a first
      // assignment. `slug || Slug` because either field can be the one the
      // manifest routed on — see slugHolders.
      const reuse = Boolean(isRepublish && existingSlug);
      // NORMALISED ONCE, HERE, because the probe and the write have to be about
      // the same string. `slugify` already trims, but a STORED slug need not —
      // this corpus is migrated and hand-edited, which is the corpus that
      // produced #400. A `'  shared-slug  '` probed untrimmed matches no holder,
      // and resolveSlug (which trims) then writes `shared-slug` onto a URL
      // another article already holds: the read says free, the write says
      // taken, and nothing in between notices.
      const candidate = String((reuse ? existingSlug : slugify(rawTitle)) || '').trim();
      // Probed on EVERY publish, to answer one question: does another document
      // already hold this URL? Three did (#400), and the branch that reused a
      // stored slug never asked.
      const slug = resolveSlug({
        candidate,
        contentId,
        reuse,
        holders: await slugHolders(candidate),
      });

      const curatedSubpagePath = resolveCuratedSubpagePath({
        stored: contentData.curatedSubpagePath,
        provider: ctx.resolvedLandingProvider,
        section: ctx.curatedSection,
        slug,
      });

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

      // Inline body images (issue #374). Runs after the gates, so it never
      // spends a fetch on an article that will not publish, and before the
      // write, so the rewritten body and its summary land in the same patch
      // as the status change. Best-effort by construction: a failed image is
      // left as it was and named on the document.
      const inlineImageUpdate = await buildInlineImageUpdate({
        contentData,
        contentId,
        rehost: inlineImages,
        nowIso,
        log,
      });
      if (inlineImageUpdate) Object.assign(contentUpdate, inlineImageUpdate);

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

      await snapshotVersion(
        contentId,
        { ...contentData, ...contentUpdate },
        nowIso,
        params,
        isRepublish ? 'republished' : 'published'
      );

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
        return json(500, {
          error: 'Failed to publish content',
          message: error?.message || 'Unknown error',
        });
      }
    },

    // Not a route. Exposed so the scheduled publisher (TODO.md T-301) and the
    // re-host route (lib/cms/rehost-images.js) run the same pipeline rather
    // than a second implementation of it — the status gate, quality and image
    // gates, slug resolution and version snapshot are the publish semantics,
    // and a caller that reimplemented them would drift.
    processPublishContent,
  };
}
