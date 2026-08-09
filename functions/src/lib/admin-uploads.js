/**
 * Admin file uploads — the replacement for the browser's direct
 * firebase/storage uploadBytes calls (CertificationsPage badge images today;
 * the gallery and cover flows migrate onto the same route later).
 *
 * The browser sends base64 JSON instead of raw bytes: payloads here are small
 * images (the pages already enforce a 5 MB picker limit), and a JSON body
 * rides through authedFetch and the role guard unchanged. The server re-checks
 * the size after decoding — the client-side cap is UX, not enforcement.
 *
 * Containers are allowlisted to the five content stores (the same set
 * gallery-images.js parseStorageRef maps GCS paths onto). The blob path is
 * caller-chosen to preserve the existing naming scheme
 * ({docId}/images/badge-{ts}.png) but validated hard: one character class,
 * no dot-dot, no leading slash — this string becomes part of a URL and a
 * storage key.
 */

import {
  isValidBlobPath,
  mediaUrlFor,
  PUBLIC_MEDIA_CONTAINERS,
  UPLOAD_CONTAINERS,
} from './blob-paths.js';

// Re-exported: these moved to blob-paths.js so the delivery route could share
// them without a cycle, and call sites and tests still import them from here.
export { isValidBlobPath, UPLOAD_CONTAINERS };

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// 15 MB: gallery hero/cover images run larger than cert badges, and the
// gallery pages never had a client-side cap under Firebase Storage.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ uploadBlob: Function }} deps.storage - uploadBlob(container, blobName, content, contentType) → public URL
 */
export function createAdminUploadHandlers({ guard, storage }) {
  return {
    /** POST /api/cms/uploads/{container} — {path, contentType, dataBase64} → {url} */
    async uploadFile(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      const container = String(request.params.container || '').trim();
      if (!UPLOAD_CONTAINERS.has(container)) {
        return json(404, { error: 'Unknown container' });
      }

      try {
        const body = await request.json().catch(() => null);
        const path = String(body?.path || '').trim();
        const contentType = String(body?.contentType || 'application/octet-stream').trim();
        const dataBase64 = String(body?.dataBase64 || '');

        if (!isValidBlobPath(path)) {
          return json(400, { error: 'Invalid path' });
        }
        if (!dataBase64) {
          return json(400, { error: 'dataBase64 is required' });
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        if (buffer.length === 0) {
          return json(400, { error: 'dataBase64 is not valid base64' });
        }
        if (buffer.length > MAX_UPLOAD_BYTES) {
          return json(413, { error: 'File exceeds the 15MB upload limit' });
        }

        const blobUrl = await storage.uploadBlob(container, path, buffer, contentType);

        // The pages persist `url` into Cosmos, so it must be the URL that will
        // actually serve. The raw blob URL does not: the account is closed to
        // the internet and `allow_nested_items_to_be_public = false` overrides
        // the containers' public access (TODO.md T-105). Public containers get
        // the delivery route; private ones get no URL at all rather than a
        // plausible-looking dead one.
        const url = PUBLIC_MEDIA_CONTAINERS.has(container) ? mediaUrlFor(container, path) : '';

        return json(200, { success: true, url, blobUrl, container, path });
      } catch (error) {
        context.error('uploadFile failed:', error);
        return json(500, { error: 'Failed to upload file' });
      }
    },
  };
}
