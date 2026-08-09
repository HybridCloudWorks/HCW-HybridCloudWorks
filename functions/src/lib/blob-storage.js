/**
 * Azure Blob Storage helpers for Azure Functions.
 *
 * Replaces firebase-admin/storage (Cloud Storage / GCS) with @azure/storage-blob.
 * Provides upload, download, delete, and URL generation for blog covers,
 * cert badges, speaker images, and AI-generated content.
 *
 * Authentication is managed identity via DefaultAzureCredential — the same
 * posture as lib/cosmos-client.js, and the one the infrastructure actually
 * provisions. `infra/main.tf` grants the Function App identity Storage Blob
 * Data Contributor on the media account and sets STORAGE_ACCOUNT_NAME and
 * STORAGE_BLOB_ENDPOINT; it has never set a connection string or an account
 * key, and it must not, because a key in app settings is a key in the portal
 * and in Terraform state.
 *
 * This module previously required STORAGE_CONNECTION_STRING and threw without
 * it, which made every upload and every gallery delete fail on a deployed
 * app — invisibly, because the one test suite covering uploads injected a fake
 * `uploadBlob` and so never reached this file (TODO.md T-104).
 *
 * Required app settings: STORAGE_BLOB_ENDPOINT (or STORAGE_ACCOUNT_NAME)
 * Required RBAC on the Function App MI: Storage Blob Data Contributor, plus
 * Storage Blob Delegator for `generateSasUrl`.
 */

import {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

let blobServiceClient = null;

/**
 * Resolve the blob service endpoint from configuration.
 *
 * Split out and exported because it is the part with the rules in it, and it
 * is pure — the house style in this directory is a testable pure core over a
 * thin client-construction shell (see `planPatch` in cosmos-client.js).
 *
 * STORAGE_BLOB_ENDPOINT is what Terraform sets, and it is preferred because it
 * carries the correct suffix for whichever cloud the account lives in.
 * STORAGE_ACCOUNT_NAME is the fallback, and only then is the public-cloud
 * suffix assumed.
 *
 * @param {Record<string, string|undefined>} [env] - defaults to process.env
 * @returns {string} Endpoint with no trailing slash.
 * @throws {Error} When neither setting is present.
 */
export function resolveBlobEndpoint(env = process.env) {
  const endpoint = (env.STORAGE_BLOB_ENDPOINT || '').trim();
  if (endpoint) return endpoint.replace(/\/+$/, '');

  const accountName = (env.STORAGE_ACCOUNT_NAME || '').trim();
  if (accountName) return `https://${accountName}.blob.core.windows.net`;

  throw new Error('Missing STORAGE_BLOB_ENDPOINT (or STORAGE_ACCOUNT_NAME) environment variable');
}

/**
 * Resolve the storage account name, which the user-delegation SAS signature
 * requires separately from the endpoint.
 *
 * @param {Record<string, string|undefined>} [env] - defaults to process.env
 * @returns {string}
 * @throws {Error} When it can be derived from neither setting.
 */
export function resolveAccountName(env = process.env) {
  const accountName = (env.STORAGE_ACCOUNT_NAME || '').trim();
  if (accountName) return accountName;

  const endpoint = (env.STORAGE_BLOB_ENDPOINT || '').trim();
  if (endpoint) {
    const host = new URL(endpoint).hostname;
    const [first] = host.split('.');
    if (first) return first;
  }

  throw new Error('Missing STORAGE_ACCOUNT_NAME environment variable');
}

/**
 * Initialize or return the singleton Blob Service client.
 */
function getBlobService() {
  if (blobServiceClient) return blobServiceClient;

  blobServiceClient = new BlobServiceClient(resolveBlobEndpoint(), new DefaultAzureCredential());
  return blobServiceClient;
}

/**
 * Drop the memoized client. Tests only — nothing in the request path should
 * need to rebuild it, and the credential is safe to reuse across invocations.
 */
export function resetBlobServiceForTests() {
  blobServiceClient = null;
}

/**
 * Get a container client.
 * @param {string} containerName - e.g. 'blogs', 'covers', 'certifications'
 */
export function getContainerClient(containerName) {
  return getBlobService().getContainerClient(containerName);
}

/**
 * Upload a buffer or stream to Blob Storage.
 * Equivalent to: bucket.file(path).save(buffer, { contentType })
 *
 * @param {string} containerName - Blob container name
 * @param {string} blobName - Blob path (e.g. 'blogId/images/cover.png')
 * @param {Buffer|ReadableStream} content - File content
 * @param {string} contentType - MIME type (e.g. 'image/png')
 * @param {object} [metadata] - Custom metadata key-value pairs
 * @returns {Promise<string>} URL of the uploaded blob
 */
export async function uploadBlob(containerName, blobName, content, contentType, metadata = {}) {
  const containerClient = getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: contentType },
    metadata,
  });

  return blockBlobClient.url;
}

