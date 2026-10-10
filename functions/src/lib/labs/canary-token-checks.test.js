/**
 * The two checks the canary and the status-token record answer (#1009,
 * items 2 and 4), as the pulse records them and the Labs snapshot shows them.
 *
 * What matters: a job nothing ran is offline, one that ran and failed is
 * critical, a canary that stopped is unknown rather than its last good word;
 * a refused token is critical until Coder accepts it again, however old the
 * refusal, and an acceptance a day old no longer vouches for anything.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  CANARY_STALE_AFTER_MS,
  CODER_TOKEN_PROBE,
  LAB_CANARY_PROBE,
  TOKEN_EVIDENCE_STALE_AFTER_MS,
  coderTokenVerdict,
  labCanaryVerdict,
  readCoderToken,
  readLabCanary,
} from './lab-checks.js';
import { HEALTH_PROBES } from '../health/probe-catalogue.js';

const NOW = Date.parse('2026-10-10T12:30:00.000Z');
const minutesAgo = (n) => new Date(NOW - n * 60_000).toISOString();

const passed = (over = {}) => ({
  id: 'lab_canary',
  lastRunAt: minutesAgo(10),
  lastResult: { ok: true, outcome: 'succeeded', timings: { claimMs: 9_400, runMs: 2_600 } },
  lastSuccessAt: minutesAgo(10),
  consecutiveFailures: 0,
  ...over,
});
const failed = (outcome, reason, over = {}) =>
  passed({
    lastResult: { ok: false, outcome, reason },
    lastSuccessAt: minutesAgo(130),
    lastFailureAt: minutesAgo(10),
    consecutiveFailures: 2,
    ...over,
  });

describe('labCanaryVerdict', () => {
  it('is healthy after a job that ran end to end, with its timings', () => {
    expect(labCanaryVerdict(passed(), NOW)).toEqual({
      status: 'healthy',
      summary: 'A shell-echo job ran end to end 10 min ago: claimed after 9 s, done 3 s later.',
      detail: null,
    });
  });

  it('is offline when nothing ran the job: no agent online, or nobody claimed it', () => {
    for (const outcome of ['no-agent', 'not-claimed']) {
      const verdict = labCanaryVerdict(failed(outcome, 'nobody came'), NOW);
      expect(verdict.status, outcome).toBe('offline');
      expect(verdict.summary).toBe(
        'The lab canary did not pass 10 min ago: nobody came. 2 runs in a row. The last job that passed ran 2 h ago.'
      );
    }
  });

  it('is critical when a job ran and failed, echoed the wrong thing, or the registry cannot run it', () => {
    for (const outcome of ['failed', 'timeout', 'mismatch', 'not-completed', 'no-capability', 'previous-in-flight']) {
      expect(labCanaryVerdict(failed(outcome, 'x'), NOW).status, outcome).toBe('critical');
    }
  });

  it('says when no job has ever passed', () => {
    expect(labCanaryVerdict(failed('failed', 'x', { lastSuccessAt: null }), NOW).summary).toMatch(
      /No canary job has passed yet\.$/
    );
  });

  it('is unknown, not its last word, once it has stopped running', () => {
    const stale = new Date(NOW - CANARY_STALE_AFTER_MS - 60_000).toISOString();
    const verdict = labCanaryVerdict(passed({ lastRunAt: stale }), NOW);
    expect(verdict.status).toBe('unknown');
    expect(verdict.summary).toMatch(/runs hourly while LAB_CANARY is armed, so it has stopped; the last job passed/);
  });

  it('is unknown, naming the flag, before it has ever run', () => {
    expect(labCanaryVerdict(null, NOW)).toMatchObject({
      status: 'unknown',
      summary: expect.stringContaining('Add LAB_CANARY to enabled_timers'),
    });
  });
});

describe('coderTokenVerdict', () => {
  const status = (entry) => ({ operations: { status: entry } });

  it('is healthy when Coder accepted the token recently, naming the read that showed it', () => {
    expect(coderTokenVerdict(status({ lastAcceptedAt: minutesAgo(30) }), NOW)).toEqual({
      status: 'healthy',
      summary: 'Coder accepted CODER_STATUS_TOKEN 30 min ago (the labs status read).',
      detail: `the labs status read: last accepted ${minutesAgo(30)}`,
    });
  });

  it('is critical from the first 401 until the same operation accepts it again, naming since when', () => {
    const verdict = coderTokenVerdict(
      status({
        lastAcceptedAt: minutesAgo(32 * 60),
        lastRefusedAt: minutesAgo(5),
        lastRefusedStatus: 401,
        refusingSince: minutesAgo(31 * 60),
      }),
      NOW
    );
    expect(verdict.status).toBe('critical');
    expect(verdict.summary).toBe(
      `Coder has refused CODER_STATUS_TOKEN on the labs status read (HTTP 401) since ${minutesAgo(31 * 60)}, 31 h ago: it has expired or been revoked, so the labs card's templates and running count are unknown. The lab host's Coder automation renews it daily; Integrations → Hybrid Lab shows its last report.`
    );
    expect(verdict.detail).toBe(
      `the labs status read: last accepted ${minutesAgo(32 * 60)}, last refused (HTTP 401) ${minutesAgo(5)}`
    );
  });

  it('names the scope for a 403', () => {
    expect(
      coderTokenVerdict(status({ lastRefusedAt: minutesAgo(5), lastRefusedStatus: 403, refusingSince: minutesAgo(5) }), NOW)
        .summary
    ).toContain('it lacks the template:read or workspace:read scope');
  });

  it('stays critical on an old refusal, the latest evidence there is', () => {
    expect(coderTokenVerdict(status({ lastRefusedAt: minutesAgo(5 * 24 * 60), lastRefusedStatus: 401 }), NOW).status).toBe(
      'critical'
    );
  });

  it('is healthy again once the same operation accepts it after a refusal', () => {
    expect(
      coderTokenVerdict(status({ lastRefusedAt: minutesAgo(60), lastRefusedStatus: 401, lastAcceptedAt: minutesAgo(1) }), NOW)
        .status
    ).toBe('healthy');
  });

  it('stays critical when only the other operation accepted it since (CodeRabbit, #1056)', () => {
    const verdict = coderTokenVerdict(
      {
        operations: {
          status: { lastRefusedAt: minutesAgo(10), lastRefusedStatus: 403, refusingSince: minutesAgo(10) },
          expiry: { lastAcceptedAt: minutesAgo(1) },
        },
      },
      NOW
    );
    expect(verdict.status).toBe('critical');
    expect(verdict.detail).toContain("the Integrations card's read of its own record: last accepted");
  });

  it('is unknown when the newest acceptance is a day old, and before any answer is recorded', () => {
    const old = new Date(NOW - TOKEN_EVIDENCE_STALE_AFTER_MS - 60_000).toISOString();
    expect(coderTokenVerdict(status({ lastAcceptedAt: old }), NOW).status).toBe('unknown');
    expect(coderTokenVerdict(null, NOW).status).toBe('unknown');
    expect(coderTokenVerdict({ operations: {} }, NOW).status).toBe('unknown');
  });
});

describe('the readers', () => {
  it('are named by live probes a viewer can record', () => {
    for (const id of [LAB_CANARY_PROBE, CODER_TOKEN_PROBE]) {
      expect(HEALTH_PROBES[id], id).toEqual({ kind: 'live', writeRole: 'viewer' });
    }
  });

  it('read their admin_config documents', async () => {
    const store = {
      readDoc: vi.fn(async (_c, id) =>
        id === 'lab_canary' ? passed() : { operations: { status: { lastAcceptedAt: minutesAgo(1) } } }
      ),
    };
    expect((await readLabCanary(store, NOW)).status).toBe('healthy');
    expect((await readCoderToken(store, NOW)).status).toBe('healthy');
    expect(store.readDoc.mock.calls).toEqual([
      ['admin_config', 'lab_canary', 'admin_config'],
      ['admin_config', 'coder_status_token', 'admin_config'],
    ]);
  });
});
