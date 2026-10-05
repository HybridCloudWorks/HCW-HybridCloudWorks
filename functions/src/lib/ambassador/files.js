/**
 * The files an application archives (owner request 2026-10-05): agreements,
 * role descriptions, exports. They are uploaded into a PRIVATE container
 * under `ambassador/{applicationId}/` (admin-uploads.js accepts documents
 * there and nowhere public), so the anonymous media route never serves
 * them — and until this route existed nothing served them at all: the
 * upload answered no URL for a private container, the application cleaner
 * dropped an entry without one, and the blob was orphaned behind a success
 * toast (review on #873). An application now records `{ container, path }`
 * for a private file and reads it back through here, behind the editor
 * guard, as a download.
 */
import { isValidBlobPath } from '../blob-paths.js';
import { json } from './steps.js';

/** The containers the anonymous media route does not serve; the only ones this reads. */
export const PRIVATE_FILE_CONTAINERS = Object.freeze(['speakerevents', 'content']);

/** Every application file sits under this prefix; nothing else is served here. */
export const APPLICATION_FILE_PREFIX = 'ambassador/';

const notFound = () => json(404, { error: 'No such file' });

/** The download name: the final path segment, quotes removed. */
export function downloadName(blobPath) {
  return String(blobPath).split('/').pop().replace(/["\\]/g, '');
}

/**
 * GET cms/ambassador/files/{container}/{*blobPath} — editor. The blob as an
 * attachment, never cached, never sniffed.
 *
 * @param {{ storage?: { readBlobForDelivery: Function } | null }} deps
 */
export function createFileDownload({ storage }) {
  return async function downloadApplicationFile(_ctx, request) {
    const container = String(request.params?.container || '');
    const blobPath = String(request.params?.blobPath || '');
    if (!PRIVATE_FILE_CONTAINERS.includes(container)) return notFound();
    if (!isValidBlobPath(blobPath) || !blobPath.startsWith(APPLICATION_FILE_PREFIX)) {
      return notFound();
    }
    if (!storage?.readBlobForDelivery) {
      return json(503, { error: 'File storage is not configured on this host' });
    }
    const blob = await storage.readBlobForDelivery(container, blobPath);
    if (!blob) return notFound();
    const body = blob.body ?? blob.content ?? blob.data ?? null;
    return {
      status: 200,
      headers: {
        'Content-Type': blob.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${downloadName(blobPath)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        ...(blob.etag ? { ETag: blob.etag } : {}),
      },
      body,
    };
  };
}
