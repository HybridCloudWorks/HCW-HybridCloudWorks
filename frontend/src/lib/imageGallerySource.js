/**
 * One gallery row as the page and its pickers read it (ADR 0033 Creative
 * slice): the normaliser that turns whatever a collection stored into one
 * shape, and the source id — where the image came from — derived from the
 * legacy collection names when the server did not stamp one.
 *
 * Split from lib/imageGallery.js for PR #841: the listing, folder and bulk
 * calls stay there, and this module holds the per-row shape.
 */

/** Where an image came from — the server's `source` id and the word for it. */
export const SOURCE_LABELS = Object.freeze({
  upload: 'Uploaded',
  'ai-cover': 'AI cover',
  preview: 'Preview',
  curated: 'Curated',
  import: 'Imported',
  rehost: 'Re-hosted',
  other: 'Generated',
});

/**
 * The source id a legacy `sourceCollection` value means. Anything stamped but
 * not listed here is `other`; nothing stamped at all is an AI cover, which is
 * what every row predating the field was.
 */
const SOURCE_BY_COLLECTION = Object.freeze({
  curated_article_images: 'curated',
  manual_upload: 'upload',
  preview: 'preview',
  import: 'import',
  rehost: 'rehost',
  content: 'ai-cover',
  generated_content_images: 'ai-cover',
  blogs: 'ai-cover',
});

export function sourceIdFor(sourceCollection, galleryCollection) {
  if (galleryCollection === 'curated_article_images') return 'curated';
  if (!sourceCollection) return 'ai-cover';
  return SOURCE_BY_COLLECTION[sourceCollection] || 'other';
}

/** The word for a source id, or for a legacy sourceCollection value. */
export function getSourceLabel(sourceOrCollection) {
  const key = String(sourceOrCollection || '');
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  return SOURCE_LABELS[sourceIdFor(key, '')] || 'Generated';
}

const text = (value, fallback = '') => (value ? String(value) : fallback);
const orNull = (value) => value ?? null;

/** The descriptive fields: what the image is and says. */
function describeItem(data, articleId) {
  return {
    title: text(data.title, articleId),
    altText: text(data.altText),
    caption: text(data.caption),
    license: text(data.license),
    credit: text(data.credit),
    provider: text(data.provider),
    slot: text(data.slot),
    folder: text(data.folder, 'default'),
    customTags: Array.isArray(data.customTags) ? data.customTags : [],
    approvalStatus: text(data.approvalStatus),
  };
}

/** Where the image came from: set, prompt, model. */
function lineageOf(data) {
  return {
    promptSet: text(data.promptSet || data.promptSetId),
    promptSetId: text(data.promptSetId || data.promptSet),
    promptName: text(data.promptName),
    promptTemplateVersion: text(data.promptTemplateVersion),
    prompt: text(data.prompt),
    imageProvider: text(data.imageProvider),
    imageModel: text(data.imageModel),
  };
}

/** The bytes and the record's lifecycle stamps. */
function fileFactsOf(data) {
  return {
    width: orNull(data.width),
    height: orNull(data.height),
    bytes: orNull(data.bytes),
    format: text(data.format),
    sha256: text(data.sha256),
    storagePath: text(data.storagePath),
    createdAt: data.createdAt || data.generatedAt || null,
    updatedAt: orNull(data.updatedAt),
    archivedAt: orNull(data.archivedAt),
    softDeletedAt: orNull(data.softDeletedAt),
    createdBy: orNull(data.createdBy),
  };
}

export function normalizeGalleryItem(item, sourceCollection) {
  const data = item || {};
  const articleId = String(data.articleId || data.contentId || data.id || '');
  const normalizedSourceCollection = String(data.sourceCollection || '').trim() || sourceCollection;
  const galleryCollection = data.galleryCollection || sourceCollection;
  return {
    id: data.id,
    articleId,
    contentId: text(data.contentId),
    imageUrl: text(data.imageUrl),
    galleryCollection,
    sourceCollection: normalizedSourceCollection,
    source: data.source || sourceIdFor(normalizedSourceCollection, galleryCollection),
    sourceUrl: orNull(data.sourceUrl),
    ...describeItem(data, articleId),
    ...lineageOf(data),
    ...fileFactsOf(data),
    usedBy: Array.isArray(data.usedBy) ? data.usedBy : [],
    usageCount: Number(data.usageCount) || 0,
    duplicateOf: orNull(data.duplicateOf),
  };
}
