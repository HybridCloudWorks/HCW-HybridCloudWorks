/**
 * Anonymous media delivery.
 *
 * The load-bearing assertions are the negative ones: this route reads blobs
 * with the Function App's managed identity, which holds Storage Blob Data
 * Contributor over the *whole* account. Every container that is not on the
 * allowlist, and every path the validator does not accept, must fail before
 * storage is touched — otherwise the route is an anonymous read primitive for
 * private containers.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPublicMediaHandlers,
  ifNoneMatchMatches,
  parseRangeHeader,
  resolveRange,
} from './public-media.js';
import {
  GENERATED_MEDIA_CONTAINERS,
  mediaUrlFor,
  PUBLIC_MEDIA_CONTAINERS,
  UPLOAD_CONTAINERS,
} from './blob-paths.js';

const context = { log: vi.fn(), error: vi.fn() };

const okStorage = (blob) => ({
  readBlobForDelivery: vi.fn(async () => ({
    body: Buffer.from('png-bytes'),
    contentType: 'image/png',
    etag: '"0x8DABCDEF"',
    contentLength: 9,
    ...blob,
  })),
});

const makeRequest = ({
  container = 'covers',
  blobPath = 'post-1/cover.png',
  headers = {},
} = {}) => ({
  method: 'GET',
  params: { container, blobPath },
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

describe('container allowlist', () => {
  it('serves a blob from an allowlisted container', async () => {
    const storage = okStorage();
    const res = await createPublicMediaHandlers({ storage }).getMedia(makeRequest(), context);

    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(storage.readBlobForDelivery).toHaveBeenCalledWith('covers', 'post-1/cover.png');
  });

  it.each(['content', 'speakerevents'])(
    'refuses the private container %s without touching storage',
    async (container) => {
      const storage = okStorage();
      const res = await createPublicMediaHandlers({ storage }).getMedia(
        makeRequest({ container }),
        context
      );

      expect(res.status).toBe(404);
      expect(storage.readBlobForDelivery).not.toHaveBeenCalled();
    }
  );

  it('refuses a container that does not exist', async () => {
    const storage = okStorage();
    const res = await createPublicMediaHandlers({ storage }).getMedia(
      makeRequest({ container: '$logs' }),
      context
    );

    expect(res.status).toBe(404);
    expect(storage.readBlobForDelivery).not.toHaveBeenCalled();
  });

  it('gives every publicly readable container exactly one declared writer', () => {
    // This replaced `PUBLIC_MEDIA_CONTAINERS ⊂ UPLOAD_CONTAINERS`, which held
    // only because every public container happened to be one people upload to.
    // Listen & Learn audio is written by a job, not a person, so the subset
    // relation became false — and satisfying it would have meant opening the
    // episode container to the admin upload route.
    for (const container of PUBLIC_MEDIA_CONTAINERS) {
      const writers =
        Number(UPLOAD_CONTAINERS.has(container)) +
        Number(GENERATED_MEDIA_CONTAINERS.has(container));
      expect(writers, `${container} must have exactly one declared writer`).toBe(1);
    }
  });

  it('never lets the upload route write a container a job owns', () => {
    // A container that is both anonymously readable and reachable from the
    // upload route lets any editor put an arbitrary file behind a public URL.
    for (const container of GENERATED_MEDIA_CONTAINERS) {
      expect(UPLOAD_CONTAINERS.has(container)).toBe(false);
    }
  });

  it('still does not expose every container uploads may write to', () => {
    // `content` and `speakerevents` are deliberately not public; the original
    // test's size comparison was the part of it worth keeping.
    expect(UPLOAD_CONTAINERS.has('content')).toBe(true);
    expect(PUBLIC_MEDIA_CONTAINERS.has('content')).toBe(false);
    expect(UPLOAD_CONTAINERS.has('speakerevents')).toBe(true);
    expect(PUBLIC_MEDIA_CONTAINERS.has('speakerevents')).toBe(false);
  });
});

describe('path validation', () => {
  it.each([
    ['traversal', '../secrets.png'],
    ['nested traversal', 'a/../../b.png'],
    ['absolute', '/etc/passwd'],
    ['trailing slash', 'a/'],
    ['empty', ''],
  ])('refuses %s without touching storage', async (_label, blobPath) => {
    const storage = okStorage();
    const res = await createPublicMediaHandlers({ storage }).getMedia(
      makeRequest({ blobPath }),
      context
    );

    expect(res.status).toBe(404);
    expect(storage.readBlobForDelivery).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('marks responses immutable so repeat views never reach the function', async () => {
    const res = await createPublicMediaHandlers({ storage: okStorage() }).getMedia(
      makeRequest(),
      context
    );

    expect(res.headers['Cache-Control']).toContain('immutable');
    expect(res.headers['Cache-Control']).toContain('max-age=31536000');
    expect(res.headers.ETag).toBe('"0x8DABCDEF"');
  });

  it('answers 304 with no body when the ETag matches', async () => {
    const res = await createPublicMediaHandlers({ storage: okStorage() }).getMedia(
      makeRequest({ headers: { 'if-none-match': '"0x8DABCDEF"' } }),
      context
    );

    expect(res.status).toBe(304);
    expect(res.body).toBeUndefined();
  });

  it('serves the body when the ETag differs', async () => {
    const res = await createPublicMediaHandlers({ storage: okStorage() }).getMedia(
      makeRequest({ headers: { 'if-none-match': '"stale"' } }),
      context
    );

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Buffer);
  });

  it('sets nosniff', async () => {
    const res = await createPublicMediaHandlers({ storage: okStorage() }).getMedia(
      makeRequest(),
      context
    );
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('missing and failing blobs', () => {
  it('404s on a missing blob without logging an error', async () => {
    const storage = { readBlobForDelivery: vi.fn(async () => null) };
    const error = vi.fn();
    const res = await createPublicMediaHandlers({ storage }).getMedia(makeRequest(), {
      ...context,
      error,
    });

    expect(res.status).toBe(404);
    expect(error).not.toHaveBeenCalled();
  });

  it('500s and logs when storage fails for any other reason', async () => {
    const storage = {
      readBlobForDelivery: vi.fn(async () => {
        throw Object.assign(new Error('AuthorizationFailure'), { statusCode: 403 });
      }),
    };
    const error = vi.fn();
    const res = await createPublicMediaHandlers({ storage }).getMedia(makeRequest(), {
      ...context,
      error,
    });

    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalled();
  });
});

describe('ifNoneMatchMatches (RFC 9110 §13.1.2)', () => {
  const ETAG = '"0x8DABCDEF"';

  it.each([
    ['the exact tag', '"0x8DABCDEF"'],
    ['a weak tag', 'W/"0x8DABCDEF"'],
    ['a list containing the tag', '"other", "0x8DABCDEF", "another"'],
    ['a list with a weak match', '"other",W/"0x8DABCDEF"'],
    ['the wildcard', '*'],
  ])('matches %s', (_label, header) => {
    expect(ifNoneMatchMatches(header, ETAG)).toBe(true);
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['a different tag', '"stale"'],
    ['a list without the tag', '"stale", W/"older"'],
    ['an unquoted lookalike', '0x8DABCDEF'],
  ])('does not match %s', (_label, header) => {
    expect(ifNoneMatchMatches(header, ETAG)).toBe(false);
  });

  it('never matches when the blob has no ETag, wildcard included', () => {
    expect(ifNoneMatchMatches('*', '')).toBe(false);
    expect(ifNoneMatchMatches('"x"', undefined)).toBe(false);
  });

  it('answers 304 on the route for a list, a weak tag and the wildcard', async () => {
    for (const header of ['"stale", "0x8DABCDEF"', 'W/"0x8DABCDEF"', '*']) {
      const storage = okStorage();
      const res = await createPublicMediaHandlers({ storage }).getMedia(
        makeRequest({ headers: { 'if-none-match': header } }),
        context
      );
      expect(res.status, header).toBe(304);
    }
  });
});

describe('parseRangeHeader', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=100-', { start: 100, end: null }],
    ['bytes=-500', { suffix: 500 }],
    ['BYTES=0-0', { start: 0, end: 0 }],
    [' bytes=5-9 ', { start: 5, end: 9 }],
  ])('parses %s', (header, expected) => {
    expect(parseRangeHeader(header)).toEqual(expected);
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['not bytes', 'items=0-9'],
    ['no spec', 'bytes='],
    ['garbage', 'bytes=abc'],
    ['end before start', 'bytes=9-5'],
    ['multiple ranges', 'bytes=0-9,20-29'],
  ])('ignores %s so the full response is served', (_label, header) => {
    // Ignore, not refuse: a malformed or multi-range header gets the whole
    // file (RFC 9110 permits it); only a well-formed range for bytes that do
    // not exist is refused, and that decision needs the size (resolveRange).
    expect(parseRangeHeader(header)).toBeNull();
  });
});

describe('resolveRange', () => {
  it('clamps an end past the last byte rather than refusing it', () => {
    expect(resolveRange({ start: 0, end: 5000 }, 1000)).toEqual({ start: 0, end: 999 });
  });

  it('opens an open-ended range to the last byte', () => {
    expect(resolveRange({ start: 10, end: null }, 1000)).toEqual({ start: 10, end: 999 });
  });

  it('turns a suffix into the tail, bounded by the start of the blob', () => {
    expect(resolveRange({ suffix: 100 }, 1000)).toEqual({ start: 900, end: 999 });
    expect(resolveRange({ suffix: 5000 }, 1000)).toEqual({ start: 0, end: 999 });
  });

  it('refuses a start at or past the end, a zero suffix, and an empty blob', () => {
    expect(resolveRange({ start: 1000, end: null }, 1000)).toBeNull();
    expect(resolveRange({ start: 1500, end: 1600 }, 1000)).toBeNull();
    expect(resolveRange({ suffix: 0 }, 1000)).toBeNull();
    expect(resolveRange({ start: 0, end: null }, 0)).toBeNull();
  });
});

describe('byte ranges (#349)', () => {
  const FILE = Buffer.from('0123456789abcdef'); // 16 bytes
  const ETAG = '"0xRANGE"';

  /**
   * A storage fake that behaves like the SDK: a satisfiable range comes back
   * with its bytes and the total; a start past the end is the 416 the service
   * answers, which the lib turns into `{ unsatisfiable, totalLength }`.
   */
  const rangeStorage = () => ({
    readBlobForDelivery: vi.fn(async () => ({
      body: FILE,
      contentType: 'audio/mpeg',
      etag: ETAG,
      contentLength: FILE.length,
    })),
    headBlobForDelivery: vi.fn(async () => ({
      contentType: 'audio/mpeg',
      etag: ETAG,
      contentLength: FILE.length,
    })),
    readBlobRangeForDelivery: vi.fn(async (_c, _p, { start, end }) => {
      if (start >= FILE.length) return { unsatisfiable: true, totalLength: FILE.length };
      const last =
        end === null || end === undefined ? FILE.length - 1 : Math.min(end, FILE.length - 1);
      return {
        body: FILE.subarray(start, last + 1),
        contentType: 'audio/mpeg',
        etag: ETAG,
        start,
        end: last,
        totalLength: FILE.length,
      };
    }),
  });

  const get = (storage, headers = {}, method = 'GET') =>
    createPublicMediaHandlers({ storage }).getMedia(
      {
        ...makeRequest({ container: 'listenandlearn', blobPath: 'azure/az-104/a.mp3', headers }),
        method,
      },
      context
    );

  it('serves the whole file as 200 with Accept-Ranges when no Range is sent', async () => {
    const storage = rangeStorage();
    const res = await get(storage);

    expect(res.status).toBe(200);
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Content-Range']).toBeUndefined();
    expect(res.body).toBe(FILE);
    expect(storage.readBlobRangeForDelivery).not.toHaveBeenCalled();
  });

  it('answers the first bytes with 206 and a Content-Range', async () => {
    const storage = rangeStorage();
    const res = await get(storage, { range: 'bytes=0-3' });

    expect(res.status).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-3/16');
    expect(res.headers['Content-Length']).toBe('4');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Content-Type']).toBe('audio/mpeg');
    expect(res.body.toString()).toBe('0123');
    // Exactly the requested offsets reach storage; the whole-file read is
    // never made for a seek.
    expect(storage.readBlobRangeForDelivery).toHaveBeenCalledWith(
      'listenandlearn',
      'azure/az-104/a.mp3',
      { start: 0, end: 3 }
    );
    expect(storage.readBlobForDelivery).not.toHaveBeenCalled();
  });

  it('answers a middle range with exactly those bytes', async () => {
    const res = await get(rangeStorage(), { range: 'bytes=5-9' });
    expect(res.status).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 5-9/16');
    expect(res.body.toString()).toBe('56789');
  });

  it('answers an open-ended range to the last byte', async () => {
    const res = await get(rangeStorage(), { range: 'bytes=12-' });
    expect(res.status).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 12-15/16');
    expect(res.body.toString()).toBe('cdef');
  });

  it('resolves a suffix range against the size before asking for bytes', async () => {
    const storage = rangeStorage();
    const res = await get(storage, { range: 'bytes=-4' });

    expect(res.status).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 12-15/16');
    expect(res.body.toString()).toBe('cdef');
    expect(storage.headBlobForDelivery).toHaveBeenCalledTimes(1);
    expect(storage.readBlobRangeForDelivery).toHaveBeenCalledWith(
      'listenandlearn',
      'azure/az-104/a.mp3',
      { start: 12, end: 15 }
    );
  });

  it('refuses a range past the end with 416 and the size', async () => {
    const res = await get(rangeStorage(), { range: 'bytes=100-' });
    expect(res.status).toBe(416);
    expect(res.headers['Content-Range']).toBe('bytes */16');
    expect(res.body).toBeUndefined();
  });

  it('refuses a zero-length suffix with 416 without reading bytes', async () => {
    const storage = rangeStorage();
    const res = await get(storage, { range: 'bytes=-0' });
    expect(res.status).toBe(416);
    expect(storage.readBlobRangeForDelivery).not.toHaveBeenCalled();
  });

  it('keeps the immutable cache headers and the ETag on a 206', async () => {
    const res = await get(rangeStorage(), { range: 'bytes=0-3' });
    expect(res.headers['Cache-Control']).toContain('immutable');
    expect(res.headers.ETag).toBe(ETAG);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('answers 304 to a matching ETag on a Range without reading any bytes', async () => {
    // The ETag comes from blob properties, so a matching conditional never
    // pays for a ranged download it would then discard.
    const storage = rangeStorage();
    const res = await get(storage, { range: 'bytes=0-3', 'if-none-match': ETAG });
    expect(res.status).toBe(304);
    expect(res.body).toBeUndefined();
    expect(storage.headBlobForDelivery).toHaveBeenCalledTimes(1);
    expect(storage.readBlobRangeForDelivery).not.toHaveBeenCalled();
    expect(storage.readBlobForDelivery).not.toHaveBeenCalled();
  });

  it('reads the range once when the conditional ETag does not match', async () => {
    const storage = rangeStorage();
    const res = await get(storage, { range: 'bytes=0-3', 'if-none-match': '"stale"' });
    expect(res.status).toBe(206);
    expect(storage.headBlobForDelivery).toHaveBeenCalledTimes(1);
    expect(storage.readBlobRangeForDelivery).toHaveBeenCalledTimes(1);
  });

  it('does not read properties for an unconditional absolute range', async () => {
    const storage = rangeStorage();
    await get(storage, { range: 'bytes=0-3' });
    expect(storage.headBlobForDelivery).not.toHaveBeenCalled();
  });

  it('ignores a multi-range request and serves the whole file', async () => {
    const storage = rangeStorage();
    const res = await get(storage, { range: 'bytes=0-1,4-5' });
    expect(res.status).toBe(200);
    expect(storage.readBlobRangeForDelivery).not.toHaveBeenCalled();
  });

  it('404s a missing blob on the range path without logging', async () => {
    const storage = {
      ...rangeStorage(),
      readBlobRangeForDelivery: vi.fn(async () => null),
    };
    const error = vi.fn();
    const res = await createPublicMediaHandlers({ storage }).getMedia(
      {
        ...makeRequest({
          container: 'listenandlearn',
          blobPath: 'x/y/z.mp3',
          headers: { range: 'bytes=0-1' },
        }),
        method: 'GET',
      },
      { ...context, error }
    );
    expect(res.status).toBe(404);
    expect(error).not.toHaveBeenCalled();
  });

  it('applies the container allowlist before any ranged read', async () => {
    const storage = rangeStorage();
    const res = await createPublicMediaHandlers({ storage }).getMedia(
      { ...makeRequest({ container: 'content', headers: { range: 'bytes=0-1' } }), method: 'GET' },
      context
    );
    expect(res.status).toBe(404);
    expect(storage.readBlobRangeForDelivery).not.toHaveBeenCalled();
    expect(storage.headBlobForDelivery).not.toHaveBeenCalled();
  });

  describe('a storage without the ranged readers degrades, with a warning, never a throw', () => {
    // The type requires all three readers and production wires all three;
    // an older double that offers only readBlobForDelivery gets the
    // behaviour the route had before ranges existed.
    it('ignores Range and serves the whole file as 200', async () => {
      const storage = okStorage();
      const warn = vi.fn();
      const res = await createPublicMediaHandlers({ storage }).getMedia(
        makeRequest({ headers: { range: 'bytes=0-3' } }),
        { ...context, warn }
      );
      expect(res.status).toBe(200);
      expect(res.headers['Content-Range']).toBeUndefined();
      expect(res.body.toString()).toBe('png-bytes');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('answers HEAD from the full read with the body dropped', async () => {
      const storage = okStorage();
      const warn = vi.fn();
      const res = await createPublicMediaHandlers({ storage }).getMedia(
        { ...makeRequest(), method: 'HEAD' },
        { ...context, warn }
      );
      expect(res.status).toBe(200);
      expect(res.body).toBeUndefined();
      expect(res.headers['Content-Length']).toBe('9');
      expect(res.headers['Accept-Ranges']).toBe('bytes');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not warn when both readers are wired', async () => {
      const warn = vi.fn();
      await get({ ...rangeStorage() }, { range: 'bytes=0-3' });
      const res = await createPublicMediaHandlers({ storage: rangeStorage() }).getMedia(
        {
          ...makeRequest({
            container: 'listenandlearn',
            blobPath: 'a/b/c.mp3',
            headers: { range: 'bytes=0-3' },
          }),
          method: 'GET',
        },
        { ...context, warn }
      );
      expect(res.status).toBe(206);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('HEAD', () => {
    it('answers the size and range support with no body and no byte read', async () => {
      const storage = rangeStorage();
      const res = await get(storage, {}, 'HEAD');

      expect(res.status).toBe(200);
      expect(res.body).toBeUndefined();
      expect(res.headers['Content-Length']).toBe('16');
      expect(res.headers['Accept-Ranges']).toBe('bytes');
      expect(res.headers['Content-Type']).toBe('audio/mpeg');
      expect(res.headers.ETag).toBe(ETAG);
      expect(res.headers['Cache-Control']).toContain('immutable');
      expect(storage.readBlobForDelivery).not.toHaveBeenCalled();
      expect(storage.readBlobRangeForDelivery).not.toHaveBeenCalled();
    });

    it('answers 304 to a matching ETag', async () => {
      const res = await get(rangeStorage(), { 'if-none-match': ETAG }, 'HEAD');
      expect(res.status).toBe(304);
    });

    it('404s a missing blob with headers only', async () => {
      const storage = { ...rangeStorage(), headBlobForDelivery: vi.fn(async () => null) };
      const res = await get(storage, {}, 'HEAD');
      expect(res.status).toBe(404);
      expect(res.body).toBeUndefined();
      expect('body' in res).toBe(false);
    });

    it('never carries a body on any status, including the allowlist 404 and a 500', async () => {
      const denied = await createPublicMediaHandlers({ storage: rangeStorage() }).getMedia(
        { ...makeRequest({ container: 'content' }), method: 'HEAD' },
        context
      );
      expect(denied.status).toBe(404);
      expect('body' in denied).toBe(false);

      const failing = {
        ...rangeStorage(),
        headBlobForDelivery: vi.fn(async () => {
          throw Object.assign(new Error('AuthorizationFailure'), { statusCode: 403 });
        }),
      };
      const res = await createPublicMediaHandlers({ storage: failing }).getMedia(
        {
          ...makeRequest({ container: 'listenandlearn', blobPath: 'a/b/c.mp3' }),
          method: 'HEAD',
        },
        { ...context, error: vi.fn() }
      );
      expect(res.status).toBe(500);
      expect('body' in res).toBe(false);
    });

    it('applies the same allowlist and path validation', async () => {
      const storage = rangeStorage();
      const res = await createPublicMediaHandlers({ storage }).getMedia(
        { ...makeRequest({ container: 'speakerevents' }), method: 'HEAD' },
        context
      );
      expect(res.status).toBe(404);
      expect(storage.headBlobForDelivery).not.toHaveBeenCalled();
    });
  });
});

describe('mediaUrlFor', () => {
  it('produces a site-relative URL, not one carrying the API hostname', () => {
    // Stored into Cosmos as imageUrl. An absolute URL here means a topology
    // change (TODO.md) breaks every image already in the database.
    const url = mediaUrlFor('covers', 'post-1/cover.png');
    expect(url).toBe('/api/public/media/covers/post-1/cover.png');
    expect(url.startsWith('/')).toBe(true);
    expect(url).not.toMatch(/^https?:/);
  });

  it('encodes each path segment without escaping the separators', () => {
    expect(mediaUrlFor('covers', 'a b/c&d.png')).toBe('/api/public/media/covers/a%20b/c%26d.png');
  });
});
