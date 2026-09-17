/**
 * Stage 3's image machinery: upload, generate, remove, resolve.
 *
 * Module-level functions over a state bag — the shape linkWrites.js
 * established and that #632 already brought to this page for the slot upload.
 * The page holds the state; these act on it. That is what lets them be
 * exercised directly instead of by mounting a 2,900-line component, which is
 * the whole point of #634: this cluster shipped broken twice (#630, #631) and
 * eight tests over a 1,088-line body caught neither.
 *
 * Behaviour here is deliberately identical to the inline handlers it replaces.
 * A change in what Stage 3 DOES does not belong in this commit.
 */
import { postJSON } from '@/lib/api';
import {
  PUBLIC_IMAGE_EXTENSIONS,
  imageExtensionFor,
  publicImageFileProblem,
  uploadImageFile,
} from '@/lib/imageUpload';

/**
 * `covers`, not `content` (#630).
 *
 * Every container is private in Terraform; "public" means reachable through
 * the media delivery route, and only the containers in PUBLIC_MEDIA_CONTAINERS
 * are. `content` is not one, so the upload route returned url:'' BY DESIGN —
 * and an empty string is falsy, so `{slotUrls[key] && …}` never rendered the
 * uploaded row. The operator pressed Upload, the spinner finished, and nothing
 * appeared: no error, no link, no confirmation. Downstream,
 * collectSelectedSlotImages drops the slot on `.filter(Boolean(item.url))`, so
 * `canPreview` and the article's hero were computed as though no image had
 * been uploaded at all.
 *
 * `covers` is what Terraform calls "content cover images, served via the media
 * route", which is exactly what a slot image is. Nothing already in `content`
 * becomes reachable; only what is uploaded here from now on.
 */
export const SLOT_IMAGE_CONTAINER = 'covers';

/**
 * What the picker offers, derived from what the route will accept.
 *
 * SVG was offered before, and `admin-uploads.js` records why: it was safe
 * while these went to a private container. It is refused in a publicly served
 * one, because served anonymously an SVG is a scriptable document. Nothing is
 * lost by dropping it here — an SVG slot upload produced url:'' like every
 * other type, so it never worked either. GIF and AVIF are newly offered.
 */
export const SLOT_IMAGE_ACCEPT = Object.keys(PUBLIC_IMAGE_EXTENSIONS).join(',');

/**
 * Upload one slot image. Module-level over a state bag, as linkWrites.js is.
 *
 * The empty-URL guard is not a precaution: it is the defect above, and the
 * generated-image path below has carried the equivalent check all along —
 * which is why AI generation worked while manual upload silently did not.
 */
export async function uploadSlotImageFile(state, slot, explicitFile) {
  // The picker hands the file straight over; the button falls back to whatever
  // is queued for the slot. Resolved here rather than at the call site so the
  // page component does not carry the branch.
  const file = explicitFile || state.slotFiles?.[slot];
  if (!file) return;
  // `covers` is publicly served, so the route refuses SVG and anything outside
  // the five raster types. Naming the problem here beats a 415 that does not.
  const problem = publicImageFileProblem(file);
  if (problem) {
    state.setError(problem);
    return;
  }
  state.setUploadingSlot(slot);
  state.setError('');
  try {
    // The extension comes from the DECLARED TYPE, not the filename: the route
    // requires the two to agree, so `photo.jfif` would otherwise be a 415 (#631).
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `content-submissions/${slot}/${stamp}.${imageExtensionFor(file)}`;
    const uploaded = await uploadImageFile({ container: SLOT_IMAGE_CONTAINER, path, file });
    if (!uploaded.url) {
      throw new Error(
        `Upload succeeded but returned no public URL (container '${SLOT_IMAGE_CONTAINER}').`
      );
    }
    state.setSlotUrls((prev) => ({ ...prev, [slot]: uploaded.url }));
    state.setSelectedUploaded((prev) => ({ ...prev, [slot]: true }));
    state.setSlotFiles((prev) => ({ ...prev, [slot]: null }));
  } catch (err) {
    state.setError(err.message || 'Failed to upload image.');
  } finally {
    state.setUploadingSlot('');
  }
}

/**
 * The request body for one slot's generation.
 *
 * Pure and exported so the payload can be asserted without a network stub —
 * `sourceUrl` in particular prefers the first KB article URL and only falls
 * back to the trimmed single URL, which is easy to get backwards and was not
 * pinned by anything before.
 */
export function generationRequestFor(state, slot) {
  return {
    summaryPrompt: state.summaryPrompt,
    detailsPrompt: state.detailsPrompt,
    slotTemplates: state.selectedSlotTemplates,
    aiImageTargets: [slot],
    title: state.draftTitle,
    summary: state.draftSummary,
    provider: state.resolvedProvider,
    contentType: state.contentType,
    sourceUrl: state.kbArticleUrls[0] || state.sourceUrl.trim(),
    articleId: state.previewSessionId,
  };
}

/**
 * One slot's parts out of a generation response, or a throw naming the slot.
 *
 * The empty-URL throw is the check the manual upload path lacked until #630.
 * It stays a throw rather than a silent skip because a slot that generated
 * nothing must not be marked selected.
 */
