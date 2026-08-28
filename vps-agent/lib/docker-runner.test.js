/**
 * The sandbox flag list is this component's entire security boundary (T-743).
 *
 * `runInDocker` shells out to `docker run` with a payload that reached this
 * host from the platform API. What keeps that safe is a fixed set of flags —
 * `--network none`, `--cap-drop ALL`, `--user 65534:65534`, `--read-only`,
 * `--security-opt no-new-privileges` — and until this file existed nothing
 * asserted any of them. The `vps-agent` CI job ran `npm ci` and stopped, so an
 * edit dropping `--network none` shipped green.
 *
 * These tests assert the argv `buildDockerArgs` produces, not that Docker
 * behaves — Docker is not installed in CI and must not be. The argv IS the
 * boundary: what this file pins is that the flags are present, that they carry
 * the right values, and that a capability cannot displace them.
 *
 * Node's built-in test runner deliberately: this package's one virtue as a CI
 * check was that its lockfile carries a single dependency, and adding a test
 * framework to the component that holds a certificate on a third-party VPS
 * would trade that away for nothing. `node --test` needs no dependency at all.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDockerArgs, SANDBOX_FLAGS, OUTPUT_CAP_BYTES } from './docker-runner.js';
import { CAPABILITIES } from './capabilities.js';

const LIMITS = { memory: '256m', cpus: '0.5', pidsLimit: 128 };
const CTX = { jobDir: '/tmp/labjob-test', containerName: 'labjob-deadbeef' };

/** Index of a flag in an argv array, or -1. */
const at = (argv, flag) => argv.indexOf(flag);

/**
 * The sandbox contract, written out here rather than imported.
 *
 * This duplication is the point. The first version of this file asserted each
 * flag's value against `SANDBOX_FLAGS` itself, which meant an edit changing
 * `--user 65534:65534` to `--user 0:0` changed the expectation in the same
 * move and the suite stayed green — the exact "test restates the
 * implementation" failure this file's header warns about, caught by mutating
 * the constant and watching nothing fail. These literals are the contract; the
 * module's constant is an implementation of it, and `matches the contract
 * exactly` below is what holds the two together.
 */
const REQUIRED_SANDBOX = [
  ['--network', 'none'],
  ['--read-only', null],
  ['--security-opt', 'no-new-privileges'],
  ['--cap-drop', 'ALL'],
  ['--user', '65534:65534'],
];

describe('the sandbox contract', () => {
  test('SANDBOX_FLAGS matches the contract exactly', () => {
    // Order matters only in that every flag must precede the image, which is
    // asserted per capability below. What matters here is the exact set and
    // the exact values: this is the assertion that fails when someone relaxes
    // the sandbox by editing its own definition.
    assert.deepEqual(
      [...SANDBOX_FLAGS].sort(),
      [...REQUIRED_SANDBOX].sort(),
      'the sandbox flag set or one of its values changed — this is a security boundary, not a default'
    );
  });
});

describe('buildDockerArgs — the sandbox boundary', () => {
  for (const [type, capability] of Object.entries(CAPABILITIES)) {
    describe(`capability ${type}`, () => {
      const argv = buildDockerArgs(capability, CTX, LIMITS);

      test('carries every sandbox flag with its exact value', () => {
        for (const [flag, value] of REQUIRED_SANDBOX) {
          const i = at(argv, flag);
          assert.notEqual(i, -1, `${flag} is missing — the sandbox is weaker than it reads`);
          if (value !== null) {
            assert.equal(argv[i + 1], value, `${flag} carries the wrong value`);
          }
        }
      });

      test('mounts the workspace read-only and nowhere else', () => {
        const mounts = argv.filter((a, i) => argv[i - 1] === '-v' || argv[i - 1] === '--volume');
        assert.deepEqual(mounts, [`${CTX.jobDir}:/workspace:ro`]);
      });

      test('applies the resource limits from config, not from the capability', () => {
        assert.equal(argv[at(argv, '--memory') + 1], LIMITS.memory);
        assert.equal(argv[at(argv, '--cpus') + 1], LIMITS.cpus);
        assert.equal(argv[at(argv, '--pids-limit') + 1], String(LIMITS.pidsLimit));
      });

      test('removes the container and names it for the timeout kill path', () => {
        assert.ok(argv.includes('--rm'));
        assert.equal(argv[at(argv, '--name') + 1], CTX.containerName);
      });

      test('every sandbox flag precedes the image, so none is read as a command argument', () => {
        const image = at(argv, capability.image);
        assert.notEqual(image, -1, 'the image is not in the argv');
        for (const [flag] of REQUIRED_SANDBOX) {
          assert.ok(at(argv, flag) < image, `${flag} appears after the image and is inert`);
        }
      });

      test('the payload path is the only thing derived from job input', () => {
        // The command comes from buildCommand, which receives ONE argument: the
        // in-container payload path this module chose. Nothing from the job's
        // own bytes reaches argv — that is the whole point of writing the
        // payload to a file rather than interpolating it.
        const command = argv.slice(at(argv, capability.image) + 1);
        const expected = capability.buildCommand(`/workspace/${capability.payloadFileName}`);
        assert.deepEqual(command, expected);
      });
    });
  }

  test('refuses a capability that tries to set a sandbox-controlled flag', () => {
    for (const bad of ['--network', '--privileged', '--cap-add', '-v', '--user', '--pid']) {
      assert.throws(
        () =>
          buildDockerArgs(
            { ...CAPABILITIES['shell-echo'], extraDockerArgs: [bad, 'whatever'] },
            CTX,
            LIMITS
          ),
        /sandbox-controlled docker flags/,
        `${bad} was accepted from a capability`
      );
    }
  });

  test('a legitimate extraDockerArgs entry still works', () => {
    // terraform-validate needs a writable tmpfs because `terraform init`
    // writes .terraform/ and the root filesystem is read-only. That is the
    // shape the refusal above must NOT break.
    const argv = buildDockerArgs(CAPABILITIES['terraform-validate'], CTX, LIMITS);
    assert.equal(argv[at(argv, '--tmpfs') + 1], '/tmp/run:rw,size=64m');
    assert.equal(argv[at(argv, '--network') + 1], 'none');
  });

  test('extraDockerArgs land after the sandbox flags and before the image', () => {
    const argv = buildDockerArgs(CAPABILITIES['terraform-validate'], CTX, LIMITS);
    assert.ok(at(argv, '--tmpfs') > at(argv, '--cap-drop'));
    assert.ok(at(argv, '--tmpfs') < at(argv, CAPABILITIES['terraform-validate'].image));
  });
});

describe('output handling', () => {
  test('the output cap is a real bound, not a comment', () => {
    assert.equal(OUTPUT_CAP_BYTES, 64 * 1024);
  });
});
