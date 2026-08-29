/**
 * Gallery image-record RPCs — saveContentImageOrder,
 * updateGalleryImageMetadata, createManualGalleryImageRecord,
 * deleteCuratedGeneratedImage, deleteContentGeneratedImage,
 * deleteRejectedContent.
 *
 * Ported from Site-Main cms-functions.js (:2376-2440, :4967-5330, :7095-7250).
 *
 * Storage adaptation: GCS bucket paths ('covers/x.png') map onto the Azure
 * storage containers Terraform creates with the SAME names as the GCS path
 * prefixes (blogs, covers, certifications, speakerevents, content) — first
 * path segment selects the container, the rest is the blob name.
 * parseStorageRef also reads Azure blob URLs and the two legacy Google URL
 * shapes; a legacy URL whose prefix is a known container maps across, and
 * anything else returns null — the record delete still proceeds and
 * storageDeleted reports false, mirroring the source's ignore-failures
 * posture (and matching reality: pre-migration blobs live in Firebase
 * Storage, with operational secrets and external access tracked in TODO.md.
 *
 * The slot-guard subtlety the source fixed is preserved: `slot` has NO
 * default in validation, so a rename/archive that doesn't mention slot can't
 * silently clear the image's slot tag, while an explicit '' still does.
 */
import { randomUUID } from 'node:crypto';
import { buildContentImageUpdates } from './content-workflow.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const KNOWN_STORAGE_CONTAINERS = new Set([
  'blogs',
  'covers',
  'certifications',
  'speakerevents',
  'content',
]);

/** URL or relative path -> { container, blobName } | null. See header. */
export function parseStorageRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const fromPath = (path) => {
    const clean = String(path || '').replace(/^\/+/, '');
    const slash = clean.indexOf('/');
    if (slash <= 0) return null;
    const container = clean.slice(0, slash);
    const blobName = clean.slice(slash + 1);
    if (!KNOWN_STORAGE_CONTAINERS.has(container) || !blobName) return null;
    return { container, blobName };
  };

  if (!/^https?:\/\//i.test(raw)) return fromPath(raw);

  try {
    const parsed = new URL(raw);
    if (parsed.hostname.endsWith('.blob.core.windows.net')) {
      return fromPath(decodeURIComponent(parsed.pathname));
    }
    if (parsed.hostname === 'storage.googleapis.com') {
      // /{bucket}/{path} — drop the bucket segment.
      const parts = parsed.pathname.replace(/^\/+/, '').split('/');
      return fromPath(decodeURIComponent(parts.slice(1).join('/')));
    }
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const marker = '/o/';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return fromPath(decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)));
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Source :5105 — note the deliberate absence of a `slot` default. */
export function validateGalleryImageMetadataRequest(body) {
  const {
    imageId,
    id,
    galleryCollection = 'generated_content_images',
    provider,
    slot,
    title,
    folder,
    customTags,
    theme,
    style,
    promptSet,
    promptName,
    promptTemplateVersion,
    approvalStatus,
    archived,
  } = body || {};

  const actualImageId = imageId || id;

  if (!actualImageId || typeof actualImageId !== 'string') {
    return { ok: false, status: 400, error: 'imageId or id required' };
  }
  if (!['generated_content_images', 'curated_article_images'].includes(galleryCollection)) {
    return { ok: false, status: 400, error: 'Invalid galleryCollection' };
  }
  return {
    ok: true,
    imageId: actualImageId,
    galleryCollection,
    provider, slot, title, folder, customTags, theme, style,
    promptSet, promptName, promptTemplateVersion, approvalStatus, archived,
  };
}

/** Source :7160 — dotted paths; undefined = patchDoc deletion. */
export function buildContentImageRemovalUpdates(contentData, { slot, imageUrl }) {
  const currentHistory = Array.isArray(contentData.aiImageHistory?.[slot])
    ? contentData.aiImageHistory[slot]
    : [];
  const nextHistory = currentHistory.filter((url) => url !== imageUrl);
  const fallbackUrl = nextHistory[nextHistory.length - 1] || '';
  const updates = {
    [`aiImageHistory.${slot}`]: nextHistory.length > 0 ? nextHistory : undefined,
  };
  if ((contentData.aiImageUrls || {})[slot] === imageUrl) {
    updates[`aiImageUrls.${slot}`] = fallbackUrl || undefined;
  }
  if (slot === 'hero' && contentData.altCoverImage === imageUrl) {
    updates.altCoverImage = fallbackUrl || undefined;
  }
  return updates;
}

