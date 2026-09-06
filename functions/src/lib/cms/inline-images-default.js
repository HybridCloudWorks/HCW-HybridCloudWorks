/**
 * The real edge for inline-images.js: blob storage through the Function App's
 * managed identity and the guarded upstream fetcher. Kept apart from the pure
 * module so publish.test.js and inline-images.test.js never import
 * @azure/storage-blob, and so the three publish call sites (HTTP, the Telegram
 * approve job, the scheduled publisher) wire the same thing the same way.
 */
import { uploadBlob } from '../blob-storage.js';
import { fetchImage } from '../triggers/fetch-image.js';
import { createInlineImageRehoster } from './inline-images.js';

/** @param {{ log?: Function, warn?: Function }} [log] usually the invocation context */
export function createDefaultInlineImageRehoster(log = console) {
  return createInlineImageRehoster({ storage: { uploadBlob }, fetchImage, log }).rehost;
}
