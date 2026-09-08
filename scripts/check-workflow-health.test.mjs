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
  positiveIntOr,
  DEFAULT_SAMPLE,
  MAX_PER_PAGE,
  listingRefusal,
  readTuning,
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

describe('positiveIntOr', () => {
  // WORKFLOW_STALE_DAYS and WORKFLOW_SAMPLE reached Number() directly until
  // review caught it on #426. `Number('soon')` is NaN and NaN does not throw:
  // it would have gone into a request URL as `per_page=NaN`, and made every
  // staleness comparison false. A mistyped variable must not become a finding
  // about a workflow.
  it('takes a positive whole number', () => {
    expect(positiveIntOr('30', 10)).toBe(30);
    expect(positiveIntOr(7, 10)).toBe(7);
  });

  it('falls back for anything that is not one, rather than yielding NaN', () => {
    for (const bad of ['soon', '', '   ', undefined, null, 'NaN', '1e', '-5', '0', '2.5', {}]) {
      const got = positiveIntOr(bad, 10);
      expect(Number.isFinite(got), `positiveIntOr(${JSON.stringify(bad)}) was not finite`).toBe(
        true
      );
      expect(got).toBe(10);
    }
  });

  it('never returns NaN for a value Number() would accept as one', () => {
    // The specific regression: Number(undefined) is NaN, Number({}) is NaN.
    expect(Number(positiveIntOr('soon', 10))).not.toBeNaN();
    expect(String(positiveIntOr('soon', 10))).toBe('10');
  });
});

describe('a workflow nobody has concluded either way', () => {
  // Review asked for neutral/action_required/stale to be counted as failures.
  // They are not, and must not be: both gated deploys in this repository carry
  // cancelled runs today, and action_required is the terminal state of a
  // deploy nobody approved — counting either would report a healthy workflow
  // as broken. The real gap it found was that such a workflow hides in the
  // collapsed block forever, however long it sits there. That is what these
  // pin: the classification is unchanged, the visibility is not.
  const now = new Date('2026-09-08T00:00:00Z');
  const nonVerdict = (created_at, conclusion = 'cancelled') => ({
    path: '.github/workflows/x.yml',
    runs: [{ conclusion, created_at }],
  });

  it('is still unproven, not broken, whatever the conclusion was', () => {
    for (const c of ['cancelled', 'neutral', 'action_required', 'stale', 'skipped']) {
      const got = assessWorkflow(nonVerdict('2026-01-01T00:00:00Z', c), { now, staleDays: 10 });
      expect(got.verdict, `${c} should not be a failure verdict`).toBe('unproven');
    }
  });

  it('carries how long it has been unproven', () => {
    const got = assessWorkflow(nonVerdict('2026-01-01T00:00:00Z'), { now, staleDays: 10 });
    expect(got.ageDays).toBe(250);
  });

  it('is surfaced outside the collapsed block once it is older than the window', () => {
    const old = assessWorkflow(nonVerdict('2026-01-01T00:00:00Z'), { now, staleDays: 10 });
    const report = renderReport([old], { staleDays: 10 });
    const [visible, collapsed] = report.split('<details>');
    expect(visible).toContain('concluded nothing either way for over 10 days');
    expect(visible).toContain('.github/workflows/x.yml');
    expect(collapsed ?? '').not.toContain('.github/workflows/x.yml');
  });

  it('stays collapsed while it is inside the window', () => {
    const fresh = assessWorkflow(nonVerdict('2026-09-07T00:00:00Z'), { now, staleDays: 10 });
    const report = renderReport([fresh], { staleDays: 10 });
    const [visible, collapsed] = report.split('<details>');
    expect(visible).not.toContain('.github/workflows/x.yml');
    expect(collapsed ?? '').toContain('.github/workflows/x.yml');
  });
});

describe('what "nobody has been back" is measured from', () => {
  const now = new Date('2026-09-08T00:00:00Z');

  it('a recent cancellation means somebody HAS been back, so it is not abandoned', () => {
    // The regression: age came from the newest FAILURE. A workflow that failed
    // 30 days ago and had a run cancelled yesterday was called abandoned, in a
    // sentence that said "nobody has been back" about a workflow somebody was
    // back at yesterday. Caught in review on #426.
    const got = assessWorkflow(
      {
        path: '.github/workflows/x.yml',
        runs: [
          { conclusion: 'failure', created_at: '2026-08-09T00:00:00Z' },
          { conclusion: 'cancelled', created_at: '2026-09-07T00:00:00Z' },
        ],
      },
      { now, staleDays: 10 }
    );
    expect(got.verdict).toBe('unproven');
    expect(got.ageDays).toBeCloseTo(1, 5);
  });

  it('still calls it broken when nothing of any kind is recent', () => {
    const got = assessWorkflow(
      {
        path: '.github/workflows/x.yml',
        runs: [
          { conclusion: 'failure', created_at: '2026-08-09T00:00:00Z' },
          { conclusion: 'cancelled', created_at: '2026-08-10T00:00:00Z' },
        ],
      },
      { now, staleDays: 10 }
    );
    expect(got.verdict).toBe('broken');
    // Dated from the newest run, not the newest failure.
    expect(got.why).toContain('2026-08-10');
  });

  it('does not claim everything is inside the window while showing one that is not', () => {
    const stalled = assessWorkflow(
      {
        path: '.github/workflows/old.yml',
        runs: [{ conclusion: 'cancelled', created_at: '2026-01-01T00:00:00Z' }],
      },
      { now, staleDays: 10 }
    );
    const report = renderReport([stalled], { staleDays: 10 });
    expect(report).toContain('No workflow is failing-and-abandoned.');
    expect(report).toContain('concluded nothing either way for over 10 days');
    // The self-contradiction: the headline used to assert this too.
    expect(report).not.toContain('inside the 10-day window.');
  });
});

