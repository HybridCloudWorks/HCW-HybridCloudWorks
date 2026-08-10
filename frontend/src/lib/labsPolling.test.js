/**
 * The rules the Labs console polls by.
 *
 * Two of these had already drifted inside a single file, which is the whole
 * argument for extracting them: the load-bearing assertions here are that the
 * terminal set is the *complete* one, and that the staleness clock is a
 * parameter rather than something read from inside a fetch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isAgentOnline,
  isTerminalJobStatus,
  jobPollDelay,
  JOB_POLL_BASE_MS,
  JOB_POLL_MAX_MS,
  STALE_AFTER_MS,
  TERMINAL_JOB_STATUSES,
  toMillis,
} from './labsPolling.js';

describe('TERMINAL_JOB_STATUSES', () => {
  it('includes timeout, which the poll loop used to omit', () => {
    // The defect: `timeout` is a status the agent reports, and leaving it out
    // meant a timed-out job was polled every 5s for as long as the console
    // stayed open. (TODO.md T-308)
    expect(isTerminalJobStatus('timeout')).toBe(true);
  });

  it('covers every non-running status the server can report', () => {
    // Mirrors JOB_STATUSES in functions/src/lib/labs.js minus the three
    // in-flight ones. If a status is added there, this fails.
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual([
      'cancelled',
      'failed',
      'succeeded',
      'timeout',
    ]);
  });

  it('treats the in-flight statuses as non-terminal', () => {
    for (const status of ['queued', 'claimed', 'running']) {
      expect(isTerminalJobStatus(status)).toBe(false);
    }
  });

  it('treats a missing or unknown status as non-terminal', () => {
    // Failing closed here means "keep polling", which is the safe direction:
    // the alternative stops watching a job that is still running.
    expect(isTerminalJobStatus(undefined)).toBe(false);
    expect(isTerminalJobStatus(null)).toBe(false);
    expect(isTerminalJobStatus('sideways')).toBe(false);
  });
});

describe('jobPollDelay', () => {
  it('polls at the base interval while everything works', () => {
    expect(jobPollDelay(0)).toBe(JOB_POLL_BASE_MS);
  });

  it('doubles per consecutive failure and caps', () => {
    expect(jobPollDelay(1)).toBe(10000);
    expect(jobPollDelay(2)).toBe(20000);
    expect(jobPollDelay(3)).toBe(40000);
    expect(jobPollDelay(4)).toBe(JOB_POLL_MAX_MS);
    expect(jobPollDelay(50)).toBe(JOB_POLL_MAX_MS);
  });

  it('always returns a finite delay, so the poll is never abandoned', () => {
    // The job is still running on the agent; giving up means the operator
    // never learns how it ended.
    for (const n of [0, 1, 9, Number.NaN, -1, undefined]) {
      const delay = jobPollDelay(n);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(JOB_POLL_MAX_MS);
    }
  });
});

describe('toMillis', () => {
  it('reads Firestore Timestamps, ISO strings and Dates', () => {
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(toMillis({ toMillis: () => ms })).toBe(ms);
    expect(toMillis('2026-01-02T03:04:05.000Z')).toBe(ms);
    expect(toMillis(new Date(ms))).toBe(ms);
  });

  it('returns 0 rather than NaN for anything unparseable', () => {
    // NaN comparisons are silently false, which would report every agent
    // offline with no error anywhere.
    for (const value of [null, undefined, '', 'not-a-date', {}]) {
      expect(toMillis(value)).toBe(0);
    }
  });
});

describe('isAgentOnline', () => {
  const now = Date.UTC(2026, 0, 2, 3, 4, 5);

  it('is online inside the threshold and offline outside it', () => {
    expect(isAgentOnline({ lastSeenAt: new Date(now - 1000) }, now)).toBe(true);
    expect(isAgentOnline({ lastSeenAt: new Date(now - STALE_AFTER_MS - 1) }, now)).toBe(false);
  });

  it('is offline when the agent has never been seen', () => {
    expect(isAgentOnline({}, now)).toBe(false);
    expect(isAgentOnline({ lastSeenAt: null }, now)).toBe(false);
    expect(isAgentOnline(undefined, now)).toBe(false);
  });

  it('goes offline as `now` advances, with lastSeenAt held fixed', () => {
    // This is T-309 in one assertion. The dashboard froze `now` on a failed
    // fetch, so this progression never happened and agents stayed "connected"
    // for exactly as long as nothing was reachable.
    const agent = { lastSeenAt: new Date(now) };
    expect(isAgentOnline(agent, now + 1000)).toBe(true);
    expect(isAgentOnline(agent, now + STALE_AFTER_MS + 1)).toBe(false);
  });
});

describe('the page uses the shared rules', () => {
  // Resolved from the package root, as functionsBase.test.js does — the suite
  // runs under jsdom, where `import.meta.url` is not a file: URL.
  const LABS_PAGE_SOURCE = readFileSync(
    join(process.cwd(), 'src', 'pages', 'admin', 'LabsPage.jsx'),
    'utf8'
  );

  // Comments explain what the file deliberately no longer does, and quoting
  // the retired code there is the point. The guards below must read code only.
  const LABS_PAGE = LABS_PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('declares no terminal-status list of its own', () => {
    // The original defect was two inline lists in one file that disagreed.
    expect(LABS_PAGE).not.toMatch(/\[\s*'succeeded'\s*,/);
    expect(LABS_PAGE).toContain('isTerminalJobStatus');
  });

  it('advances the staleness clock outside the fetch', () => {
    // `setNow` must not appear inside the getLabsSnapshot handler. Asserting
    // on the interval is the closest structural proxy available without
    // rendering the page.
    expect(LABS_PAGE).toContain('setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)');
    const snapshotPoll = LABS_PAGE.slice(LABS_PAGE.indexOf("postJSON('getLabsSnapshot'"));
    expect(snapshotPoll.slice(0, 400)).not.toContain('setNow(');
  });

  it('guards against overlapping snapshot fetches', () => {
    // postJSON allows 20s against a 15s interval.
    expect(LABS_PAGE).toContain('if (inFlight) return;');
  });

  it('does not fabricate a job status from a transport error', () => {
    // `status: 'failed'` in the catch was indistinguishable from a real
    // failure, and stopped the poll permanently.
    expect(LABS_PAGE).not.toContain("status: 'failed'");
    expect(LABS_PAGE).toContain('setPollError');
  });
});
