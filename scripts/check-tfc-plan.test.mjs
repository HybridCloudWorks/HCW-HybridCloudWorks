/**
 * The run states `check-tfc-plan.mjs` treats as "a decision is still pending".
 *
 * ## The failure this catches
 *
 * Dispatched without `--run`, the tool resolves the workspace's LATEST run —
 * whatever ran last. On 2026-08-30 that was an apply from seventeen hours
 * earlier, and it reported UNEXPECTED, correctly, about history, in the same
 * voice it would use for a plan awaiting confirmation. The operator had asked
 * "is the plan I am about to confirm boring?" and been answered about the past.
 *
 * The fix is a printed caveat gated on this set. Which makes the set itself the
 * load-bearing part: adding a finished state to it — `applied` is the obvious
 * candidate, since it is the state most often seen — silently removes the
 * caveat and restores the confusion, with nothing failing to say so.
 *
 * So this pins the invariant rather than the exact contents: every finished
 * state must be absent, and at least the plainly-pending one present. New
 * pending states may be added freely; a finished one may not.
 */
import { describe, it, expect } from 'vitest';
import { AWAITING_DECISION, FINISHED } from './check-tfc-plan.mjs';

/**
 * Run states in which HashiCorp considers the run over. From
 * developer.hashicorp.com/terraform/cloud-docs/run/states — the terminal ones,
 * plus `planned_and_finished`, which is finished despite the name.
 */
const FINISHED_STATES = [
  'applied',
  'discarded',
  'errored',
  'canceled',
  'force_canceled',
  'planned_and_finished',
];

/**
 * States where the run is neither parked on a human nor over — it is executing.
 *
 * These are why the module keeps FINISHED separate rather than treating "not
 * awaiting" as "finished": the first version of the caveat told the operator a
 * run had "already finished" when it might have been mid-apply, which is false
 * in the direction that matters.
 */
const IN_PROGRESS_STATES = ['pending', 'planning', 'cost_estimating', 'policy_checking', 'apply_queued', 'applying'];

describe('AWAITING_DECISION', () => {
  it('is a non-empty set', () => {
    // Guards the guard: an empty set makes every "not in it" assertion below
    // pass while the caveat prints on literally every run.
    expect(AWAITING_DECISION.size).toBeGreaterThan(0);
  });

  it('contains the state a run sits in while waiting on a human', () => {
    expect(AWAITING_DECISION.has('planned')).toBe(true);
  });

  it.each(FINISHED_STATES)('does not treat %s as awaiting a decision', (state) => {
    expect(
      AWAITING_DECISION.has(state),
      `"${state}" is a finished state. Including it suppresses the caveat that tells an operator ` +
        'the verdict describes history rather than a plan awaiting confirmation.'
    ).toBe(false);
  });
});

describe('FINISHED', () => {
  it('is a non-empty set that never overlaps AWAITING_DECISION', () => {
    expect(FINISHED.size).toBeGreaterThan(0);
    const both = [...FINISHED].filter((state) => AWAITING_DECISION.has(state));
    expect(both, 'a state cannot be both over and waiting on someone').toEqual([]);
  });

  it.each(FINISHED_STATES)('treats %s as finished', (state) => {
    expect(FINISHED.has(state)).toBe(true);
  });

  it.each(IN_PROGRESS_STATES)('does not treat %s as finished', (state) => {
    // The caveat reads FINISHED to choose between "already finished" and "still
    // running". Including an executing state here would tell an operator a
    // mid-apply run was settled.
    expect(
      FINISHED.has(state),
      `"${state}" is a run in flight. Calling it finished tells the operator the change is over when it is not.`
    ).toBe(false);
  });
});