describe('the per_page ceiling', () => {
  // GitHub does not reject an oversized per_page — verified against the live
  // API, which answered HTTP 200 with 100 runs for per_page=500. So this is
  // not about avoiding an error; it is about not silently measuring something
  // other than what was asked for. Raised in review on #426.
  it('clamps to the API ceiling instead of passing the value through', () => {
    expect(positiveIntOr('500', 10, MAX_PER_PAGE)).toBe(100);
    expect(positiveIntOr('101', 10, MAX_PER_PAGE)).toBe(100);
  });

  it('leaves a value at or under the ceiling alone', () => {
    expect(positiveIntOr('100', 10, MAX_PER_PAGE)).toBe(100);
    expect(positiveIntOr('25', 10, MAX_PER_PAGE)).toBe(25);
  });

  it('still falls back for a non-number, ceiling or not', () => {
    expect(positiveIntOr('soon', 10, MAX_PER_PAGE)).toBe(10);
  });

  it('does not clamp when no ceiling is given', () => {
    // WORKFLOW_STALE_DAYS has no API ceiling and must not inherit one.
    expect(positiveIntOr('365', 10)).toBe(365);
  });
});

describe('readTuning — the wiring, not just the helper', () => {
  it('applies the API ceiling to the sample size', () => {
    expect(readTuning({ WORKFLOW_SAMPLE: '500' }).sample).toBe(100);
  });

  it('does not apply it to the staleness window', () => {
    expect(readTuning({ WORKFLOW_STALE_DAYS: '365' }).staleDays).toBe(365);
  });

  it('falls back for both when the environment is empty', () => {
    expect(readTuning({})).toEqual({ staleDays: DEFAULT_STALE_DAYS, sample: DEFAULT_SAMPLE });
  });

  it('never yields NaN for either', () => {
    const got = readTuning({ WORKFLOW_SAMPLE: 'soon', WORKFLOW_STALE_DAYS: 'later' });
    expect(Number.isFinite(got.sample)).toBe(true);
    expect(Number.isFinite(got.staleDays)).toBe(true);
  });
});

describe('the messages say what was actually measured', () => {
  const now = new Date('2026-09-08T00:00:00Z');

  it('does not call a cancellation a failure when dating recent activity', () => {
    // ageDays comes from the newest run of ANY kind. A message saying "the
    // newest failure is 1d old" when the newest failure is 30d old and the
    // 1d-old run was cancelled claims a failure that does not exist.
    // Caught in review on #426, after the age source changed two commits
    // earlier and this string was not swept with it.
    const got = assessWorkflow(
      {
        path: '.github/workflows/x.yml',
        runs: [
          { conclusion: 'failure', created_at: '2026-08-09T00:00:00Z' },
          { conclusion: 'cancelled', created_at: '2026-09-07T00:00:00Z' },
        ],
      },
      { now, staleDays: 10 }
    );
    expect(got.why).not.toContain('newest failure');
    expect(got.why).toContain('newest run of any kind');
  });

  it('says the same thing in the broken message', () => {
    const got = assessWorkflow(
      {
        path: '.github/workflows/x.yml',
        runs: [{ conclusion: 'failure', created_at: '2026-08-09T00:00:00Z' }],
      },
      { now, staleDays: 10 }
    );
    expect(got.why).toContain('newest attempt of any kind');
  });
});

describe('listingRefusal', () => {
  it('accepts a complete listing', () => {
    expect(listingRefusal({ total_count: 19, workflows: new Array(19) })).toBeNull();
    // total_count absent is not evidence of truncation.
    expect(listingRefusal({ workflows: [] })).toBeNull();
  });

  it('refuses a truncated one', () => {
    const got = listingRefusal({ total_count: 150, workflows: new Array(100) });
    expect(got).toContain('paginated');
    expect(got).toContain('nothing is asserted');
  });

  it('refuses a listing whose shape it cannot read', () => {
    for (const bad of [null, undefined, {}, { workflows: 'nope' }]) {
      expect(listingRefusal(bad)).toContain('nothing is asserted');
    }
  });

  it('does not tell the reader to raise per_page, which is already at the ceiling', () => {
    // The request asks for MAX_PER_PAGE already, so "raise per_page" is an
    // impossible instruction — an operator would try it, watch nothing change
    // and conclude the tool is broken rather than the situation. Caught in
    // review on #426.
    const got = listingRefusal({ total_count: 150, workflows: new Array(100) });
    expect(got).not.toMatch(/raise per_page/i);
    expect(got).toContain(String(MAX_PER_PAGE));
    expect(got).toContain('Following pages');
  });
});
