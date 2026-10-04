/**
 * URL or relative path → the Azure blob it names (PR #841 split of
 * gallery-images.js).
 *
 * Storage adaptation: GCS bucket paths ('covers/x.png') map onto the Azure
 * storage containers Terraform creates with the SAME names as the GCS path
 * prefixes (blogs, covers, certifications, speakerevents, content) — first
 * path segment selects the container, the rest is the blob name.
 * parseStorageRef also reads Azure blob URLs, the site's own media route
 * (`/api/public/media/{container}/{path}` — the URL every AI-generated row
 * carries, which until ADR 0033 meant none of their blobs could be deleted)
 * and the two legacy Google URL shapes; a legacy URL whose prefix is a known
 * container maps across, and anything else returns null — the record delete
 * still proceeds and storageDeleted reports false, mirroring the source's
 * ignore-failures posture (and matching reality: pre-migration blobs live in
 * Firebase Storage, whose bucket has since been decommissioned — see below).
 *
 * THE GOOGLE BRANCHES STAY, THOUGH THE BUCKET IS GONE (#518). The bucket was
 * decommissioned and every URL into it 404s — but this path does not FETCH
 * those URLs, it maps a legacy URL onto the Azure blob that replaced it so a
 * delete can find it. Removing the branches would make that mapping fail for
 * any row still carrying a legacy URL whose object WAS migrated, turning a
 * successful delete into a silent orphan. The rendering side is where the dead
 * URLs mattered, and it now treats them as absent.
 */
export const KNOWN_STORAGE_CONTAINERS = new Set([
  'blogs',
  'covers',
  'certifications',
  'speakerevents',
  'content',
]);

const MEDIA_ROUTE_PREFIX = '/api/public/media/';

/** `{container}/{blobName}` → the ref, or null for an unknown container or no name. */
function fromPath(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  const slash = clean.indexOf('/');
  if (slash <= 0) return null;
  const container = clean.slice(0, slash);
  const blobName = clean.slice(slash + 1);
  if (!KNOWN_STORAGE_CONTAINERS.has(container) || !blobName) return null;
  return { container, blobName };
}

/** A segment decoded, or as written when it is not valid percent-encoding. */
function decodedSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The site's own media route, each segment decoded, or null for any other path. */
function fromMediaRoute(pathname) {
  if (!pathname.startsWith(MEDIA_ROUTE_PREFIX)) return null;
  const rest = pathname.slice(MEDIA_ROUTE_PREFIX.length);
  return fromPath(rest.split('/').map(decodedSegment).join('/'));
}

/** An absolute URL on a host this module knows: the media route, Azure, or legacy Google. */
function fromHostedUrl(parsed) {
  const viaRoute = fromMediaRoute(parsed.pathname);
  if (viaRoute) return viaRoute;
  if (parsed.hostname.endsWith('.blob.core.windows.net')) {
    return fromPath(decodeURIComponent(parsed.pathname));
  }
  if (parsed.hostname === 'storage.googleapis.com') {
    // /{bucket}/{path} — drop the bucket segment.
    const parts = parsed.pathname.replace(/^\/+/, '').split('/');
    return fromPath(decodeURIComponent(parts.slice(1).join('/')));
  }
  const marker = '/o/';
  const markerIndex = parsed.pathname.indexOf(marker);
  if (parsed.hostname === 'firebasestorage.googleapis.com' && markerIndex >= 0) {
    return fromPath(decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)));
  }
  return null;
}

/** URL or relative path -> { container, blobName } | null. See header. */
export function parseStorageRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith(MEDIA_ROUTE_PREFIX)) return fromMediaRoute(raw.split(/[?#]/)[0]);
  if (!/^https?:\/\//i.test(raw)) return fromPath(raw);
  try {
    return fromHostedUrl(new URL(raw));
  } catch {
    return null;
  }
}
