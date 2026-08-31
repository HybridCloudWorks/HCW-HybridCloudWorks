import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPAWNING THE SCRIPT FOR REAL, because the thing under test is whether it runs
// at all. Every other test in this suite imports the module, which exercises the
// exports and says nothing about the entry-point guard. A guard that stops
// matching makes the process exit 0 having checked nothing — a monitor that
// reports healthy because it never executed. That is invisible to an
// import-based test and to CI, and it is exactly the failure mode this file's
// shape assertion exists to prevent one layer up.
const script = join(dirname(fileURLToPath(import.meta.url)), 'check-unresolved-secrets.mjs');

function run(input, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [script], {
      input,
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('the CLI actually executes', () => {
  it('exits 0 and says so when every reference resolves', () => {
    const got = run('{"properties":{"keyToReferenceStatuses":{"A":{"status":"Resolved"}}}}');
    expect(got.code).toBe(0);
    expect(got.stdout).toContain('are resolving');
  });

  // The guard's failure mode is silence: main() never runs, nothing is read,
  // and the process exits 0. Asserting a NON-zero code on bad input is what
  // separates "checked and healthy" from "never ran".
  it('exits 1 when a reference is not resolving', () => {
    const got = run(
      '{"properties":{"keyToReferenceStatuses":{"A":{"status":"SecretNotFound"}}}}',
    );
    expect(got.code).toBe(1);
    expect(got.stderr).toContain('NOT resolving');
  });

  it('exits 2 when the payload shape is not understood', () => {
    const got = run('{"nope":true}');
    expect(got.code).toBe(2);
    expect(got.stderr).toContain('nothing about the references is known');
  });

  it('exits 2 on empty stdin rather than reporting health', () => {
    const got = run('');
    expect(got.code).toBe(2);
  });

  // Invoked from the repository root as `node scripts/check-unresolved-secrets.mjs`,
  // which is how the workflow calls it and the case the review raised.
  it('runs when invoked by a relative path from a different cwd', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const got = (() => {
      try {
        const stdout = execFileSync(
          process.execPath,
          ['scripts/check-unresolved-secrets.mjs'],
          {
            input: '{"properties":{"keyToReferenceStatuses":{"A":{"status":"Resolved"}}}}',
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        return { code: 0, stdout };
      } catch (err) {
        return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    })();
    expect(got.code).toBe(0);
    expect(got.stdout).toContain('are resolving');
  });
});
