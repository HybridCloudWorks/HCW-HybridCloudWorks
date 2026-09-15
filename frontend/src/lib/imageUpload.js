/**
 * The browser half of the admin upload route, `POST cms/uploads/{container}`
 * (functions/src/lib/admin-uploads.js).
 *
 * The same FileReader → base64 → postJSON sequence was written inline in three
 * pages. It lives here so a fourth caller (the Linkie Hub's post image, #501)
 * does not make it four, and so the limits the server enforces are stated once
 * on this side too.
 *
 * Client-side validation is UX, not enforcement: the route checks size, type
 * and extension again, and is the authority. What this adds is a clear message
 * before a 15 MB body is base64-encoded and sent only to be refused.
 */
import { postJSON } from '@/lib/api';

/** The route's decoded-byte cap (`MAX_UPLOAD_BYTES` in admin-uploads.js). */
export const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Types a PUBLICLY SERVED container accepts, each with the extension written
 * into the blob path. The route requires the path's extension to agree with
 * the declared type, so the extension is derived from the type rather than
 * trusted from the filename (`photo.jfif` declared as `image/jpeg` would
 * otherwise be refused with a 415).
 *
 * SVG is absent on purpose: `PUBLIC_DENIED_MEDIA_TYPES` refuses it in every
 * public container, because served anonymously it is a scriptable document.
 */
export const PUBLIC_IMAGE_EXTENSIONS = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
});

/**
 * Why a file cannot go to a public image container, or '' when it can.
 *
 * @param {{ type?: string, size?: number } | null | undefined} file
 * @returns {string}
 */
export function publicImageFileProblem(file) {
  if (!file) return 'No file selected';
  const type = String(file.type || '').toLowerCase();
  if (!PUBLIC_IMAGE_EXTENSIONS[type]) {
    return 'Choose a PNG, JPEG, WebP, GIF or AVIF image';
  }
  if (Number(file.size) > MAX_IMAGE_UPLOAD_BYTES) return 'Images must be 15 MB or smaller';
  return '';
}

/**
 * A file's contents as bare base64 — the data URL with its `data:…;base64,`
 * prefix removed, which is what the route's `dataBase64` expects.
 *
 * @param {Blob} file
 * @returns {Promise<string>}
 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload one file to an admin upload container.
 *
 * The response's `url` is SITE-RELATIVE (`/api/public/media/{container}/…`)
 * for a public container and EMPTY for a private one (`content`,
 * `speakerevents`) — the route returns no URL rather than a dead one. A caller
 * that needs something a browser or a third party can fetch has to upload to
 * a public container and resolve the path; see `resolveMediaUrl`.
 *
 * @param {{ container: string, path: string, file: Blob & { type?: string } }} args
 * @returns {Promise<{ url?: string, blobUrl?: string, container?: string, path?: string }>}
 */
export async function uploadImageFile({ container, path, file }) {
  const dataBase64 = await readFileAsBase64(file);
  return postJSON(`cms/uploads/${container}`, {
    path,
    contentType: file.type || 'image/png',
    dataBase64,
  });
}
