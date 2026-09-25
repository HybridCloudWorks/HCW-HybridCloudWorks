/**
 * The capability allowlist is the only thing that decides what this agent can
 * execute, and its images are what actually run (T-743, T-759).
 *
 * Three properties are pinned here. First, every image is digest-pinned: a
 * tag is mutable and `docker run` pulls before any sandbox flag applies, so a
 * tag-only reference lets whoever can repush that tag change what executes on
 * the VPS with no commit and no review. Second, no capability builds its
 * command by string-concatenating the payload path — the payload reaches the
 * container as a mounted file or tree, and the command is an argv array, so
 * there is no shell to interpolate into. Third (#675), every capability says
 * which payload encodings it accepts, from the runner's own list, and names
 * a payload file whenever one of them is `text`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, IMAGES, RUN_TMPFS } from './capabilities.js';
import { PAYLOAD_ENCODINGS } from './docker-runner.js';

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

      test('declares its payload encodings from the runner list', () => {
        assert.ok(Array.isArray(capability.payloadEncodings), 'no payloadEncodings');
        assert.ok(capability.payloadEncodings.length > 0, 'payloadEncodings is empty');
        for (const encoding of capability.payloadEncodings) {
          assert.ok(
            PAYLOAD_ENCODINGS.includes(encoding),
            `${type} accepts ${encoding}, which the runner does not implement`
          );
        }
      });

      test('names a payload file when it accepts text, and a finite timeout', () => {
        if (capability.payloadEncodings.includes('text')) {
          assert.ok(capability.payloadFileName, 'no payloadFileName');
          assert.ok(!capability.payloadFileName.includes('/'), 'payloadFileName must not be a path');
        }
        assert.equal(typeof capability.timeoutSeconds, 'number');
        assert.ok(capability.timeoutSeconds > 0 && capability.timeoutSeconds <= 600);
      });

      test('builds an argv array, never a shell string', () => {
        const command = capability.buildCommand(`/workspace/${capability.payloadFileName || ''}`);
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

  test('the runner-image capabilities run the scripts the image carries', () => {
    // lab-image/bin/ holds one script per capability; the argv is its name
    // and nothing else, so what the job does is versioned with the image.
    const expected = {
      'terraform-validate': ['hcw-terraform-validate'],
    };
    for (const [type, argv] of Object.entries(expected)) {
      assert.equal(CAPABILITIES[type].image, IMAGES.hcwLabRunner, `${type} is not on the runner image`);
      assert.deepEqual(CAPABILITIES[type].buildCommand('/workspace'), argv);
    }
  });

  test('a capability that writes gets the tmpfs the container user can write to', () => {
    // Docker mounts a tmpfs root-owned; the container runs as 65534. Measured
    // on Docker 29.8: without uid/gid the first write is Permission denied.
    assert.deepEqual(RUN_TMPFS, ['--tmpfs', '/tmp/run:rw,size=64m,uid=65534,gid=65534,mode=0700']);
    for (const type of ['terraform-validate']) {
      assert.deepEqual(CAPABILITIES[type].extraDockerArgs, RUN_TMPFS, `${type} has no writable scratch`);
    }
  });
});
