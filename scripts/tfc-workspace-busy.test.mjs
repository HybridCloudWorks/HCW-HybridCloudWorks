/**
 * The states that must block a Functions deploy.
 *
 * The assertion that matters is the direction of the unknown case. A state
 * this does not recognise has to read as BUSY, because the two outcomes are
 * not symmetric: refusing a safe deploy costs one re-dispatch, while allowing
 * a raced one costs the whole app-settings map and is found days later (#454).
 */
import { describe, it, expect } from 'vitest';
import { FINISHED } from './check-tfc-plan.mjs';
import { WORKSPACE, describeBusy, firstBusyRun, isBusy } from './tfc-workspace-busy.mjs';

const run = (id, status) => ({ id, attributes: { status } });

describe('isBusy', () => {
  it('treats every running and parked state as busy', () => {
    // The three #454 names plus the queue states either side of them.
    for (const status of [
      'planning',
      'planned',
      'applying',
      'apply_queued',
      'plan_queued',
      'cost_estimating',
      'confirmed',
      'policy_checked',
    ]) {
      expect(isBusy(status), status).toBe(true);
    }
  });

  it('treats every finished state as free, and takes that list from one place', () => {
    for (const status of FINISHED) expect(isBusy(status), status).toBe(false);
    // Not a restatement of the set: proof it is the SAME set. A second copy
    // here would drift from check-tfc-plan.mjs exactly as two copies always do.
    expect(FINISHED.has('applied')).toBe(true);
  });

  it('treats an unrecognised state as busy, so a new run state cannot open the race', () => {
    // HashiCorp adds states; the repository does not learn about them on the
    // day. Refusing is the recoverable direction.
    expect(isBusy('some_state_hashicorp_added_later')).toBe(true);
  });

  it('treats a missing or empty status as busy rather than as absent', () => {
    expect(isBusy(undefined)).toBe(true);
    expect(isBusy('')).toBe(true);
  });
});

describe('firstBusyRun', () => {
  it('finds nothing when every run is over', () => {
    expect(firstBusyRun([run('run-a', 'applied'), run('run-b', 'discarded')])).toBeNull();
  });

  it('finds a queued run sitting behind a finished newest one', () => {
    // The case the newest-run-only reading gets wrong: the top entry is
    // settled and a queued apply is right behind it.
    const busy = firstBusyRun([run('run-new', 'applied'), run('run-queued', 'apply_queued')]);
    expect(busy).toEqual({ id: 'run-queued', status: 'apply_queued' });
  });

  it('is empty-safe', () => {
    expect(firstBusyRun([])).toBeNull();
    expect(firstBusyRun(undefined)).toBeNull();
  });

  it('skips a run carrying no status rather than calling it busy', () => {
    // isBusy says busy for an empty status, but a run object with no status at
    // all is malformed data rather than a running apply — reporting it would
    // block deploys with an id the operator cannot act on.
    expect(firstBusyRun([{ id: 'run-x', attributes: {} }])).toBeNull();
  });
});

describe('describeBusy', () => {
  it('names the run, the workspace and what to do', () => {
    const message = describeBusy({ id: 'run-Xyz', status: 'applying' });
    expect(message).toContain('run-Xyz');
    expect(message).toContain('applying');
    expect(message).toContain(WORKSPACE);
    expect(message).toContain('#454');
    // An operator reading this in a failed job needs the runs page, not a
    // description of the failure mode alone.
    expect(message).toContain('https://app.terraform.io/app/hcw/workspaces/hcw-azure/runs');
  });
});
