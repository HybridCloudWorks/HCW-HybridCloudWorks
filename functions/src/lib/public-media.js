/**
 * Anonymous media delivery — `GET public/media/{container}/{*blobPath}`.
 *
 * The delivery model this implements, and why (TODO.md T-105):
 *
 * The storage account sets `allow_nested_items_to_be_public = false` and
 * `network_rules { default_action = "Deny" }`. The first is a master override,
 * not a default: with it false, a container declared `container_access_type =
 * "blob"` still answers 409 to an anonymous reader. The second blocks the
 * internet from the account outright. So the three containers marked public in
 * Terraform never served a byte, and `uploadBlob`'s returned URL — persisted
 * into Cosmos as `imageUrl` — was dead on arrival.
 *
 * Two ways out. Open the account and front it with a CDN, which means reversing
 * both settings, exposing the account to the internet, and adding a service
 * with a monthly floor against a USD 150 design ceiling. Or keep the account
 * closed and read through the Function App's managed identity, which already
 * holds Storage Blob Data Contributor and already reaches the account over the
 * integrated subnet.
 *
 * This is the second. It adds no Azure resource, reverses no security setting,
 * and leaves a CDN free to be layered in front of the site origin later without
 * touching application code — cache headers here are written so that it can be.
 * The first option remains open and is a spend decision, not an engineering
 * one; it is recorded in REVIEW.md §0.
 *
 * Cost note: this puts image bytes through Function invocations. `immutable`
 * cache headers plus conditional-request support keep repeat views off the
 * function entirely, which is what makes the arithmetic work for a content
 * site. Blob paths carry a timestamp already ({docId}/images/badge-{ts}.png),
 * so content is genuinely immutable per URL.
 */

import { isValidBlobPath, PUBLIC_MEDIA_CONTAINERS } from './blob-paths.js';

/** One year. The path is content-addressed by timestamp, so this is safe. */
const MAX_AGE_SECONDS = 31536000;

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * @param {object} deps
 * @param {{ readBlobForDelivery: Function }} deps.storage
 */
export function createPublicMediaHandlers({ storage }) {
  return {
    /** GET /api/public/media/{container}/{*blobPath} */
    async getMedia(request, context) {
      const container = String(request.params?.container || '').trim();
      const blobPath = String(request.params?.blobPath || '').trim();

      // Order matters: an unknown container must not be distinguishable from a
      // known-but-empty one by response shape, and neither reveals whether a
      // private container exists.
      if (!PUBLIC_MEDIA_CONTAINERS.has(container)) {
        return json(404, { error: 'Not found' });
      }
      if (!isValidBlobPath(blobPath)) {
        return json(404, { error: 'Not found' });
      }

      try {
        const blob = await storage.readBlobForDelivery(container, blobPath);
        if (!blob) {
          return json(404, { error: 'Not found' });
        }

        const etag = blob.etag || '';
        const ifNoneMatch = request.headers?.get?.('if-none-match') || '';
        if (etag && ifNoneMatch && ifNoneMatch === etag) {
          return {
            status: 304,
            headers: {
              ETag: etag,
              'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}, immutable`,
            },
          };
        }

        return {
          status: 200,
          headers: {
            'Content-Type': blob.contentType || 'application/octet-stream',
            'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}, immutable`,
            ...(etag ? { ETag: etag } : {}),
            // The bytes are already public; this only stops a browser from
            // sniffing them into something executable.
            'X-Content-Type-Options': 'nosniff',
          },
          body: blob.body,
        };
      } catch (error) {
        if (error?.statusCode === 404 || error?.code === 'BlobNotFound') {
          return json(404, { error: 'Not found' });
        }
        context.error('getMedia failed:', error);
        return json(500, { error: 'Failed to read media' });
      }
    },
  };
}
