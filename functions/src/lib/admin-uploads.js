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

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const UPLOAD_CONTAINERS = new Set([
  'certifications',
  'speakerevents',
  'covers',
  'blogs',
  'content',
]);

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PATH_LENGTH = 300;
const PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

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
          return json(413, { error: 'File exceeds the 5MB upload limit' });
        }

        const url = await storage.uploadBlob(container, path, buffer, contentType);
        return json(200, { success: true, url, container, path });
      } catch (error) {
        context.error('uploadFile failed:', error);
        return json(500, { error: 'Failed to upload file' });
      }
    },
  };
}
