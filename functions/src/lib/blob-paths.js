/**
 * Blob container allowlists, path validation, and delivery URL construction.
 *
 * Extracted so the upload path (admin-uploads.js) and the delivery path
 * (public-media.js) share one definition without importing each other. They
 * must agree — a path the uploader accepts and the reader rejects produces an
 * image that stores successfully and 404s forever — and the cheapest way to
 * guarantee agreement is a single source rather than a cycle.
 */

const MAX_PATH_LENGTH = 300;
const PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Containers the admin upload route may write to. The same five that
 * gallery-images.js `parseStorageRef` maps legacy GCS paths onto.
 */
export const UPLOAD_CONTAINERS = new Set([
  'certifications',
  'speakerevents',
  'covers',
  'blogs',
  'content',
]);

/**
 * Containers reachable anonymously through the media delivery route.
 *
 * Deliberately NOT the same set as `UPLOAD_CONTAINERS`. `content` holds raw
 * content assets, and `speakerevents` is declared private in Terraform with the
 * comment "event assets served via API" — serving either anonymously would
 * quietly undo that. Adding a container here is a disclosure decision.
 */
export const PUBLIC_MEDIA_CONTAINERS = new Set(['blogs', 'covers', 'certifications']);

/**
 * The blob path is caller-chosen, to preserve the existing naming scheme
 * ({docId}/images/badge-{ts}.png), but validated hard: one character class, no
 * dot-dot, no leading slash — this string becomes part of a URL and a storage
 * key.
 *
 * @param {unknown} path
 * @returns {boolean}
 */
export function isValidBlobPath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    PATH_PATTERN.test(path) &&
    !path.includes('..') &&
    !path.endsWith('/')
  );
}

/**
 * Build the URL for a blob served through the media delivery route.
 *
 * Site-relative on purpose. This value is persisted into Cosmos as `imageUrl`,
 * and the API's hostname is deployment configuration (REVIEW.md §0.1): baking
 * an absolute URL into stored documents means a topology change silently breaks
 * every image already in the database.
 *
 * @param {string} container
 * @param {string} blobPath
 * @returns {string} e.g. `/api/public/media/covers/post-1/cover.png`
 */
export function mediaUrlFor(container, blobPath) {
  const encoded = String(blobPath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/public/media/${encodeURIComponent(container)}/${encoded}`;
}
