/**
 * The non-rendering half of UploadPanel (ADR 0033): the blob path and record
 * for one queued file, the sequential upload of a queue, and the sentences
 * the panel reports with. Pure where it can be, so it is tested as itself.
 *
 * Uploads record what the browser can measure (pixel size, bytes, type,
 * sha256) so the gallery can show dimensions and flag duplicates. The
 * container is `covers` (#602): the only one the media route serves, so the
 * record has a URL something can display.
 */
import { postJSON } from '@/lib/api';
import {
  imageExtensionFor,
  publicImageFileProblem,
  PUBLIC_IMAGE_EXTENSIONS,
  readImageDimensions,
  sha256HexOf,
  uploadImageFile,
} from '@/lib/imageUpload';

export const GALLERY_CONTAINER = 'covers';
export const GALLERY_ACCEPT = Object.keys(PUBLIC_IMAGE_EXTENSIONS).join(',');

/** The upload options the panel edits, with their starting values. */
export const DEFAULT_UPLOAD_OPTIONS = Object.freeze({
  folder: 'default',
  provider: '',
  slot: '',
  tags: '',
  rename: '',
  pullTags: false,
});

function slugifyFilename(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `a, B ,,c` → `['a', 'b', 'c']`. */
export function parseTagList(tags) {
  return String(tags || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

/** The blob path and record fields for one queued file. */
export function buildGalleryUploadData({
  file,
  index,
  provider,
  slot,
  tags,
  rename,
  pullTags,
  folder,
}) {
  if (!file || !file.name) throw new Error(`Invalid file at index ${index}`);
  // From the DECLARED TYPE, not the filename (#631): the route requires the
  // path's extension to agree with the content type.
  const extension = imageExtensionFor(file);
  if (!extension) throw new Error(`"${file.name}" is not a type this gallery can store.`);
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'uploaded-image';
  const extractedTags =
    pullTags && baseName.includes('-')
      ? baseName
          .split('-')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];
  const parts = [provider, slot, ...tags.slice(0, 2)].filter(Boolean).map((p) => p.toLowerCase());
  const filenameBase = rename.trim() || (parts.length ? parts.join('-') : baseName);
  const safeName = (slugifyFilename(filenameBase) || 'uploaded-image').toLowerCase();
  const stamp = Date.now();
  const randomId = Math.random().toString(36).slice(2, 10);
  const fileNumber = String(index + 1).padStart(3, '0');
  return {
    extension,
    storagePath: `image-gallery/manual/${stamp}-${randomId}-${safeName}-${fileNumber}.${extension}`,
    allTags: [...new Set([...extractedTags, ...tags])],
    title: baseName,
    folder: (folder || 'default').toLowerCase(),
  };
}

export async function uploadOne(file, index, options) {
  const data = buildGalleryUploadData({ file, index, ...options });
  const [dimensions, sha256] = await Promise.all([readImageDimensions(file), sha256HexOf(file)]);
  const uploaded = await uploadImageFile({
    container: GALLERY_CONTAINER,
    path: data.storagePath,
    file,
  });
  const imageUrl = uploaded.url;
  // Refuse to record an image nothing can display (#602): a private container
  // answers 200 with url:'' and the row would look fine while resolving to
  // nothing everywhere it was used.
  if (!imageUrl) {
    throw new Error(
      `Upload succeeded but returned no public URL (container '${GALLERY_CONTAINER}'). The gallery record was not created.`
    );
  }
  await postJSON('createManualGalleryImageRecord', {
    articleId: 'manual-upload',
    imageUrl,
    provider: options.provider,
    title: data.title,
    altText: data.title,
    slot: options.slot,
    storagePath: `${GALLERY_CONTAINER}/${data.storagePath}`,
    customTags: data.allTags,
    folder: data.folder,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    bytes: file.size,
    format: data.extension,
    sha256,
    license: 'owned',
  });
  return file.name;
}

/**
 * Upload a queue in order, skipping files the public container would refuse.
 * Returns the names uploaded and a `name: reason` line per file rejected.
 * Sequential on purpose: each upload is a full base64 body capped at 15 MB;
 * a queue fired at once is a memory spike on the Function host.
 */
export async function runUploadQueue(files, options, upload = uploadOne) {
  const uploaded = [];
  const rejected = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const problem = publicImageFileProblem(file);
    if (problem) {
      rejected.push(`${file.name}: ${problem}`);
      continue;
    }
    uploaded.push(await upload(file, index, options));
  }
  return { uploaded, rejected };
}

export function uploadedMessage(count, folder) {
  const noun = count === 1 ? 'image' : 'images';
  return `${count} ${noun} uploaded to the ${folder} folder.`;
}

export function importedMessage(res, folder) {
  const size = res.width && res.height ? `${res.width} × ${res.height} ` : '';
  return `Imported ${size}${String(res.format || '').toUpperCase()} into the ${folder} folder.`;
}

export function errorText(err) {
  return err?.message || err;
}

/**
 * 409 is the server saying the bytes or URL are already here (the message
 * names the record); anything else is a failed import.
 */
export function importProblem(err) {
  if (err?.status === 409) {
    return `${err.message}. Search the gallery for it instead of importing twice.`;
  }
  return `Import failed: ${errorText(err)}`;
}
