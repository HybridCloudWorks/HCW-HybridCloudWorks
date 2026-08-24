/**
 * PCM → MP3.
 *
 * This exists because the delivery route buffers a whole blob into memory and
 * returns it as one response body, so the 48 KB/s of PCM the Gemini API returns
 * would put a 26 MB episode through a Function invocation per listener. The
 * compression ratio is therefore an assertion, not an incidental property.
 */
import { describe, it, expect } from 'vitest';
import { encodePcmToMp3, pcmDurationSeconds, MP3_BITRATE_KBPS } from './mp3.js';

/** A 24 kHz tone — real speech compresses at least this well. */
function tone(seconds, sampleRate = 24000) {
  const samples = new Int16Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.round(Math.sin(i / 20) * 8000);
  }
  return Buffer.from(samples.buffer);
}

describe('encodePcmToMp3', () => {
  it('produces a stream that starts with an MPEG frame sync', () => {
    const mp3 = encodePcmToMp3(tone(1));
    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);
  });

  it('is several times smaller than the PCM it encoded', () => {
    // The whole reason this module exists. 64 kbps mono against 24 kHz 16-bit
    // mono is a 6x reduction on paper; anything close to 1x means the encoder
    // silently did nothing.
    const pcm = tone(5);
    const mp3 = encodePcmToMp3(pcm);
    expect(pcm.length / mp3.length).toBeGreaterThan(4);
  });

  it('encodes the whole input, including the final partial frame', () => {
    // Without the flush the last frames stay inside the encoder and the
    // episode ends early — the same silent truncation the Azure chunking
    // guards against, arriving by a different route.
    const short = encodePcmToMp3(tone(1));
    const long = encodePcmToMp3(tone(4));
    expect(long.length).toBeGreaterThan(short.length * 3);
  });

  it('handles a buffer that is not a whole number of frames', () => {
    // 1152 samples per frame; this is deliberately not a multiple.
    const samples = new Int16Array(1152 * 3 + 17).fill(1234);
    const mp3 = encodePcmToMp3(Buffer.from(samples.buffer));
    expect(mp3.length).toBeGreaterThan(0);
  });

  it('encodes a Buffer that is a slice of a larger pool', () => {
    // Buffer.subarray shares memory with a byteOffset, and an Int16Array built
    // without honouring that offset reads the wrong bytes — silence, or noise.
    const pcm = tone(1);
    const padded = Buffer.concat([Buffer.alloc(8), pcm]);
    const slice = padded.subarray(8);

    expect(encodePcmToMp3(slice).equals(encodePcmToMp3(pcm))).toBe(true);
  });

  it('honours the sample rate it is given', () => {
    const samples = tone(2, 16000);
    expect(encodePcmToMp3(samples, { sampleRate: 16000 }).length).toBeGreaterThan(0);
  });

  it('refuses an empty buffer rather than emitting an unplayable file', () => {
    expect(() => encodePcmToMp3(Buffer.alloc(0))).toThrow(/non-empty PCM buffer/);
    expect(() => encodePcmToMp3(null)).toThrow(/non-empty PCM buffer/);
  });

  it('refuses an odd byte count, which is not whole 16-bit samples', () => {
    // A truncated download reads as noise at the end rather than as an error.
    expect(() => encodePcmToMp3(Buffer.alloc(101))).toThrow(/not a whole number of 16-bit samples/);
  });

  it('encodes at the declared bitrate', () => {
    expect(MP3_BITRATE_KBPS).toBe(64);
    const mp3 = encodePcmToMp3(tone(4));
    // 64 kbps = 8 KB/s; allow generous slack for headers and the final frame.
    const impliedKbps = (mp3.length * 8) / 1000 / 4;
    expect(impliedKbps).toBeGreaterThan(48);
    expect(impliedKbps).toBeLessThan(80);
  });
});

describe('pcmDurationSeconds', () => {
  it('converts a mono 16-bit buffer to seconds', () => {
    expect(pcmDurationSeconds(tone(3))).toBeCloseTo(3, 5);
    expect(pcmDurationSeconds(tone(1, 16000), 16000)).toBeCloseTo(1, 5);
  });
});