const APPROVAL_STATUSES = ['draft', 'approved', 'rejected', 'archived'];

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function, deleteDoc: Function }} deps.store
 * @param {{ deleteBlob: Function }} deps.storage
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createGalleryImageHandlers({
  guard,
  store,
  storage,
  now = () => new Date(),
  uuid = randomUUID,
}) {
  const actor = (user) => user.email || user.preferred_username || user.oid || 'admin';

  async function deleteBlobFor({ imageUrl, storagePath }, context) {
    const ref = parseStorageRef(storagePath) || parseStorageRef(imageUrl);
    if (!ref) return false;
    try {
      await storage.deleteBlob(ref.container, ref.blobName);
      return true;
    } catch (error) {
      context.warn?.('gallery blob delete failed:', ref.container, ref.blobName, error?.message);
      return false;
    }
  }

  return {
    /** POST /api/saveContentImageOrder — source :4967; editor. */
    async saveContentImageOrder(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { contentId, imageUrls = [] } = body;
        if (!contentId || typeof contentId !== 'string') {
          return json(400, { error: 'contentId required' });
        }
        if (!Array.isArray(imageUrls)) {
          return json(400, { error: 'imageUrls array required' });
        }

        const contentData = await store.readDoc('content', contentId, contentId);
        if (!contentData) return json(404, { error: `content ${contentId} not found` });

        const updates = buildContentImageUpdates(imageUrls, contentData);
        await store.patchDoc('content', contentId, {
          heroImageUrl: updates.heroImageUrl || undefined,
          contentImageUrl: updates.contentImageUrl || undefined,
          altCoverImage: updates.altCoverImage || undefined,
          secondaryImageUrls:
            updates.secondaryImageUrls.length > 0 ? updates.secondaryImageUrls : undefined,
          aiImageUrls: updates.aiImageUrls,
          updatedAt: now().toISOString(),
          updatedBy: actor(user),
        });

        return json(200, { success: true, contentId, imageCount: imageUrls.length });
      } catch (error) {
        context.error('saveContentImageOrder failed:', error);
        return json(500, { error: 'Failed to save image order', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/updateGalleryImageMetadata — source :5156; editor; partial. */
    async updateGalleryImageMetadata(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const validated = validateGalleryImageMetadataRequest(body);
        if (!validated.ok) return json(validated.status, { error: validated.error });
        const {
          imageId, galleryCollection, provider, slot, title, folder, customTags,
          theme, style, promptSet, promptName, promptTemplateVersion, approvalStatus, archived,
        } = validated;

        const existing = await store.readDoc(galleryCollection, imageId, imageId);
        if (!existing) return json(404, { error: `${galleryCollection}/${imageId} not found` });

        const updateData = {
          updatedAt: now().toISOString(),
          updatedBy: actor(user),
        };
        if (provider !== undefined && provider !== null) {
          updateData.provider = String(provider || '').trim().toLowerCase();
        }
        if (slot !== undefined) {
          updateData.slot = String(slot || '').trim();
        }
        if (title !== undefined && title !== null) {
          updateData.title = String(title || '').trim() || 'Uploaded image';
        }
        if (folder !== undefined && folder !== null) {
          updateData.folder = String(folder || 'default').trim().toLowerCase();
        }
        if (customTags !== undefined && customTags !== null) {
          updateData.customTags = Array.isArray(customTags)
            ? customTags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
            : [];
        }
        if (theme !== undefined && theme !== null) updateData.theme = String(theme || '').trim();
        if (style !== undefined && style !== null) updateData.style = String(style || '').trim();
        if (promptSet !== undefined && promptSet !== null) updateData.promptSet = String(promptSet || '').trim();
        if (promptName !== undefined && promptName !== null) updateData.promptName = String(promptName || '').trim();
        if (promptTemplateVersion !== undefined && promptTemplateVersion !== null) {
          updateData.promptTemplateVersion = String(promptTemplateVersion || '').trim();
        }
        if (approvalStatus !== undefined && approvalStatus !== null) {
          const normalized = String(approvalStatus || 'draft').trim();
          updateData.approvalStatus = APPROVAL_STATUSES.includes(normalized) ? normalized : 'draft';
        }
        if (archived !== undefined && archived !== null) {
          updateData.archived = archived === true;
        }

        await store.patchDoc(galleryCollection, imageId, updateData);
        return json(200, { success: true, imageId, galleryCollection, ...updateData });
      } catch (error) {
        context.error('updateGalleryImageMetadata failed:', error);
        return json(500, { error: 'Failed to update image metadata', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/createManualGalleryImageRecord — source :5304; editor. */
    async createManualGalleryImageRecord(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        if (!String(body.imageUrl || '').trim()) {
          return json(400, { error: 'imageUrl required' });
        }

        const nowIso = now().toISOString();
        const who = actor(user);
        const customTags = Array.isArray(body.customTags)
          ? body.customTags.filter((tag) => String(tag || '').trim()).map((tag) => String(tag).trim())
          : [];
        const doc = {
          id: uuid(),
          articleId: String(body.articleId || 'manual-upload').trim(),
          contentId: '',
          imageUrl: String(body.imageUrl).trim(),
          provider: String(body.provider || '').trim(),
          title: String(body.title || '').trim() || 'Uploaded image',
          slot: String(body.slot || '').trim(),
          customTags,
          folder: String(body.folder || 'Default').trim(),
          archived: false,
          theme: String(body.theme || '').trim(),
          style: String(body.style || '').trim(),
          promptSet: String(body.promptSet || '').trim(),
          promptName: String(body.promptName || '').trim(),
          promptTemplateVersion: String(body.promptTemplateVersion || '').trim(),
          approvalStatus: String(body.approvalStatus || 'approved').trim(),
          usageCount: 0,
          usedByContentIds: [],
          lastUsedAt: null,
          sourceCollection: 'manual_upload',
          storagePath: String(body.storagePath || '').trim(),
          createdAt: nowIso,
          createdBy: who,
          updatedAt: nowIso,
          updatedBy: who,
        };
        await store.upsertDoc('generated_content_images', doc);
        return json(200, { success: true, imageId: doc.id });
      } catch (error) {
        context.error('createManualGalleryImageRecord failed:', error);
        return json(500, { error: 'Failed to create image record', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/deleteCuratedGeneratedImage — source :7095; editor. */
    async deleteCuratedGeneratedImage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { articleId } = body;
        if (!articleId || typeof articleId !== 'string') {
          return json(400, { error: 'articleId is required' });
        }

        const cacheData = await store.readDoc('curated_article_images', articleId, articleId);
        if (!cacheData) {
          return json(404, { error: `curated_article_images/${articleId} not found` });
        }

        const storageDeleted = await deleteBlobFor(
          { imageUrl: cacheData.imageUrl, storagePath: cacheData.storagePath },
          context
        );
        await store.deleteDoc('curated_article_images', articleId);

        return json(200, { success: true, articleId, storageDeleted });
      } catch (error) {
        context.error('deleteCuratedGeneratedImage failed:', error);
        return json(500, { error: 'Failed to delete curated image', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/deleteContentGeneratedImage — source :7193; editor. */
    async deleteContentGeneratedImage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { imageId } = body;
        if (!imageId || typeof imageId !== 'string') {
          return json(400, { error: 'imageId is required' });
        }

        const imageData = await store.readDoc('generated_content_images', imageId, imageId);
        if (!imageData) {
          return json(404, { error: `generated_content_images/${imageId} not found` });
        }

        const contentId = String(imageData.contentId || imageData.articleId || '').trim();
        const slot = String(imageData.slot || 'hero').trim();
        const imageUrl = String(imageData.imageUrl || '').trim();

        const storageDeleted = await deleteBlobFor(
          { imageUrl, storagePath: imageData.storagePath },
          context
        );

        // Scrub the slot/history references on the owning content doc.
        if (contentId) {
          const contentData = await store.readDoc('content', contentId, contentId);
          if (contentData) {
            const updates = buildContentImageRemovalUpdates(contentData, { slot, imageUrl });
            await store.patchDoc('content', contentId, updates);
          }
        }

        await store.deleteDoc('generated_content_images', imageId);

        return json(200, {
          success: true,
          imageId,
          contentId,
          slot,
          sourceCollection: 'content',
          storageDeleted,
        });
      } catch (error) {
        context.error('deleteContentGeneratedImage failed:', error);
        return json(500, { error: 'Failed to delete generated image', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/deleteRejectedContent — source :2376/:5807; publisher. */
    async deleteRejectedContent(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { olderThanHours = null, limit = 500 } = body;
        const maxLimit = Math.min(Number(limit) || 500, 499);
        const nowDate = now();
        const cutoffMs =
          typeof olderThanHours === 'number' && olderThanHours > 0
            ? nowDate.getTime() - olderThanHours * 60 * 60 * 1000
            : null;

        const rows = await store.queryDocs(
          'content',
          `SELECT TOP ${maxLimit} c.id, c["softDeletedAt"], c["rejectedAt"], c["reviewedAt"], c["updatedAt"] FROM c WHERE c.contentStatus = 'rejected'`,
          []
        );

        const dateOf = (d) => {
          const v = d.rejectedAt || d.reviewedAt || d.updatedAt;
          const parsed = v ? new Date(v) : null;
          return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null;
        };
        const toMark = rows.filter((d) => {
          if (d.softDeletedAt) return false;
          if (cutoffMs === null) return true;
          const ref = dateOf(d);
          return ref !== null && ref < cutoffMs;
        });

        const nowIso = nowDate.toISOString();
        for (const doc of toMark) {
          await store.patchDoc('content', doc.id, {
            softDeletedAt: nowIso,
            softDeletedReason: 'rejected_aged_out',
          });
        }

        if (toMark.length > 0) {
          await store.upsertDoc('admin_audit_logs', {
            id: uuid(),
            action: 'soft_deleted_rejected_content',
            actor: 'admin-rpc',
            userId: auth.user.oid ?? null,
            userEmail: auth.user.email || null,
            timestamp: nowIso,
            details: {
              affectedCount: toMark.length,
              examinedCount: rows.length,
              olderThanHours: typeof olderThanHours === 'number' ? olderThanHours : null,
              affectedIds: toMark.slice(0, 50).map((d) => d.id),
            },
            compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
          });
        }

        return json(200, {
          success: true,
          deletedCount: toMark.length,
          softDeletedCount: toMark.length,
          examinedCount: rows.length,
          hasMore: rows.length === maxLimit,
        });
      } catch (error) {
        context.error('deleteRejectedContent failed:', error);
        return json(500, { error: 'Failed to delete rejected content', message: error?.message || 'Unknown error' });
      }
    },
  };
}
