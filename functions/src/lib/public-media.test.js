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
import { createPublicMediaHandlers } from './public-media.js';
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
        Number(UPLOAD_CONTAINERS.has(container)) + Number(GENERATED_MEDIA_CONTAINERS.has(container));
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

describe('mediaUrlFor', () => {
  it('produces a site-relative URL, not one carrying the API hostname', () => {
    // Stored into Cosmos as imageUrl. An absolute URL here means a topology
    // change (REVIEW.md §0.1) breaks every image already in the database.
    const url = mediaUrlFor('covers', 'post-1/cover.png');
    expect(url).toBe('/api/public/media/covers/post-1/cover.png');
    expect(url.startsWith('/')).toBe(true);
    expect(url).not.toMatch(/^https?:/);
  });

  it('encodes each path segment without escaping the separators', () => {
    expect(mediaUrlFor('covers', 'a b/c&d.png')).toBe('/api/public/media/covers/a%20b/c%26d.png');
  });
});