/**
 * Upload a readable stream to Blob Storage.
 * For large files (e.g. high-res Imagen-4 PNGs).
 *
 * @param {string} containerName
 * @param {string} blobName
 * @param {ReadableStream} stream
 * @param {number} streamLength
 * @param {string} contentType
 * @returns {Promise<string>} Blob URL
 */
export async function uploadBlobFromStream(
  containerName,
  blobName,
  stream,
  streamLength,
  contentType
) {
  const containerClient = getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadStream(stream, streamLength, undefined, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return blockBlobClient.url;
}

/**
 * Download a blob as a buffer.
 * Equivalent to: bucket.file(path).download()
 *
 * @param {string} containerName
 * @param {string} blobName
 * @returns {Promise<Buffer>}
 */
export async function downloadBlob(containerName, blobName) {
  const containerClient = getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);
  const downloadResponse = await blobClient.download(0);

  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Read a blob for HTTP delivery: bytes plus the metadata a response needs.
 *
 * Separate from `downloadBlob` because the delivery path needs the content type
 * and the ETag, and needs a missing blob to be a `null` rather than a throw —
 * a 404 on an image URL is an ordinary outcome, not an error to log.
 *
 * @param {string} containerName
 * @param {string} blobName
 * @returns {Promise<{body: Buffer, contentType: string, etag: string, contentLength: number}|null>}
 */
export async function readBlobForDelivery(containerName, blobName) {
  const containerClient = getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);

  let response;
  try {
    response = await blobClient.download(0);
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === 'BlobNotFound') return null;
    throw error;
  }

  const chunks = [];
  for await (const chunk of response.readableStreamBody) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  return {
    body,
    contentType: response.contentType || 'application/octet-stream',
    etag: response.etag || '',
    contentLength: body.length,
  };
}

/**
 * Delete a blob.
 * Equivalent to: bucket.file(path).delete()
 *
 * @param {string} containerName
 * @param {string} blobName
 */
export async function deleteBlob(containerName, blobName) {
  const containerClient = getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);
  await blobClient.deleteIfExists();
}

/**
 * Get the direct URL of a blob.
 *
 * Whether that URL is anonymously readable depends on the container's access
 * level AND on the account's `allow_nested_items_to_be_public`, which is a
 * master override: with it false, a container declared `container_access_type
 * = "blob"` still answers 409 (TODO.md T-105). Do not assume this URL is
 * public without checking both.
 *
 * @param {string} containerName
 * @param {string} blobName
 * @returns {string}
 */
export function getBlobUrl(containerName, blobName) {
  return `${resolveBlobEndpoint()}/${containerName}/${blobName}`;
}

/**
 * Generate a time-limited SAS URL for a blob.
 * For blobs in private containers that need temporary access.
 *
 * This is a **user-delegation** SAS, signed with a key obtained from Entra ID
 * using the Function App's managed identity. The previous implementation
 * signed with STORAGE_ACCOUNT_KEY, which nothing provisions and which would
 * have put an account key in app settings if anything did.
 *
 * Requires the Storage Blob Delegator role on the identity, in addition to
 * Storage Blob Data Contributor — Contributor alone cannot mint delegation
 * keys, and the failure is a 403 at signing time, not at read time.
 *
 * Async, unlike the shared-key version it replaces: obtaining the delegation
 * key is a network call.
 *
 * @param {string} containerName
 * @param {string} blobName
 * @param {number} [expiresInMinutes=60] - SAS token expiry
 * @returns {Promise<string>} Blob URL with SAS token
 */
export async function generateSasUrl(containerName, blobName, expiresInMinutes = 60) {
  const accountName = resolveAccountName();
  const service = getBlobService();

  // Backdated a little: the delegation key and the SAS are both rejected if
  // their start time is in the future relative to the service's clock.
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const userDelegationKey = await service.getUserDelegationKey(startsOn, expiresOn);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      protocol: SASProtocol.Https,
      startsOn,
      expiresOn,
    },
    userDelegationKey,
    accountName
  ).toString();

  return `${getBlobUrl(containerName, blobName)}?${sasToken}`;
}

/**
 * List blobs in a container with a prefix filter.
 * Equivalent to: bucket.getFiles({ prefix })
 *
 * @param {string} containerName
 * @param {string} [prefix] - Filter blobs by path prefix
 * @returns {Promise<Array<{name: string, url: string, contentType: string, size: number}>>}
 */
export async function listBlobs(containerName, prefix = '') {
  const containerClient = getContainerClient(containerName);
  const blobs = [];

  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    blobs.push({
      name: blob.name,
      url: getBlobUrl(containerName, blob.name),
      contentType: blob.properties.contentType,
      size: blob.properties.contentLength,
      lastModified: blob.properties.lastModified,
    });
  }

  return blobs;
}
