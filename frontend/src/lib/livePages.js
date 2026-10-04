/**
 * What counts as a published live page, and where it lives.
 *
 * One rule, in one place, because three surfaces have to agree about it: the
 * Live Pages report, the Social Hub's composer and the Linkie Hub's push list
 * all answer "which pages exist" and would be wrong in different ways if they
 * drifted. Until #577 each carried its own copy, with a comment in two of them
 * asserting they matched LivePagesPage — a coupling nothing enforced.
 *
 * THE FOURTH FALLBACK IS NOW HERE (ADR 0033 §2, "two getLiveUrl"). Until
 * 2026-10-03 LivePagesPage kept its own resolver with one more step than the
 * hubs had: when no explicit URL field is set, derive the URL from the
 * record's provider and slug (`getContentPublicPath`). A page reachable only
 * that way appeared on the Live Pages report and was invisible to the
 * composer and the push list. Decided for the fallback: a live record with a
 * provider and a slug IS served at that path (the site's blog, framework,
 * architecture and code routes are built from exactly those two fields), so
 * a hub that could not see it was missing a real page. The page copy is gone.
 */
import { getContentPublicPath } from './contentModel.js';

/** The fields that already carry a whole URL, in the order they are trusted. */
export const LIVE_URL_FIELDS = Object.freeze([
  'slugPageUrl',
  'publishedUrl',
  'blogUrl',
  'publicUrl',
]);

export const SITE_ORIGIN = 'https://hybridcloudworks.com';

/** A curated path (with or without its leading slash) as an absolute URL. */
export function curatedUrl(path) {
  if (!path) return '';
  const rooted = String(path).startsWith('/') ? path : `/${path}`;
  return `${SITE_ORIGIN}${rooted}`;
}

/**
 * A published live page: content or a blog that is live and not soft-deleted.
 *
 * Soft-deletion is checked first and wins outright — a record can still say
 * `Live` while it is in the delete window, and showing it would offer the
 * operator a page that is about to stop existing.
 *
 * Three spellings say "live": the `Live` flag (the real public gate), the
 * legacy `Status: 'Live'`, and a Firestore-era `published_*` status. The
 * canonical `published` status on its own is NOT live — publishing stages an
 * item as `published` with `Live: false` until it goes out — so it counts
 * only together with the flag, which the first test already covers.
 */
export function isLiveRecord(item) {
  const status = String(item?.contentStatus || '');
  if (item?.softDeletedAt || item?.softDeleteExpiresAt) return false;
  return item?.Live === true || item?.Status === 'Live' || status.startsWith('published_');
}

/**
 * Where a live page is, for every surface that lists them.
 *
 * A named field list read with `.find` rather than a chain of `||` feeding a
 * ternary: that chain is the one expression `qlty:boolean-logic` objects to,
 * and it was flagged on the Social Hub's copy in #623 while the Linkie copy
 * carried the identical defect unnoticed. Then the curated path, then the
 * path the record's provider and slug imply (see the header).
 */
export function getLiveUrl(item) {
  if (!item) return '';
  const explicit = LIVE_URL_FIELDS.map((field) => item[field]).find(Boolean);
  if (explicit) return explicit;
  const curated = curatedUrl(item.curatedSubpagePath);
  if (curated) return curated;
  const derived = getContentPublicPath(item);
  return derived ? `${SITE_ORIGIN}${derived}` : '';
}
