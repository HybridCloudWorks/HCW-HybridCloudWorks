import { describe, it, expect } from 'vitest';
import { measureImage, sha256Hex } from './measure.js';

/** A buffer of `size` zero bytes with `writes` applied: [offset, bytes]. */
function bytes(size, writes) {
  const buffer = Buffer.alloc(size);
  for (const [offset, data] of writes) Buffer.from(data).copy(buffer, offset);
  return buffer;
}

const png = (width, height) => {
  const buffer = bytes(32, [[0, Buffer.from('89504e470d0a1a0a', 'hex')]]);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const gif = (width, height) => {
  const buffer = bytes(16, [[0, 'GIF89a']]);
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
};

const webp = (chunk, body) =>
  bytes(40, [
    [0, 'RIFF'],
    [8, 'WEBP'],
    [12, chunk],
    [20, body],
  ]);

const jpeg = (width, height) => {
  // SOI, then an APP0 segment of length 16, then SOF0 with the frame size.
  const buffer = Buffer.alloc(64, 0);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  buffer.writeUInt16BE(16, 4);
  const sof = 2 + 2 + 16;
  buffer[sof] = 0xff;
  buffer[sof + 1] = 0xc0;
  buffer.writeUInt16BE(17, sof + 2);
  buffer[sof + 4] = 8;
  buffer.writeUInt16BE(height, sof + 5);
  buffer.writeUInt16BE(width, sof + 7);
  return buffer;
};

describe('measureImage', () => {
  it('reads a PNG header by magic bytes, and by content type', () => {
    expect(measureImage(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(measureImage(png(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
  });

  it('reads a GIF header', () => {
    expect(measureImage(gif(300, 200), 'image/gif')).toEqual({ width: 300, height: 200 });
  });

  it('reads each of the three WebP bitstreams', () => {
    const vp8 = webp('VP8 ', Buffer.alloc(0));
    vp8.writeUInt16LE(800 | 0x4000, 26);
    vp8.writeUInt16LE(600, 28);
    expect(measureImage(vp8, 'image/webp')).toEqual({ width: 800, height: 600 });

    // VP8L: 14-bit width-1 and height-1 packed little-endian after the signature byte.
    const vp8l = webp('VP8L', Buffer.alloc(0));
    const w = 1024 - 1;
    const h = 768 - 1;
    vp8l[21] = w & 0xff;
    vp8l[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
    vp8l[23] = (h >> 2) & 0xff;
    vp8l[24] = (h >> 10) & 0x0f;
    expect(measureImage(vp8l, 'image/webp')).toEqual({ width: 1024, height: 768 });

    const vp8x = webp('VP8X', Buffer.alloc(0));
    vp8x.writeUIntLE(1280 - 1, 24, 3);
    vp8x.writeUIntLE(720 - 1, 27, 3);
    expect(measureImage(vp8x, 'image/webp')).toEqual({ width: 1280, height: 720 });
  });

  it('walks JPEG segments to the start-of-frame', () => {
    expect(measureImage(jpeg(1600, 900), 'image/jpeg')).toEqual({ width: 1600, height: 900 });
    expect(measureImage(jpeg(32, 16))).toEqual({ width: 32, height: 16 });
  });

  it('answers null for an unknown format, a truncated header, or no bytes', () => {
    expect(measureImage(Buffer.from('not an image at all'), 'text/plain')).toBeNull();
    expect(measureImage(png(1, 1).subarray(0, 20))).toBeNull();
    expect(measureImage(webp('VP8 ', Buffer.alloc(0)).subarray(0, 24), 'image/webp')).toBeNull();
    expect(measureImage(webp('XXXX', Buffer.alloc(0)), 'image/webp')).toBeNull();
    expect(measureImage(null)).toBeNull();
    expect(measureImage(Buffer.alloc(4))).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('is the hex sha256 of the bytes', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
