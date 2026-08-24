/**
 * Encode raw PCM to MP3.
 *
 * Needed because the Gemini TTS models return **headerless 16-bit mono PCM at
 * 24 kHz** and offer no output-format option. That is 48,000 bytes per second
 * of speech: a nine-minute episode is about 26 MB, and there are five episodes
 * per certification.
 *
 * Storing that is not the problem — serving it is. `readBlobForDelivery`
 * buffers a whole blob into memory and the media route returns it as one
 * response body, with no range support, so a 26 MB episode would hold 26 MB per
 * concurrent listener, bill Function execution for the whole transfer, and make
 * the player wait for the entire file before it could start. That route was
 * built for images with immutable cache headers, and its own header says the
 * arithmetic only works because repeat views never reach the function.
 *
 * At 64 kbps mono the same episode is about 4.5 MB — measured 5.8× on a 24 kHz
 * tone — which is squarely inside what that route was designed to serve, and it
 * makes the stored format identical to the Azure provider's so nothing
 * downstream has to know which provider ran.
 *
 * The encoder is `@breezystack/lamejs`: pure JavaScript, no native build, no
 * dependencies of its own. It is LGPL-3.0 and is imported unmodified, which is
 * the use that licence is written for — but it is the only copyleft dependency
 * in this package, so if `deny-licenses` is ever uncommented in
 * `.github/workflows/dependency-review.yml` (the commented example there denies
 * copyleft) it will need an explicit allowance.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * 64 kbps mono. Speech, not music: this is the rate podcast encoders use for a
 * single voice, and the source is 24 kHz PCM, so a higher rate would spend
 * bytes on bandwidth the source does not contain.
 */
export const MP3_BITRATE_KBPS = 64;

/** One MPEG granule. The encoder expects samples in these blocks. */
const SAMPLES_PER_FRAME = 1152;

/**
 * @param {Buffer} pcm headerless signed 16-bit little-endian mono samples
 * @param {object} [options]
 * @param {number} [options.sampleRate] Hz of the source
 * @param {number} [options.bitrateKbps]
 * @returns {Buffer} an MP3 stream
 */
export function encodePcmToMp3(pcm, { sampleRate = 24000, bitrateKbps = MP3_BITRATE_KBPS } = {}) {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0) {
    throw new Error('encodePcmToMp3: expected a non-empty PCM buffer');
  }
  if (pcm.length % 2 !== 0) {
    // An odd byte count means the buffer is not whole 16-bit samples — a
    // truncated download or a format that is not what was assumed. Reading it
    // anyway produces noise at the end rather than an error.
    throw new Error(`encodePcmToMp3: ${pcm.length} bytes is not a whole number of 16-bit samples`);
  }

  // A Buffer view, not a copy: Int16Array over the same memory. byteOffset
  // matters because a Buffer can be a slice of a larger pool.
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);

  const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
  const parts = [];

  for (let offset = 0; offset < samples.length; offset += SAMPLES_PER_FRAME) {
    const block = samples.subarray(offset, offset + SAMPLES_PER_FRAME);
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length > 0) parts.push(Buffer.from(encoded));
  }

  // Without the flush the last frames stay in the encoder and the episode ends
  // early — the same class of silent truncation the chunking guards against.
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(Buffer.from(tail));

  return Buffer.concat(parts);
}

/** Seconds of audio in a mono 16-bit PCM buffer, for reporting. */
export function pcmDurationSeconds(pcm, sampleRate = 24000) {
  return pcm.length / 2 / sampleRate;
}
