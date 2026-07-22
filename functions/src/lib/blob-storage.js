/**
 * Azure Blob Storage helpers for Azure Functions.
 *
 * Replaces firebase-admin/storage (Cloud Storage / GCS) with @azure/storage-blob.
 * Provides upload, download, delete, and URL generation for blog covers,
 * cert badges, speaker images, and AI-generated content.
 */

import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from '@azure/storage-blob';

let blobServiceClient = null;

/**
 * Initialize or return the singleton Blob Service client.
 */
function getBlobService() {
  if (blobServiceClient) return blobServiceClient;

  const connectionString = process.env.STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('Missing STORAGE_CONNECTION_STRING environment variable');
  }

  blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient;
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
 * @returns {Promise<string>} Public URL of the uploaded blob
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
 * @returns {Promise<string>} Public URL
 */
export async function uploadBlobFromStream(containerName, blobName, stream, streamLength, contentType) {
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
 * Get the public URL of a blob.
 * For public containers (container_access_type = 'blob'), the URL is directly accessible.
 *
 * @param {string} containerName
 * @param {string} blobName
 * @returns {string}
 */
export function getBlobUrl(containerName, blobName) {
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}`;
}

/**
 * Generate a time-limited SAS URL for a blob.
 * For blobs in private containers that need temporary access.
 *
 * @param {string} containerName
 * @param {string} blobName
 * @param {number} [expiresInMinutes=60] - SAS token expiry
 * @returns {string} Blob URL with SAS token
 */
export function generateSasUrl(containerName, blobName, expiresInMinutes = 60) {
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;

  if (!accountName || !accountKey) {
    throw new Error('Missing STORAGE_ACCOUNT_NAME or STORAGE_ACCOUNT_KEY');
  }

  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
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