export function readGeneratedSlot(response, slot) {
  const imageUrl = response?.imageUrls?.[slot] || '';
  if (!imageUrl) {
    throw new Error(`No image URL was returned for ${slot}.`);
  }
  return {
    imageUrl,
    imageId: response?.imageRecords?.[slot]?.imageId || '',
    promptLog: response?.promptLogs?.[slot] || null,
  };
}

/** Commit one generated slot to state. A missing prompt log is not stored. */
function storeGeneratedSlot(state, slot, { imageUrl, imageId, promptLog }) {
  state.setGeneratedImages((prev) => ({ ...prev, [slot]: imageUrl }));
  state.setGeneratedImageIds((prev) => ({ ...prev, [slot]: imageId }));
  if (promptLog) {
    state.setGenerationPromptLogs((prev) => ({ ...prev, [slot]: promptLog }));
  }
  state.setSelectedGenerated((prev) => ({ ...prev, [slot]: true }));
}

/**
 * Generate every selected slot, one request per slot, in order.
 *
 * Sequential rather than concurrent on purpose: the status line names the slot
 * being worked and counts through the total, which only reads correctly with
 * one in flight at a time. A slot that throws abandons the rest — the ones
 * already stored keep their images, which is why the count below is taken from
 * what was collected rather than from what was requested.
 */
export async function generateSlotImages(state) {
  if (!state.canGenerateImages) return;
  const targets = state.selectedAiTargets;
  state.setGeneratingImages(true);
  state.setError('');
  state.setGenerationError('');
  state.setGenerationStatus('');
  try {
    const collectedUrls = {};
    for (let index = 0; index < targets.length; index += 1) {
      const slot = targets[index];
      state.setGenerationStatus(`Generating ${slot} image (${index + 1} of ${targets.length})...`);
      const response = await postJSON('generatePreviewImages', generationRequestFor(state, slot));
      const parts = readGeneratedSlot(response, slot);
      collectedUrls[slot] = parts.imageUrl;
      storeGeneratedSlot(state, slot, parts);
      state.setGenerationStatus(`Generated ${slot} image (${index + 1} of ${targets.length}).`);
    }
    state.setResult({
      stage: 3,
      message: `Generated ${Object.keys(collectedUrls).length} image slot(s). Review and select the ones to include.`,
    });
  } catch (err) {
    const message = err.message || 'Failed to generate images.';
    state.setGenerationError(message);
    state.setError(message);
  } finally {
    state.setGenerationStatus('');
    state.setGeneratingImages(false);
  }
}

/** Forget one slot's generated image locally. Deletes nothing server-side. */
export function clearGeneratedImageState(state, slot) {
  state.setGeneratedImages((prev) => ({ ...prev, [slot]: '' }));
  state.setGeneratedImageIds((prev) => ({ ...prev, [slot]: '' }));
  state.setSelectedGenerated((prev) => ({ ...prev, [slot]: false }));
  state.setGenerationPromptLogs((prev) => {
    const next = { ...prev };
    delete next[slot];
    return next;
  });
}

/**
 * Delete one generated slot image, server-side first.
 *
 * The early return in the catch is load-bearing: if the delete failed the
 * image still exists, so clearing it locally would leave the operator looking
 * at an empty slot backed by a live blob with no way to reach it again.
 */
export async function removeGeneratedImage(state, slot) {
  const imageId = state.generatedImageIds[slot];

  try {
    if (imageId) {
      await postJSON('deleteContentGeneratedImage', { imageId });
    }
  } catch (err) {
    state.setError(err.message || `Failed to delete generated ${slot} image.`);
    return;
  }

  clearGeneratedImageState(state, slot);
  state.setGalleryItems((prev) => prev.filter((item) => item.id !== imageId));
}

/**
 * Delete one saved gallery image.
 *
 * If that image is also the one currently held for its slot, the slot is
 * cleared too — otherwise Stage 4 would carry a hero URL pointing at a blob
 * that no longer exists.
 */
export async function deleteGalleryItem(state, item) {
  if (!item?.id) return;

  try {
    await postJSON('deleteContentGeneratedImage', { imageId: item.id });
    state.setGalleryItems((prev) => prev.filter((entry) => entry.id !== item.id));
    if (item.slot && state.generatedImageIds[item.slot] === item.id) {
      clearGeneratedImageState(state, item.slot);
    }
  } catch (err) {
    state.setError(err.message || 'Failed to delete saved gallery image.');
  }
}

/**
 * Which image a slot contributes downstream: uploaded wins over generated.
 *
 * Both halves require the slot to be SELECTED as well as present, which is why
 * this cannot be simplified to `slotUrls[slot] || generatedImages[slot]`.
 */
export function resolveSlotImage(state, slot) {
  if (state.slotUrls[slot] && state.selectedUploaded[slot]) return state.slotUrls[slot];
  if (state.selectedGenerated[slot] && state.generatedImages[slot])
    return state.generatedImages[slot];
  return '';
}
