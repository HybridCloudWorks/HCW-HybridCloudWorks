/**
 * Blob storage credential resolution.
 *
 * This file exists because of a gap, not a feature. `admin-uploads.test.js`
 * injects `{ uploadBlob: vi.fn() }`, so seven green tests reported that uploads
 * worked while the real module required STORAGE_CONNECTION_STRING — a setting
 * `infra/` has never produced — and therefore threw on every upload and every
 * gallery delete in a deployed app (TODO.md T-104).
 *
 * The load-bearing assertions are therefore about configuration and credential
 * shape, the part no handler test can reach: that the module reads what
 * Terraform writes, and that no shared-key path survives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  resolveBlobEndpoint,
  resolveAccountName,
  getBlobUrl,
  resetBlobServiceForTests,
  uploadBlob,
} from './blob-storage.js';

const uploadSpy = vi.hoisted(() => vi.fn());

// Only the service client is replaced. Everything else in the SDK — the SAS
// helpers this module imports at load time — stays real.
vi.mock('@azure/storage-blob', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    BlobServiceClient: class {
      getContainerClient() {
        return {
          getBlockBlobClient: (blobName) => ({
            url: `https://hcwmedia.blob.core.windows.net/c/${blobName}`,
            upload: uploadSpy,
          }),
        };
      }
    },
  };
});

const MODULE_SOURCE = readFileSync(
  fileURLToPath(new URL('./blob-storage.js', import.meta.url)),
  'utf8'
);

// Comments explain what the module deliberately no longer does, and naming the
// retired settings there is the point. The guards below must read code only.
const MODULE_CODE = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('resolveBlobEndpoint', () => {
  it('prefers STORAGE_BLOB_ENDPOINT, which is what Terraform sets', () => {
    expect(
      resolveBlobEndpoint({
        STORAGE_BLOB_ENDPOINT: 'https://hcwmedia.blob.core.windows.net/',
        STORAGE_ACCOUNT_NAME: 'ignored',
      })
    ).toBe('https://hcwmedia.blob.core.windows.net');
  });

  it('falls back to STORAGE_ACCOUNT_NAME', () => {
    expect(resolveBlobEndpoint({ STORAGE_ACCOUNT_NAME: 'hcwmedia' })).toBe(
      'https://hcwmedia.blob.core.windows.net'
    );
  });

  it('preserves a non-public-cloud suffix carried by the endpoint', () => {
    // The account-name fallback can only assume the public cloud. The endpoint
    // form is preferred precisely so sovereign clouds are not silently wrong.
    expect(
      resolveBlobEndpoint({
        STORAGE_BLOB_ENDPOINT: 'https://hcwmedia.blob.core.usgovcloudapi.net',
      })
    ).toBe('https://hcwmedia.blob.core.usgovcloudapi.net');
  });

  it('throws when neither setting is present', () => {
    expect(() => resolveBlobEndpoint({})).toThrow(/STORAGE_BLOB_ENDPOINT/);
  });

  it('does not accept a connection string as configuration', () => {
    expect(() =>
      resolveBlobEndpoint({
        STORAGE_CONNECTION_STRING:
          'DefaultEndpointsProtocol=https;AccountName=hcwmedia;AccountKey=deadbeef==;',
      })
    ).toThrow(/STORAGE_BLOB_ENDPOINT/);
  });
});

describe('resolveAccountName', () => {
  it('uses STORAGE_ACCOUNT_NAME when set', () => {
    expect(resolveAccountName({ STORAGE_ACCOUNT_NAME: 'hcwmedia' })).toBe('hcwmedia');
  });

  it('derives the account from the endpoint host', () => {
    expect(
      resolveAccountName({
        STORAGE_BLOB_ENDPOINT: 'https://hcwmedia.blob.core.windows.net',
      })
    ).toBe('hcwmedia');
  });

  it('throws when it can be derived from neither', () => {
    expect(() => resolveAccountName({})).toThrow(/STORAGE_ACCOUNT_NAME/);
  });
});

describe('getBlobUrl', () => {
  const original = { ...process.env };

  beforeEach(() => {
    resetBlobServiceForTests();
    process.env.STORAGE_BLOB_ENDPOINT = 'https://hcwmedia.blob.core.windows.net';
  });

  afterEach(() => {
    process.env = { ...original };
    resetBlobServiceForTests();
    vi.unstubAllEnvs();
  });

  it('composes from the configured endpoint rather than a hardcoded host', () => {
    expect(getBlobUrl('covers', 'post-1/cover.png')).toBe(
      'https://hcwmedia.blob.core.windows.net/covers/post-1/cover.png'
    );
  });

  it('follows the endpoint into another cloud', () => {
    process.env.STORAGE_BLOB_ENDPOINT = 'https://hcwmedia.blob.core.usgovcloudapi.net';
    expect(getBlobUrl('covers', 'a.png')).toBe(
      'https://hcwmedia.blob.core.usgovcloudapi.net/covers/a.png'
    );
  });
});

describe('uploadBlob overwrite conditions', () => {
  const original = { ...process.env };

  beforeEach(() => {
    uploadSpy.mockClear();
    resetBlobServiceForTests();
    process.env.STORAGE_BLOB_ENDPOINT = 'https://hcwmedia.blob.core.windows.net';
  });

  afterEach(() => {
    process.env = { ...original };
    resetBlobServiceForTests();
  });

  it('turns overwrite:false into If-None-Match: *', async () => {
    // The handler asking for the option is only half the fix; if this module
    // drops it, the caller-chosen path silently replaces a live asset and
    // admin-uploads.test.js still passes against its fake (TODO.md T-307).
    await uploadBlob('covers', 'a/b.png', Buffer.from('x'), 'image/png', {}, { overwrite: false });
    expect(uploadSpy.mock.calls[0][2].conditions).toEqual({ ifNoneMatch: '*' });
  });

  it('sets no condition by default', async () => {
    // The AI-image and migration paths rewrite deterministic keys on purpose.
    await uploadBlob('covers', 'a/b.png', Buffer.from('x'), 'image/png');
    expect(uploadSpy.mock.calls[0][2].conditions).toBeUndefined();
  });

  it('sends the declared content type and the byte length', async () => {
    await uploadBlob('covers', 'a/b.png', Buffer.from('hello'), 'image/png');
    const [content, length, options] = uploadSpy.mock.calls[0];
    expect(content.toString()).toBe('hello');
    expect(length).toBe(5);
    expect(options.blobHTTPHeaders).toEqual({ blobContentType: 'image/png' });
  });
});

describe('no shared-key credential path survives', () => {
  it('never reads a connection string or an account key', () => {
    // infra/ provisions neither, and adding either would put a storage key in
    // app settings — visible in the portal and in Terraform state.
    expect(MODULE_CODE).not.toContain('STORAGE_CONNECTION_STRING');
    expect(MODULE_CODE).not.toContain('STORAGE_ACCOUNT_KEY');
  });

  it('does not import StorageSharedKeyCredential or fromConnectionString', () => {
    expect(MODULE_CODE).not.toContain('StorageSharedKeyCredential');
    expect(MODULE_CODE).not.toContain('fromConnectionString');
  });

  it('authenticates with DefaultAzureCredential, as cosmos-client.js does', () => {
    expect(MODULE_CODE).toContain('DefaultAzureCredential');
  });

  it('signs SAS tokens with a user delegation key', () => {
    expect(MODULE_CODE).toContain('getUserDelegationKey');
  });
});
