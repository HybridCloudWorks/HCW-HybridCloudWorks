/**
 * The capability allowlist is the only thing that decides what this agent can
 * execute, and its images are what actually run (T-743, T-759).
 *
 * Two properties are pinned here. First, every image is digest-pinned: a tag
 * is mutable and `docker run` pulls before any sandbox flag applies, so a
 * tag-only reference lets whoever can repush that tag change what executes on
 * the VPS with no commit and no review. Second, no capability builds its
 * command by string-concatenating the payload path — the payload reaches the
 * container as a mounted file, and the command is an argv array, so there is
 * no shell to interpolate into.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, IMAGES } from './capabilities.js';

const DIGEST = /@sha256:[0-9a-f]{64}$/;

describe('capability allowlist', () => {
  test('is not empty — a parse failure here would pass every other check', () => {
    assert.ok(Object.keys(CAPABILITIES).length > 0);
  });

  for (const [type, capability] of Object.entries(CAPABILITIES)) {
    describe(type, () => {
      test('pins its image by digest', () => {
        assert.match(
          capability.image,
          DIGEST,
          `${type} references an image by tag alone; a repushed tag would change what runs`
        );
      });

      test('declares a payload file name and a finite timeout', () => {
        assert.ok(capability.payloadFileName, 'no payloadFileName');
        assert.ok(!capability.payloadFileName.includes('/'), 'payloadFileName must not be a path');
        assert.equal(typeof capability.timeoutSeconds, 'number');
        assert.ok(capability.timeoutSeconds > 0 && capability.timeoutSeconds <= 600);
      });

      test('builds an argv array, never a shell string', () => {
        const command = capability.buildCommand(`/workspace/${capability.payloadFileName}`);
        assert.ok(Array.isArray(command), 'buildCommand must return an array');
        assert.ok(command.length > 0);
        for (const arg of command) {
          assert.equal(typeof arg, 'string');
        }
      });

      test('ignores anything but the path it is handed', () => {
        // buildCommand receives exactly one input — the in-container payload
        // path this repository chose. Handing it a hostile-looking string must
        // change at most that one argv slot, never the shape of the command.
        const clean = capability.buildCommand('/workspace/p');
        const hostile = capability.buildCommand('/workspace/p; rm -rf /');
        assert.equal(clean.length, hostile.length, 'the command shape depends on its argument');
        const differing = clean.filter((arg, i) => arg !== hostile[i]);
        assert.ok(
          differing.length <= 1,
          'more than one argv slot varies with the payload path — something is concatenating'
        );
      });
    });
  }

  test('every declared image is reachable from the IMAGES map', () => {
    // The map is what a digest update edits. A capability holding a literal
    // would be missed by that edit and silently keep the old image.
    const declared = new Set(Object.values(IMAGES));
    for (const [type, capability] of Object.entries(CAPABILITIES)) {
      assert.ok(
        declared.has(capability.image),
        `${type} holds a literal image reference instead of an IMAGES entry`
      );
    }
  });
});
