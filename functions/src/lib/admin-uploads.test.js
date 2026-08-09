/**
 * Admin uploads — the load-bearing assertions are the negative ones: an
 * unauthenticated or role-denied request must never reach storage, and the
 * blob path is attacker-influenced input that becomes a storage key.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAdminUploadHandlers, isValidBlobPath, UPLOAD_CONTAINERS } from './admin-uploads.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = () => ({
  requireRole: vi.fn(async () => ({ user: { uid: 'u1' }, role: 'editor' })),
});
const denyGuard = () => ({
  requireRole: vi.fn(async () => ({
    error: { status: 403, body: JSON.stringify({ error: 'Forbidden' }) },
  })),
});

const makeRequest = ({ container = 'certifications', body = {} } = {}) => ({
  method: 'POST',
  params: { container },
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
});
