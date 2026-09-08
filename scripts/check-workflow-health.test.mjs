/**
 * Tests for the workflow-health verdict.
 *
 * These are off-line and fixture-driven on purpose. The network half of
 * `check-workflow-health.mjs` cannot run in CI without a token, and a guard
 * whose logic can only be exercised against the live API is a guard nobody can
 * change safely — the lesson `workspace-query.tests.ps1` was written for, kept
 * here now that its subject is gone.
 *
 * The fixtures are REAL run histories, copied from the API on 2026-09-08, not
 * invented ones. `validate-deployed.yml` is the case the tool exists for;
 * `deploy-azure-frontend.yml` is the case it must NOT fire on, and it was the
 * one that nearly produced a false positive, because two of its five recent
 * runs were cancelled.
 */
import { describe, expect, it } from 'vitest';
import {
  assessWorkflow,
  assessAll,
  renderReport,
  DEFAULT_STALE_DAYS,
} from './check-workflow-health.mjs';

const NOW = new Date('2026-09-08T05:00:00Z');
const OPTS = { now: NOW, staleDays: DEFAULT_STALE_DAYS };

/** Real: the only two runs this workflow ever had, both red, three weeks back. */
const VALIDATE_DEPLOYED = {
  path: '.github/workflows/validate-deployed.yml',
  runs: [
    { conclusion: 'failure', created_at: '2026-08-18T02:03:03Z' },
    { conclusion: 'failure', created_at: '2026-08-18T00:08:31Z' },
  ],
};

/** Real: used successfully the same day, but with cancellations in the window. */
const DEPLOY_FRONTEND = {
  path: '.github/workflows/deploy-azure-frontend.yml',
  runs: [
    { conclusion: 'success', created_at: '2026-09-08T02:21:08Z' },
    { conclusion: 'success', created_at: '2026-09-08T02:08:52Z' },
    { conclusion: 'success', created_at: '2026-09-08T01:26:38Z' },
    { conclusion: 'cancelled', created_at: '2026-09-08T01:16:45Z' },
    { conclusion: 'cancelled', created_at: '2026-09-07T23:55:27Z' },
  ],
};

/** Real: a dispatch-only tool whose red X IS its verdict, not a breakage. */
const TFC_PLAN_CHECK = {
  path: '.github/workflows/tfc-plan-check.yml',
  runs: [
    { conclusion: 'failure', created_at: '2026-08-31T20:02:12Z' },
    { conclusion: 'success', created_at: '2026-08-31T20:00:42Z' },
    { conclusion: 'failure', created_at: '2026-08-31T19:59:37Z' },
  ],
};

describe('assessWorkflow', () => {
  it('calls a workflow broken when nothing succeeded and nobody came back', () => {
    const got = assessWorkflow(VALIDATE_DEPLOYED, OPTS);
    expect(got.verdict).toBe('broken');
    // The number is the finding. A verdict that does not say how long it sat
    // is one somebody has to go and look up, which is how it gets skipped.
    expect(got.why).toContain('21d ago');
    expect(got.why).toContain('2026-08-18');
  });

  it('does not fire on a workflow that succeeded, whatever else is in the window', () => {
    // Two cancellations here. Counting a cancellation as a failure would have
    // flagged a workflow used successfully three times the same morning.
    expect(assessWorkflow(DEPLOY_FRONTEND, OPTS).verdict).toBe('healthy');
  });

  it('does not fire on a dispatch tool whose red run is a real verdict', () => {
    // tfc-plan-check.yml exits 1 to REPORT an unexpected plan. One success in
    // the window is enough to say the workflow itself works.
    expect(assessWorkflow(TFC_PLAN_CHECK, OPTS).verdict).toBe('healthy');
  });

  it('holds fire on a fresh failure — that is somebody mid-debug', () => {
    const got = assessWorkflow(
      {
        path: '.github/workflows/whatever.yml',
        runs: [{ conclusion: 'failure', created_at: '2026-09-07T12:00:00Z' }],
      },
      OPTS
    );
    expect(got.verdict).toBe('unproven');
    expect(got.why).toContain('work in progress');
  });

  it('separates "no evidence" from "evidence of absence"', () => {
    // A workflow that has never run is not a broken one. Reporting it as
    // broken is the T-514 mistake in a new costume.
    expect(assessWorkflow({ path: 'a.yml', runs: [] }, OPTS).verdict).toBe('unproven');
    // In-flight runs carry conclusion: null and are not evidence either.
    expect(
      assessWorkflow(
        { path: 'b.yml', runs: [{ conclusion: null, created_at: '2026-09-08T04:59:00Z' }] },
        OPTS
      ).verdict
    ).toBe('unproven');
  });

  it('will not call a workflow broken on cancellations alone', () => {
    const got = assessWorkflow(
      {
        path: 'c.yml',
        runs: [
          { conclusion: 'cancelled', created_at: '2026-07-01T00:00:00Z' },
          { conclusion: 'cancelled', created_at: '2026-07-02T00:00:00Z' },
        ],
      },
      OPTS
    );
    expect(got.verdict).toBe('unproven');
    expect(got.why).toContain('none of which reached a verdict');
  });

  it('counts timed_out and startup_failure as failures, since neither is a success', () => {
    for (const conclusion of ['timed_out', 'startup_failure']) {
      const got = assessWorkflow(
        { path: 'd.yml', runs: [{ conclusion, created_at: '2026-08-01T00:00:00Z' }] },
        OPTS
      );
      expect(got.verdict, conclusion).toBe('broken');
    }
  });
});

describe('renderReport', () => {
  it('names the broken workflow and exits loud', () => {
    const text = renderReport(assessAll([VALIDATE_DEPLOYED, DEPLOY_FRONTEND], OPTS), {
      staleDays: DEFAULT_STALE_DAYS,
    });
    expect(text).toContain('validate-deployed.yml');
    expect(text).toContain('Fix it or delete it.');
    // The healthy one must not be listed as a finding.
    expect(text).not.toContain('- `.github/workflows/deploy-azure-frontend.yml`');
  });

  it('says so plainly when nothing is broken', () => {
    const text = renderReport(assessAll([DEPLOY_FRONTEND], OPTS), {
      staleDays: DEFAULT_STALE_DAYS,
    });
    expect(text).toContain('No workflow is failing-and-abandoned');
  });
});

describe('the fixtures are the real thing', () => {
  // A fixture that drifted into a shape the API never produces would make
  // every test above pass while testing nothing. These pin the two fields the
  // verdict actually reads.
  it('every fixture run carries a conclusion field and an ISO created_at', () => {
    for (const wf of [VALIDATE_DEPLOYED, DEPLOY_FRONTEND, TFC_PLAN_CHECK]) {
      for (const run of wf.runs) {
        expect(Object.hasOwn(run, 'conclusion'), wf.path).toBe(true);
        expect(run.created_at, wf.path).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
    }
  });
});
