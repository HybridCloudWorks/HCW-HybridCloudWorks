/**
 * What counts as a published live page, and where it lives.
 *
 * One rule, in one place, because three surfaces have to agree about it: the
 * Live Pages report, the Social Hub's composer and the Linkie Hub's push list
 * all answer "which pages exist" and would be wrong in different ways if they
 * drifted. Until #577 each carried its own copy, with a comment in two of them
 * asserting they matched LivePagesPage — a coupling nothing enforced.
 *
 * ONE DIFFERENCE IS DELIBERATE AND IS NOT RESOLVED HERE. LivePagesPage's URL
 * resolver has a fourth fallback the two hubs never had: when no explicit URL
 * field is set it derives one from `getContentPublicPath(item)`. So a page
 * reachable only that way appears on the Live Pages report and is invisible to
 * the composer and the push list. That is a behaviour question — it changes
 * which pages an operator can post about — and #577 is a tab reorganisation,
 * so the hub rule below is the hub rule as it has always been, and
 * LivePagesPage keeps its own resolver. Whoever decides which is correct
 * should collapse them here.
 */

/** The fields that already carry a whole URL, in the order they are trusted. */
export const LIVE_URL_FIELDS = Object.freeze([
  'slugPageUrl',
  'publishedUrl',
  'blogUrl',
  'publicUrl',
]);

/** A curated path (with or without its leading slash) as an absolute URL. */
export function curatedUrl(path) {
  if (!path) return '';
  const rooted = String(path).startsWith('/') ? path : `/${path}`;
  return `https://hybridcloudworks.com${rooted}`;
}

/**
 * A published live page: content or a blog that is live and not soft-deleted.
 *
 * Soft-deletion is checked first and wins outright — a record can still say
 * `Live` while it is in the delete window, and showing it would offer the
 * operator a page that is about to stop existing.
 */
export function isLiveRecord(item) {
  const status = String(item?.contentStatus || '');
  if (item?.softDeletedAt || item?.softDeleteExpiresAt) return false;
  return item?.Live === true || item?.Status === 'Live' || status.startsWith('published_');
}

/**
 * Where a live page is, for the hubs that post about it.
 *
 * A named field list read with `.find` rather than a chain of `||` feeding a
 * ternary: that chain is the one expression `qlty:boolean-logic` objects to,
 * and it was flagged on the Social Hub's copy in #623 while the Linkie copy
 * carried the identical defect unnoticed. See the header for the fallback
 * LivePagesPage has and this does not.
 */
export function getLiveUrl(item) {
  const explicit = LIVE_URL_FIELDS.map((field) => item[field]).find(Boolean);
  return explicit || curatedUrl(item.curatedSubpagePath) || '';
}
