/**
 * Anonymous media delivery — `GET|HEAD public/media/{container}/{*blobPath}`.
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
 * one; it is recorded in TODO.md §0.
 *
 * Cost note: this puts image bytes through Function invocations. `immutable`
 * cache headers plus conditional-request support keep repeat views off the
 * function entirely, which is what makes the arithmetic work for a content
 * site. Blob paths carry a timestamp already ({docId}/images/badge-{ts}.png),
 * so content is genuinely immutable per URL.
 *
 * Byte ranges (issue #349, ADR 0029). Listen & Learn episodes are served from
 * this route too, and an `<audio>` element seeks by sending `Range:
 * bytes=start-end`. Until 2026-09-07 the route ignored the header and answered
 * every seek with the whole file, so scrubbing to minute eight downloaded
 * minutes one to seven first. The route now honours a single byte range with
 * `206 Partial Content`, refuses one that starts past the end with `416`, and
 * advertises `Accept-Ranges: bytes` on every success — which is also what a
 * podcast directory requires of an enclosure host, so a self-hosted feed
 * (option 3 on #349) is no longer blocked here. Multiple ranges in one request
 * are ignored and answered with the full 200, which RFC 9110 permits and every
 * browser accepts; `If-Range` is not evaluated, which is safe only because a
 * URL here never changes content — the path carries the timestamp.
 */

import { isValidBlobPath, PUBLIC_MEDIA_CONTAINERS } from './blob-paths.js';

/** One year. The path is content-addressed by timestamp, so this is safe. */
const MAX_AGE_SECONDS = 31536000;

const CACHE_CONTROL = `public, max-age=${MAX_AGE_SECONDS}, immutable`;

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Parse a `Range` request header.
 *
 * Returns `null` for anything the route should ignore and answer in full: no
 * header, a unit other than `bytes`, more than one range, or a range that does
 * not parse (RFC 9110 §14.2: a server MAY ignore the header). The distinction
 * that matters is between *ignore* and *refuse*: `bytes=abc` is a malformed
 * header and gets the whole file; `bytes=999999-` is a well-formed request for
 * bytes that do not exist and gets a 416 — that decision needs the size, so it
 * belongs to `resolveRange`.
 *
 * @param {string|null|undefined} value
 * @returns {{start: number, end: number|null}|{suffix: number}|null}
 */
export function parseRangeHeader(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = /^bytes=(.*)$/i.exec(raw);
  if (!match) return null;
  const spec = match[1].trim();
  if (!spec || spec.includes(',')) return null;

  const suffix = /^-(\d+)$/.exec(spec);
  if (suffix) return { suffix: Number(suffix[1]) };

  const pair = /^(\d+)-(\d*)$/.exec(spec);
  if (!pair) return null;
  const start = Number(pair[1]);
  const end = pair[2] === '' ? null : Number(pair[2]);
  if (end !== null && end < start) return null;
  return { start, end };
}

/**
 * Turn a parsed range into inclusive offsets against a known size, or `null`
 * when nothing in it can be satisfied: a start at or past the end, a suffix
 * of zero bytes, or an empty blob. An end past the last byte is clamped, not
 * refused — that is what `bytes=0-` and a browser's optimistic `bytes=0-1023`
 * on a smaller file both rely on.
 *
 * @param {{start: number, end: number|null}|{suffix: number}} range
 * @param {number} totalLength
 * @returns {{start: number, end: number}|null}
 */
export function resolveRange(range, totalLength) {
  if (!Number.isInteger(totalLength) || totalLength <= 0) return null;
  const last = totalLength - 1;
  if ('suffix' in range) {
    if (range.suffix <= 0) return null;
    return { start: Math.max(0, totalLength - range.suffix), end: last };
  }
  if (range.start > last) return null;
  return { start: range.start, end: range.end === null ? last : Math.min(range.end, last) };
}

/** The headers every successful answer carries, body or not. */
function deliveryHeaders({ contentType, etag }) {
  return {
    'Content-Type': contentType || 'application/octet-stream',
    'Cache-Control': CACHE_CONTROL,
    'Accept-Ranges': 'bytes',
    ...(etag ? { ETag: etag } : {}),
    // The bytes are already public; this only stops a browser from sniffing
    // them into something executable.
    'X-Content-Type-Options': 'nosniff',
  };
}

