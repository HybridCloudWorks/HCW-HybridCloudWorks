/**
 * The timer verifier's skip matcher, pinned against the log lines it exists to
 * tell apart.
 *
 * ## The failure this catches
 *
 * `cutover/05-verify-timer.ps1` decides whether a timer invocation RAN or was
 * SKIPPED by looking for the master-flag line in its traces. It first asked
 * Log Analytics for `Message has 'disabled'`, on the assumption that the master
 * skip is the only timer log carrying the word.
 *
 * It is not. `functions/src/lib/timers/forge-scheduled.js` writes
 * `[forgeScheduled] auto-forge disabled, skipping run.` from a handler that
 * RAN, reached its own feature switch, and found it off. A bare `has 'disabled'`
 * files that invocation as skipped — reporting an ARMED timer as unarmed, on
 * one of the sixteen timers T-518 still has to arm, at the exact moment an
 * operator is deciding whether the arming worked. Caught in review on
 * 2026-08-30, one merge after the same script was found reporting every skip
 * twice.
 *
 * ## Why it is asserted from BOTH sides
 *
 * Pinning only the regex would let someone reword either log line and leave the
 * matcher quietly wrong — the test would still pass against strings that no
 * longer exist. So the messages are read out of the JavaScript that emits them
 * and the pattern is read out of the PowerShell that consumes it, and the two
 * are checked against each other. Change any of the three and this fails,
 * naming the other two.
 *
 * ## What is NOT covered here, and where it lives
 *
 * Syntax and file encoding are `scripts/validate-powershell.ps1`, run by the
 * Repository Policy workflow where `pwsh` is guaranteed. Node cannot parse
 * PowerShell and should not pretend to. This file covers the one thing that is
 * pure text on both sides and therefore testable without either runtime.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const VERIFY_TIMER = join(ROOT, 'scripts/cutover/05-verify-timer.ps1');
const SCHEDULERS = join(ROOT, 'functions/src/functions/schedulers.js');
const FORGE_SCHEDULED = join(ROOT, 'functions/src/lib/timers/forge-scheduled.js');
const JOBS_SWEEPER = join(ROOT, 'functions/src/functions/jobs-sweeper.js');

function read(path) {
  const text = readFileSync(path, 'utf8');
  // A path that resolves to something tiny would let every assertion below
  // pass by matching nothing against nothing.
  if (text.length < 500) throw new Error(`${path} is ${text.length} bytes — the path is wrong.`);
  return text;
}

/** The RE2 pattern out of the KQL verbatim literal the script sends to the workspace. */
function skipPattern() {
  const source = read(VERIFY_TIMER);
  const match = source.match(/matches regex @'([^']+)'/);
  if (!match) {
    throw new Error(
      `No "matches regex @'...'" literal in ${VERIFY_TIMER}. If the skip match moved, move this test with it.`
    );
  }
  return match[1];
}

/**
 * The master-flag skip as it reaches Application Insights.
 *
 * schedulers.js writes it as a template literal, so the emitted string is the
 * template with `${name}` resolved. Reading the template rather than hardcoding
 * the text is the point: reword it there and this fails here.
 */
function masterSkipMessage(timerName) {
  const source = read(SCHEDULERS);
  const match = source.match(/context\.log\(`(\[\$\{name\}\][^`]*)`\)/);
  if (!match) throw new Error(`No master-flag skip log found in ${SCHEDULERS}.`);
  return match[1].replace('${name}', timerName);
}

/**
 * platformJobSweeper's skip, which is shaped differently from every other one.
 *
 * jobs-sweeper.js registers with `app.timer()` directly rather than through
 * schedulers.js's `timer()` helper, so it logs `name: disabled (FLAG)` with no
 * brackets. A pattern requiring the bracketed form counted this genuine skip as
 * a RUN — telling an operator the handler did its work when it did not, on a
 * timer they had just armed and were watching.
 */
function sweeperSkipMessage() {
  const source = read(JOBS_SWEEPER);
  const match = source.match(/context\.log\('(platformJobSweeper: disabled[^']*)'\)/);
  if (!match) throw new Error(`No platformJobSweeper skip log found in ${JOBS_SWEEPER}.`);
  return match[1];
}

/** The forge handler's own "my feature is off" line — emitted by a run, not a skip. */
function forgeDisabledMessage() {
  const source = read(FORGE_SCHEDULED);
  const match = source.match(/log\.log\?\.\('(\[forgeScheduled\][^']*disabled[^']*)'\)/);
  if (!match) throw new Error(`No auto-forge disabled log found in ${FORGE_SCHEDULED}.`);
  return match[1];
}

describe('timer verifier skip matcher', () => {
  it('finds the pattern and both log lines at all', () => {
    // Guards the guard: any of these throwing means the assertions below would
    // otherwise be testing nothing.
    expect(skipPattern().length).toBeGreaterThan(5);
    expect(masterSkipMessage('checkAgentHealth')).toContain('disabled');
    expect(sweeperSkipMessage()).toContain('disabled');
    expect(forgeDisabledMessage()).toContain('disabled');
  });

  it('matches the master-flag skip, for every registered timer name', () => {
    const pattern = new RegExp(skipPattern());
    const registered = [...read(SCHEDULERS).matchAll(/^timer\('(\w+)'/gm)].map((m) => m[1]);
    expect(registered.length).toBeGreaterThan(10);
    for (const name of registered) {
      expect(pattern.test(masterSkipMessage(name)), `master skip for ${name}`).toBe(true);
    }
  });

  it("matches platformJobSweeper's differently-shaped skip", () => {
    // Not the bracketed form: jobs-sweeper.js bypasses the timer() helper.
    // Missing it counts a real skip as a run, which is the worse of the two
    // errors available here.
    const pattern = new RegExp(skipPattern());
    const message = sweeperSkipMessage();
    expect(
      pattern.test(message),
      `"${message}" is a genuine skip. Missing it reports an unarmed timer as running.`
    ).toBe(true);
  });

  it('does NOT match a handler that ran and found its own feature off', () => {
    const pattern = new RegExp(skipPattern());
    const message = forgeDisabledMessage();
    expect(
      pattern.test(message),
      `"${message}" is written by a handler that RAN. Matching it reports an armed timer as unarmed.`
    ).toBe(false);
  });

  it('does not match a handler log that merely mentions the word', () => {
    const pattern = new RegExp(skipPattern());
    for (const message of [
      '[someTimer] cache disabled, continuing',
      '[someTimer] 0 agent(s) marked offline',
      "Executed 'Functions.someTimer' (Succeeded, Id=abc, Duration=12ms)",
      '[someTimer] provider disabled — skipping upload',
    ]) {
      expect(pattern.test(message), message).toBe(false);
    }
  });
});
