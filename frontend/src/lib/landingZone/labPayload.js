/**
 * The builder's files as a lab job payload (#672): a POSIX ustar archive of
 * exactly the emitted files under exactly their paths, gzipped, base64 —
 * the `tar` encoding the `terraform-validate` capability accepts
 * (vps-agent/lib/docker-runner.js `decodeTarPayload` and `parseTar`).
 *
 * THE PAYLOAD IS THE DOWNLOAD. The same files the zip holds and the tabs
 * show, byte for byte, registry `source` and `version` lines included: the
 * lab rewrites those to its vendored copies inside the job (ADR 0032
 * decision 5), so nothing here edits a file. labPayload.test.js unpacks the
 * result with the agent's own parser and compares it to `emitFiles`.
 *
 * Only what the agent's parser accepts is written: regular files (typeflag
 * '0'), relative names with no `..`, no links and no extension headers. The
 * emitted paths are flat file names well under ustar's 100 bytes, and a
 * path that is not refuses to build rather than producing an archive the
 * agent would refuse.
 *
 * The tar writer is pure. `buildLabPayload` is async because the compressor
 * is the same lazy `fflate` chunk the zip download uses, fetched only when a
 * visitor presses the button.
 */

const BLOCK = 512;
const encoder = new TextEncoder();

/** An ASCII field, NUL-padded to `length`. */
function writeString(header, offset, length, text) {
  const bytes = encoder.encode(text);
  if (bytes.length > length)
    throw new Error(`tar: ${JSON.stringify(text)} is too long for its field`);
  header.set(bytes, offset);
}

/** A zero-padded octal field of `length` bytes: `length - 1` digits and a NUL. */
function writeOctal(header, offset, length, value) {
  writeString(header, offset, length, value.toString(8).padStart(length - 1, '0'));
}

/** A relative path the agent's `vetTarPath` would accept unchanged, or a throw. */
function checkPath(path) {
  const segments = String(path).split('/');
  const plain = segments.every((s) => s !== '' && s !== '.' && s !== '..');
  if (!plain || path.includes('\\') || path.includes('\0') || encoder.encode(path).length > 100) {
    throw new Error(`tar: refusing path ${JSON.stringify(path)}`);
  }
}

/** One regular file's 512-byte ustar header. */
function fileHeader(path, size) {
  const header = new Uint8Array(BLOCK);
  writeString(header, 0, 100, path);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156); // the checksum field counts as spaces while summed
  header[156] = 0x30; // '0': a regular file
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  const sum = header.reduce((total, byte) => total + byte, 0);
  writeString(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

/**
 * The files as an uncompressed ustar archive.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Uint8Array}
 */
export function tarFiles(files) {
  const parts = [];
  for (const file of files) {
    checkPath(file.path);
    const data = encoder.encode(file.content);
    parts.push(fileHeader(file.path, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(BLOCK * 2)); // the end-of-archive marker
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Bytes as base64, in chunks so a large payload cannot overflow the call stack. */
export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The request body `POST public/labs/submit` takes for these files, and its
 * size as the server measures it (the encoded string's bytes).
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Promise<{ body: { type: string, payload: string, payloadEncoding: string }, bytes: number }>}
 */
export async function buildLabPayload(files) {
  const { gzipSync } = await import('fflate');
  const payload = toBase64(gzipSync(tarFiles(files), { level: 9 }));
  return {
    body: { type: 'terraform-validate', payload, payloadEncoding: 'tar' },
    bytes: payload.length,
  };
}
