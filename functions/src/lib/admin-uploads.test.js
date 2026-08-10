/**
 * Admin uploads — the load-bearing assertions are the negative ones: an
 * unauthenticated or role-denied request must never reach storage, and the
 * blob path is attacker-influenced input that becomes a storage key.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAdminUploadHandlers,
  extensionOf,
  isValidBlobPath,
  MAX_BASE64_CHARS,
  MAX_REQUEST_BYTES,
  normalizeMediaType,
  UPLOAD_CONTAINERS,
} from './admin-uploads.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = () => ({
  requireRole: vi.fn(async () => ({ user: { uid: 'u1' }, role: 'editor' })),
});
const denyGuard = () => ({
  requireRole: vi.fn(async () => ({
    error: { status: 403, body: JSON.stringify({ error: 'Forbidden' }) },
  })),
});

const makeRequest = ({ container = 'certifications', body = {}, contentLength } = {}) => ({
  method: 'POST',
  params: { container },
  headers: {
    get: (name) =>
      name.toLowerCase() === 'content-length' && contentLength !== undefined
        ? String(contentLength)
        : null,
  },
  json: async () => body,
});

const validBody = () => ({
  path: 'cert-1/images/badge-123.png',
  contentType: 'image/png',
  dataBase64: Buffer.from('fake-png-bytes').toString('base64'),
});

describe('isValidBlobPath', () => {
  it('accepts the naming scheme the pages use', () => {
    expect(isValidBlobPath('cert-1/images/badge-1700000000.png')).toBe(true);
    expect(isValidBlobPath('a.png')).toBe(true);
  });

  it('rejects traversal, absolute, trailing-slash, and oversized paths', () => {
    expect(isValidBlobPath('../secrets')).toBe(false);
    expect(isValidBlobPath('a/../b.png')).toBe(false);
    expect(isValidBlobPath('/etc/passwd')).toBe(false);
    expect(isValidBlobPath('dir/')).toBe(false);
    expect(isValidBlobPath('')).toBe(false);
    expect(isValidBlobPath('a'.repeat(301))).toBe(false);
    expect(isValidBlobPath('with space.png')).toBe(false);
  });
});

describe('uploadFile', () => {
  it('uploads to the named container and returns a URL that will serve', async () => {
    const storage = { uploadBlob: vi.fn(async () => 'https://acct.blob/x/y.png') };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    const res = await h.uploadFile(makeRequest({ body: validBody() }), context);
    const parsed = JSON.parse(res.body);

    // NOT the raw blob URL. The account is closed to the internet and
    // allow_nested_items_to_be_public overrides container access, so that URL
    // is dead (TODO.md T-105). `url` is what pages persist into Cosmos.
    expect(parsed.url).toBe('/api/public/media/certifications/cert-1/images/badge-123.png');
    expect(parsed.blobUrl).toBe('https://acct.blob/x/y.png');

    const [container, path, buffer, contentType] = storage.uploadBlob.mock.calls[0];
    expect(container).toBe('certifications');
    expect(path).toBe('cert-1/images/badge-123.png');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe('fake-png-bytes');
    expect(contentType).toBe('image/png');
  });

  it('returns no URL for a container that is not publicly served', async () => {
    // A plausible-looking dead URL persisted into Cosmos is worse than none:
    // the page renders a broken image and nothing indicates why.
    const storage = { uploadBlob: vi.fn(async () => 'https://acct.blob/x/y.png') };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    const res = await h.uploadFile(
      makeRequest({ container: 'content', body: validBody() }),
      context
    );
    const parsed = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(parsed.url).toBe('');
    expect(parsed.blobUrl).toBe('https://acct.blob/x/y.png');
  });

  it('denial makes zero storage calls', async () => {
    const storage = { uploadBlob: vi.fn() };
    const h = createAdminUploadHandlers({ guard: denyGuard(), storage });
    const res = await h.uploadFile(makeRequest({ body: validBody() }), context);
    expect(res.status).toBe(403);
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('rejects containers outside the allowlist before reading the body', async () => {
    const storage = { uploadBlob: vi.fn() };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    for (const container of ['admin_settings', '$root', 'certifications2']) {
      const res = await h.uploadFile(makeRequest({ container, body: validBody() }), context);
      expect(res.status).toBe(404);
    }
    expect(storage.uploadBlob).not.toHaveBeenCalled();
    expect(UPLOAD_CONTAINERS.has('certifications')).toBe(true);
  });

  it('rejects traversal paths and empty payloads', async () => {
    const storage = { uploadBlob: vi.fn() };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });

    const badPath = await h.uploadFile(
      makeRequest({ body: { ...validBody(), path: 'a/../../b.png' } }),
      context
    );
    expect(badPath.status).toBe(400);

    const noData = await h.uploadFile(
      makeRequest({ body: { ...validBody(), dataBase64: '' } }),
      context
    );
    expect(noData.status).toBe(400);
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('enforces the decoded 15MB cap server-side', async () => {
    const storage = { uploadBlob: vi.fn() };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    const big = Buffer.alloc(15 * 1024 * 1024 + 1).toString('base64');
    const res = await h.uploadFile(
      makeRequest({ body: { ...validBody(), dataBase64: big } }),
      context
    );
    expect(res.status).toBe(413);
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an existing blob', async () => {
    const conflict = Object.assign(new Error('already exists'), { statusCode: 409 });
    const storage = {
      uploadBlob: vi.fn(async () => {
        throw conflict;
      }),
    };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    const res = await h.uploadFile(makeRequest({ body: validBody() }), context);

    expect(res.status).toBe(409);
    // The condition has to be requested, or the service never raises the 409.
    const [, , , , , options] = storage.uploadBlob.mock.calls[0];
    expect(options).toEqual({ overwrite: false });
    // A conflict is an ordinary outcome, not something to log as a failure.
    expect(context.error).not.toHaveBeenCalledWith('uploadFile failed:', conflict);
  });
});

describe('size checks happen before allocation (T-306)', () => {
  it('rejects on Content-Length without reading the body', async () => {
    const storage = { uploadBlob: vi.fn() };
    const json = vi.fn();
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    const request = { ...makeRequest({ contentLength: MAX_REQUEST_BYTES + 1 }), json };

    const res = await h.uploadFile(request, context);

    expect(res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('accepts a body at the Content-Length limit', async () => {
    const storage = { uploadBlob: vi.fn(async () => 'https://acct.blob/x/y.png') };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    const res = await h.uploadFile(
      makeRequest({ body: validBody(), contentLength: MAX_REQUEST_BYTES }),
      context
    );
    expect(res.status).toBe(200);
  });

  it('proceeds when Content-Length is absent or unparseable', async () => {
    // Chunked requests carry no Content-Length. The header is an early reject,
    // never the limit, so its absence must not turn into a rejection either.
    const storage = { uploadBlob: vi.fn(async () => 'https://acct.blob/x/y.png') };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });

    for (const contentLength of [undefined, 'not-a-number']) {
      const res = await h.uploadFile(makeRequest({ body: validBody(), contentLength }), context);
      expect(res.status).toBe(200);
    }
  });

  it('rejects on base64 length before decoding', async () => {
    const storage = { uploadBlob: vi.fn() };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });

    // Not a decodable payload — 'A' repeated is valid base64 characters but the
    // point is that the request never gets far enough to find out.
    const dataBase64 = 'A'.repeat(MAX_BASE64_CHARS + 1);
    const res = await h.uploadFile(makeRequest({ body: { ...validBody(), dataBase64 } }), context);

    expect(res.status).toBe(413);
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });
});

describe('content-type allowlist (T-307)', () => {
  it('normalizes parameters and case off the declared type', () => {
    expect(normalizeMediaType('Image/PNG; charset=utf-8')).toBe('image/png');
    expect(normalizeMediaType(undefined)).toBe('');
  });

  it('reads the extension from the final path segment', () => {
    expect(extensionOf('a/b/badge-1.PNG')).toBe('png');
    expect(extensionOf('dir.with.dots/badge')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });

  it('rejects a type outside the allowlist', async () => {
    const storage = { uploadBlob: vi.fn() };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });

    for (const [path, contentType] of [
      ['evil.html', 'text/html'],
      ['evil.js', 'application/javascript'],
      ['badge-1.png', 'application/octet-stream'],
      ['badge-1.png', ''],
    ]) {
      const res = await h.uploadFile(
        makeRequest({ body: { ...validBody(), path, contentType } }),
        context
      );
      expect(res.status).toBe(415);
    }
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('rejects an extension that disagrees with the declared type', async () => {
    const storage = { uploadBlob: vi.fn() };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });

    // The dangerous shape: an allowlisted type paired with a path that will be
    // read as something else by anything that trusts the filename.
    const res = await h.uploadFile(
      makeRequest({ body: { ...validBody(), path: 'evil.html', contentType: 'image/png' } }),
      context
    );
    expect(res.status).toBe(415);

    const noExt = await h.uploadFile(
      makeRequest({ body: { ...validBody(), path: 'badge', contentType: 'image/png' } }),
      context
    );
    expect(noExt.status).toBe(415);
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('accepts the types the pickers actually offer', async () => {
    const storage = { uploadBlob: vi.fn(async () => 'https://acct.blob/x/y.png') };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });

    for (const [path, contentType] of [
      ['a/badge.png', 'image/png'],
      ['a/badge.JPG', 'image/jpeg'],
      ['a/badge.jpeg', 'image/jpeg'],
      ['a/badge.webp', 'image/webp'],
      ['a/badge.gif', 'image/gif'],
    ]) {
      const res = await h.uploadFile(
        makeRequest({ body: { ...validBody(), path, contentType } }),
        context
      );
      expect(res.status).toBe(200);
    }
  });

  it('allows SVG into a private container and refuses it in a public one', async () => {
    const storage = { uploadBlob: vi.fn(async () => 'https://acct.blob/x/y.svg') };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    const body = { ...validBody(), path: 'submissions/a.svg', contentType: 'image/svg+xml' };

    // SubmitUrlsPage's picker offers SVG and uploads to `content`, which the
    // anonymous media route does not serve.
    const priv = await h.uploadFile(makeRequest({ container: 'content', body }), context);
    expect(priv.status).toBe(200);

    // `certifications` is served anonymously, and an SVG is a scriptable
    // document in the storage origin.
    const pub = await h.uploadFile(makeRequest({ container: 'certifications', body }), context);
    expect(pub.status).toBe(415);
  });

  it('stores the normalized type, not the raw header value', async () => {
    const storage = { uploadBlob: vi.fn(async () => 'https://acct.blob/x/y.png') };
    const h = createAdminUploadHandlers({ guard: allowGuard(), storage });
    await h.uploadFile(
      makeRequest({ body: { ...validBody(), contentType: 'Image/PNG; charset=utf-8' } }),
      context
    );
    expect(storage.uploadBlob.mock.calls[0][3]).toBe('image/png');
  });
});
