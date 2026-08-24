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
 *
 * Every entry must also appear in UPLOAD_CONTAINERS or in
 * GENERATED_MEDIA_CONTAINERS below, so that each publicly readable container
 * has exactly one declared writer. `listenandlearn` is the generated one.
 */
export const PUBLIC_MEDIA_CONTAINERS = new Set([
  'blogs',
  'covers',
  'certifications',
  'listenandlearn',
]);

/**
 * Containers written by a server-side job rather than by a person.
 *
 * `listenandlearn` holds Listen & Learn episode audio, written by the
 * `generate-listen-and-learn` job through `uploadBlob` with a path it derives
 * itself (`{provider}/{examCode}/{areaSlug}.mp3`). Nothing else writes there.
 *
 * This set exists so the separation is checkable rather than incidental. It is
 * deliberately DISJOINT from UPLOAD_CONTAINERS, and blob-paths.test.js asserts
 * that: a container that is both publicly readable and reachable from the
 * admin upload route lets any editor put an arbitrary file behind an anonymous
 * URL, which is exactly what a generated-media container must not allow.
 *
 * Until this existed, `PUBLIC_MEDIA_CONTAINERS ⊂ UPLOAD_CONTAINERS` held by
 * accident — every public container happened to be one people upload to. That
 * was a description of the world, not a control, and satisfying it here would
 * have meant opening the episode container to the upload route.
 */
export const GENERATED_MEDIA_CONTAINERS = new Set(['listenandlearn']);

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
