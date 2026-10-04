/**
 * Image bytes → what the gallery records about them: pixel dimensions read
 * from the container header, and the sha256 that is the duplicate key
 * (ADR 0033 §4). Split out of gallery-images.js in PR #841 so each header
 * layout is one small reader, chosen from a table by content type or magic
 * bytes, rather than one function that knew all four.
 */
import { createHash } from 'node:crypto';

/** Hex sha256 of the bytes — the duplicate key. */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const PNG_MAGIC = '89504e470d0a1a0a';

function readPng(buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readGif(buffer) {
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

/** RIFF `WEBP` holds one of three bitstreams, each with its own size field. */
const WEBP_CHUNK_READERS = Object.freeze({
  'VP8 ': (buffer) => ({
    width: buffer.readUInt16LE(26) & 0x3fff,
    height: buffer.readUInt16LE(28) & 0x3fff,
  }),
  VP8L: (buffer) => {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  },
  VP8X: (buffer) => ({
    width: 1 + buffer.readUIntLE(24, 3),
    height: 1 + buffer.readUIntLE(27, 3),
  }),
});

function readWebp(buffer) {
  if (buffer.length < 30) return null;
  const chunk = buffer.slice(12, 16).toString('ascii');
  const read = Object.hasOwn(WEBP_CHUNK_READERS, chunk) ? WEBP_CHUNK_READERS[chunk] : null;
  return read ? read(buffer) : null;
}

// SOF0..SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
const JPEG_NOT_SOF = new Set([0xc4, 0xc8, 0xcc]);
const isJpegSof = (marker) => marker >= 0xc0 && marker <= 0xcf && !JPEG_NOT_SOF.has(marker);
// Markers with no length field: SOI, TEM and the restart markers RST0..RST7.
const isJpegBareMarker = (marker) =>
  marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

/** Walk the JPEG segments to the first start-of-frame, which carries the size. */
function readJpeg(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (isJpegBareMarker(marker)) {
      offset += 2;
      continue;
    }
    if (isJpegSof(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

/**
 * The formats measured, in the order they are tried: a content type that
 * names the format, or the format's own signature in the first bytes.
 */
const IMAGE_READERS = Object.freeze([
  {
    matches: (type, buffer) =>
      type.includes('png') || buffer.slice(0, 8).toString('hex') === PNG_MAGIC,
    read: readPng,
  },
  {
    matches: (type, buffer) =>
      type.includes('gif') || buffer.slice(0, 3).toString('ascii') === 'GIF',
    read: readGif,
  },
  {
    matches: (type, buffer) =>
      type.includes('webp') || buffer.slice(8, 12).toString('ascii') === 'WEBP',
    read: readWebp,
  },
  {
    matches: (type, buffer) =>
      type.includes('jpeg') || type.includes('jpg') || (buffer[0] === 0xff && buffer[1] === 0xd8),
    read: readJpeg,
  },
]);

/**
 * Pixel dimensions from the first bytes of a PNG, GIF, JPEG or WebP, or null
 * when the format is not one of those or the header is truncated. No decoder
 * dependency: these are the header layouts, and a wrong answer here only
 * costs a missing "1920 × 1080" on a card.
 */
export function measureImage(buffer, contentType = '') {
  if (!buffer || typeof buffer.length !== 'number' || buffer.length < 10) return null;
  const type = String(contentType || '').toLowerCase();
  try {
    const reader = IMAGE_READERS.find(({ matches }) => matches(type, buffer));
    return reader ? reader.read(buffer) : null;
  } catch {
    return null;
  }
}
