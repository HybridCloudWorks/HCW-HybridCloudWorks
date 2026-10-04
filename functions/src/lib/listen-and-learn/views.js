/**
 * The Audio Library view shapes (ADR 0033 §4): a chapter and a book as the
 * admin reads them, with defaults for every field a pre-library document
 * lacks, and the per-book chapter counts the Library grid shows. Pure, like
 * the parsers in library.js, which re-exports these so callers keep one
 * import. Split out in PR #841.
 */
import { EPISODE_KIND, STATUS, activeVersionOf, episodeKindOf, versionsOf } from './publish.js';
import { voiceSettingsOf } from './speech-settings.js';

/**
 * A chapter as the admin reads it: kind and sources resolved by the one rule,
 * versions always an array with the active one named, and — against its
 * book — whether a guide chapter is still in the current study guide.
 */
export function toChapterView(doc, set = null) {
  const versions = versionsOf(doc);
  const active = activeVersionOf(doc);
  const kind = episodeKindOf(doc);
  const inGuide =
    kind !== EPISODE_KIND.guide ||
    !Array.isArray(set?.areaSlugs) ||
    set.areaSlugs.length === 0 ||
    set.areaSlugs.includes(doc.areaSlug || doc.id);
  return {
    ...doc,
    kind,
    sources: Array.isArray(doc?.sources) ? doc.sources : [],
    versions,
    activeVersionId: active?.id || null,
    versionCount: versions.length,
    droppedFromGuide: !inGuide,
    lastError: doc?.lastError || null,
  };
}

/**
 * A book as the admin reads it, with defaults for every field a pre-library
 * set lacks, and the chapter counts the Library grid shows when they were
 * aggregated for it.
 */
export function toBookView(doc, counts = null) {
  const kind = doc?.kind === 'book' ? 'book' : 'course';
  return {
    ...doc,
    kind,
    title: [doc?.title, doc?.certTitle, doc?.examCode, doc?.id].find(Boolean) || '',
    author: doc?.author ?? null,
    description: doc?.description ?? null,
    coverImageUrl: doc?.coverImageUrl ?? null,
    tags: Array.isArray(doc?.tags) ? doc.tags : [],
    sourceContentIds: Array.isArray(doc?.sourceContentIds) ? doc.sourceContentIds : [],
    archivedAt: doc?.archivedAt ?? null,
    voice: voiceSettingsOf(doc),
    counts: counts || emptyCounts(),
  };
}

const emptyCounts = () => ({
  chapters: 0,
  published: 0,
  drafts: 0,
  failed: 0,
  archived: 0,
  durationSeconds: 0,
});

/** The counter a chapter's status lands in; anything unnamed is a draft. */
const STATUS_BUCKETS = Object.freeze({
  [STATUS.published]: 'published',
  [STATUS.failed]: 'failed',
  [STATUS.archived]: 'archived',
});
const bucketOf = (status) => STATUS_BUCKETS[status] || 'drafts';

/** Whole seconds a listener could hear from this row: none for archived. */
function hearableSeconds(row) {
  const seconds = Number(row.durationSeconds);
  if (row.status === STATUS.archived || !Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.round(seconds));
}

/**
 * Per-book counts from a projection of every chapter row (setId, status,
 * durationSeconds, softDeletedAt). Soft-deleted chapters are not counted;
 * archived ones are counted apart; the duration total is of the live and
 * draft chapters, which is what a listener could hear.
 */
export function summarizeChapters(rows) {
  const bySet = new Map();
  for (const row of rows || []) {
    if (!row?.setId || row.softDeletedAt || row.softDeleteExpiresAt) continue;
    const counts = bySet.get(row.setId) || emptyCounts();
    counts.chapters += 1;
    counts[bucketOf(row.status)] += 1;
    counts.durationSeconds += hearableSeconds(row);
    bySet.set(row.setId, counts);
  }
  return bySet;
}

/** The chapters that stand in the way of a delete without `force`. */
export function publishedChapters(chapters) {
  return (chapters || []).filter(
    (c) => c?.status === STATUS.published && !c.softDeletedAt && !c.softDeleteExpiresAt
  );
}
