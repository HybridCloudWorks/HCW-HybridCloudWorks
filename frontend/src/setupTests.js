import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { CompressionStream, DecompressionStream, TransformStream } from 'node:stream/web';

expect.extend(matchers);

/**
 * The compression streams a browser has and jsdom does not implement (#645).
 *
 * `parseDrawio.js` inflates draw.io's compressed form with
 * `new DecompressionStream('deflate-raw')` — a web API every target browser
 * ships. jsdom implements none of the three, so under the default `forks` pool
 * the tests only pass because Node's own globals are visible inside the worker.
 * That is an accident of the pool, not a property of the environment: in a
 * `vmThreads` context the globals are absent and the same code throws
 * `ReferenceError`.
 *
 * So the environment states what the browser provides, rather than depending on
 * which pool happens to leak it. Assigned only when missing, so this is a no-op
 * wherever Node has already supplied them, and it never shadows a real
 * implementation.
 */
for (const [name, impl] of [
  ['TransformStream', TransformStream],
  ['CompressionStream', CompressionStream],
  ['DecompressionStream', DecompressionStream],
]) {
  if (typeof globalThis[name] === 'undefined') globalThis[name] = impl;
}

afterEach(() => {
  cleanup();
});
