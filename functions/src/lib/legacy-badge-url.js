/**
 * legacy-badge-url.js — the certification badges the migration copied but
 * never re-pointed.
 *
 * The Firebase Storage bucket is gone (#518) and the About page already
 * skips any `firebasestorage.googleapis.com` URL rather than render a broken
 * frame (pages/shared/about/certifications.js). What the page could not know
 * is that the blobs themselves were copied into the `certifications`
 * container under the same paths: on 2026-10-05, 20 of the 21 distinct
 * badges the published snapshot still named on Firebase answered 200 from
 * `GET public/media/certifications/<path>` (#868). A fifth of the registry
 * had no badge for want of a string rewrite.
 *
 * This module is that rewrite, pure: a legacy URL in either of Firebase's
 * two shapes becomes the media delivery URL for the same path, or null when
 * the URL is not a legacy badge reference at all. Whether the blob EXISTS is
 * the caller's question (snapshots-publish.js asks blob storage), because a
 * URL that resolves to nothing is exactly the failure this is for.
 *
 *   https://firebasestorage.googleapis.com/v0/b/<bucket>/o/certifications%2F<doc>%2Fimages%2Fbadge.png?alt=media
 *   https://storage.googleapis.com/<bucket>/certifications/<doc>/images/badge.png
 *     → /api/public/media/certifications/<doc>/images/badge.png
 */
import { isValidBlobPath, mediaUrlFor } from './blob-paths.js';

const CONTAINER = 'certifications';

const FIREBASE_OBJECT = /^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/i;
const GCS_OBJECT = /^https?:\/\/storage\.googleapis\.com\/[^/]+\/([^?]+)/i;

/**
 * The blob path inside `certifications` a legacy URL names, or null.
 *
 * @param {unknown} url
 * @returns {string|null} e.g. `74GrtQFAFkhRgYWUTkf8/images/badge-image.png`
 */
export function legacyBadgePath(url) {
  if (typeof url !== 'string') return null;
  const text = url.trim();
  const match = FIREBASE_OBJECT.exec(text) || GCS_OBJECT.exec(text);
  if (!match) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!decoded.startsWith(`${CONTAINER}/`)) return null;
  const path = decoded.slice(CONTAINER.length + 1);
  return isValidBlobPath(path) ? path : null;
}

/** The media delivery URL for a legacy badge URL, or null when it is not one. */
export function repointLegacyBadgeUrl(url) {
  const path = legacyBadgePath(url);
  return path ? mediaUrlFor(CONTAINER, path) : null;
}

/** The first upload object of an `image` field (an array or a single object), or null. */
function firstUpload(value) {
  const upload = Array.isArray(value) ? value[0] : value;
  return upload && typeof upload === 'object' ? upload : null;
}

/** Every legacy badge path a certification document names, deduplicated. */
export function legacyBadgePathsOf(doc) {
  const candidates = [
    doc?.imageUrl,
    doc?.credentialImage,
    doc?.CredentialImage,
    firstUpload(doc?.image)?.downloadURL,
    firstUpload(doc?.image)?.downloadUrl,
  ];
  return [...new Set(candidates.map(legacyBadgePath).filter(Boolean))];
}

/**
 * The document with every legacy badge reference replaced by `mediaUrl`:
 * `imageUrl` (the editor's field, what the page reads first) set, and the
 * legacy fields that carried the old URL rewritten rather than left to
 * contradict it. Pure; returns the same object when nothing changed.
 *
 * @param {object} doc
 * @param {string} path the blob path (confirmed to exist by the caller)
 * @returns {{ doc: object, changes: Record<string, unknown> }}
 */
export function repointCertification(doc, path) {
  const mediaUrl = mediaUrlFor(CONTAINER, path);
  const isTarget = (value) => legacyBadgePath(value) === path;
  const changes = {};
  if (isTarget(doc.imageUrl) || !doc.imageUrl) changes.imageUrl = mediaUrl;
  if (isTarget(doc.credentialImage)) changes.credentialImage = mediaUrl;
  if (isTarget(doc.CredentialImage)) changes.CredentialImage = mediaUrl;
  if (Array.isArray(doc.image)) {
    const [first, ...rest] = doc.image;
    if (first && (isTarget(first.downloadURL) || isTarget(first.downloadUrl))) {
      changes.image = [{ ...first, downloadURL: mediaUrl }, ...rest];
    }
  } else if (doc.image && (isTarget(doc.image.downloadURL) || isTarget(doc.image.downloadUrl))) {
    changes.image = { ...doc.image, downloadURL: mediaUrl };
  }
  return Object.keys(changes).length ? { doc: { ...doc, ...changes }, changes } : { doc, changes };
}