const notModified = (etag) => ({
  status: 304,
  headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL, 'Accept-Ranges': 'bytes' },
});

const etagMatches = (request, etag) => {
  const ifNoneMatch = request.headers?.get?.('if-none-match') || '';
  return Boolean(etag && ifNoneMatch && ifNoneMatch === etag);
};

/**
 * All three readers are required: the route registers HEAD and honours
 * Range, and `functions/public-media.js` wires all three. A storage that
 * lacks one — an older test double, say — degrades to the behaviour the
 * route had before ranges existed rather than throwing: a Range request is
 * ignored and served in full (RFC 9110 permits ignoring the header), and a
 * HEAD is answered from the full read with the body dropped.
 *
 * @param {object} deps
 * @param {{
 *   readBlobForDelivery: Function,
 *   readBlobRangeForDelivery: Function,
 *   headBlobForDelivery: Function,
 * }} deps.storage
 */
export function createPublicMediaHandlers({ storage }) {
  const canRange = typeof storage.readBlobRangeForDelivery === 'function';
  const canHead = typeof storage.headBlobForDelivery === 'function';

  /** HEAD: the 200's headers, sized for the whole blob, and no body. */
  async function head(container, blobPath, request) {
    const blob = canHead
      ? await storage.headBlobForDelivery(container, blobPath)
      : await storage.readBlobForDelivery(container, blobPath);
    if (!blob) return json(404, { error: 'Not found' });
    if (etagMatches(request, blob.etag)) return notModified(blob.etag);
    return {
      status: 200,
      headers: {
        ...deliveryHeaders(blob),
        'Content-Length': String(blob.contentLength ?? blob.body?.length ?? 0),
      },
    };
  }

  /** A single satisfiable-or-not byte range: 206, 416, or 304. */
  async function partial(container, blobPath, request, range) {
    // A conditional request or a suffix needs the blob's properties before
    // any bytes are read: the first so a matching ETag answers 304 without
    // a ranged download it would then discard, the second because a suffix
    // is relative to a size this route does not know yet. One properties
    // read serves both.
    const conditional = Boolean(request.headers?.get?.('if-none-match'));
    let offsets = range;
    if (conditional || 'suffix' in range) {
      const blob = await storage.headBlobForDelivery(container, blobPath);
      if (!blob) return json(404, { error: 'Not found' });
      if (etagMatches(request, blob.etag)) return notModified(blob.etag);
      if ('suffix' in range) {
        offsets = resolveRange(range, blob.contentLength);
        if (!offsets) return unsatisfiable(blob.contentLength);
      }
    }

    const chunk = await storage.readBlobRangeForDelivery(container, blobPath, offsets);
    if (!chunk) return json(404, { error: 'Not found' });
    if (chunk.unsatisfiable) return unsatisfiable(chunk.totalLength);

    return {
      status: 206,
      headers: {
        ...deliveryHeaders(chunk),
        'Content-Range': `bytes ${chunk.start}-${chunk.end}/${chunk.totalLength}`,
        'Content-Length': String(chunk.body.length),
      },
      body: chunk.body,
    };
  }

  function unsatisfiable(totalLength) {
    return {
      status: 416,
      headers: {
        'Content-Range': `bytes */${totalLength}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    };
  }

  /** The whole blob, exactly as before ranges existed, plus `Accept-Ranges`. */
  async function full(container, blobPath, request) {
    const blob = await storage.readBlobForDelivery(container, blobPath);
    if (!blob) return json(404, { error: 'Not found' });
    if (etagMatches(request, blob.etag)) return notModified(blob.etag);
    return {
      status: 200,
      headers: deliveryHeaders(blob),
      body: blob.body,
    };
  }

  return {
    /** GET|HEAD /api/public/media/{container}/{*blobPath} */
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
        if (String(request.method || '').toUpperCase() === 'HEAD') {
          if (!canHead) context.warn?.('getMedia: no headBlobForDelivery; HEAD via full read');
          return await head(container, blobPath, request);
        }
        const range = parseRangeHeader(request.headers?.get?.('range'));
        if (range) {
          // The ranged path needs both readers: bytes from one, and the size
          // and ETag a suffix or a conditional needs from the other.
          if (canRange && canHead) return await partial(container, blobPath, request, range);
          context.warn?.('getMedia: ranged readers not wired; Range ignored, serving in full');
        }
        return await full(container, blobPath, request);
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
