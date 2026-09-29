/**
 * The pure half of a synchronous AI call's time budget (router.js header,
 * SYNCHRONOUS CALLS HAVE A TIME BUDGET). The router-level behaviour, with
 * real timeouts against a fetch that never answers, is in router.test.js.
 */
import { describe, it, expect } from 'vitest';
import {
  AFTER_MODEL_MARGIN_MS,
  MIN_ATTEMPT_MS,
  providerShareMs,
  startBudget,
  startBudgetClock,
} from './time-budget.js';

describe('startBudget', () => {
  it('sets the deadline on the caller clock and holds half back for failover', () => {
    expect(startBudget(60_000, 1_000)).toEqual({
      totalMs: 60_000,
      deadline: 61_000,
      reserveMs: 30_000,
    });
    expect(startBudget(15_001, 0).reserveMs).toBe(7_500);
  });

  it.each([Number.NaN, Infinity, -Infinity, -1, '60000', null])(
    'treats %s as no time at all, so a caller bug fails before anything is sent',
    (bad) => {
      expect(startBudget(bad, 5)).toEqual({ totalMs: 0, deadline: 5, reserveMs: 0 });
    }
  );
});

describe('providerShareMs', () => {
  it('leaves the reserve for the provider behind, when that still leaves a whole attempt', () => {
    expect(providerShareMs({ remainingMs: 60_000, reserveMs: 30_000, hasNext: true })).toBe(30_000);
  });

  it('uses everything that is left when the reserve would leave less than an attempt', () => {
    // The provider behind could not have had a useful attempt either way.
    expect(providerShareMs({ remainingMs: 30_000, reserveMs: 30_000, hasNext: true })).toBe(30_000);
    expect(providerShareMs({ remainingMs: 34_999, reserveMs: 30_000, hasNext: true })).toBe(34_999);
  });

  it('gives the last provider everything that is left', () => {
    expect(providerShareMs({ remainingMs: 60_000, reserveMs: 30_000, hasNext: false })).toBe(60_000);
  });

  it('is 0, meaning send nothing, below one whole attempt', () => {
    expect(providerShareMs({ remainingMs: MIN_ATTEMPT_MS - 1, reserveMs: 0, hasNext: false })).toBe(0);
    expect(providerShareMs({ remainingMs: 0, reserveMs: 0, hasNext: true })).toBe(0);
    expect(providerShareMs({ remainingMs: -20_000, reserveMs: 0, hasNext: false })).toBe(0);
    expect(providerShareMs({ remainingMs: Number.NaN, reserveMs: 0, hasNext: false })).toBe(0);
  });

  it('is never negative, never a sliver below MIN_ATTEMPT_MS, and never more than is left', () => {
    const remainders = [-5_000, 0, 1, 4_999, 5_000, 5_001, 9_999, 10_000, 14_000, 37_500, 70_000];
    const reserves = [0, 2_500, 5_000, 7_000, 30_000, 35_000, 60_000];
    for (const remainingMs of remainders) {
      for (const reserveMs of reserves) {
        for (const hasNext of [true, false]) {
          const share = providerShareMs({ remainingMs, reserveMs, hasNext });
          const where = JSON.stringify({ remainingMs, reserveMs, hasNext, share });
          expect(share >= 0, where).toBe(true);
          expect(share === 0 || share >= MIN_ATTEMPT_MS, where).toBe(true);
          expect(share <= Math.max(0, remainingMs), where).toBe(true);
        }
      }
    }
  });
});

describe('startBudgetClock', () => {
  it('reads undefined with no budget, so a background caller passes none on', () => {
    expect(startBudgetClock(undefined)()).toBeUndefined();
    expect(startBudgetClock(null)()).toBeUndefined();
  });

  it('reads what is left after the work done since it started', () => {
    let t = 1_000;
    const left = startBudgetClock(75_000, () => t);
    expect(left()).toBe(75_000);
    t += 12_345;
    expect(left()).toBe(62_655);
  });

  it('keeps a margin for the work after the model that is a small part of any HTTP budget', () => {
    // It comes off a 75 s handler budget; it must never swallow a 20 s one.
    expect(AFTER_MODEL_MARGIN_MS).toBeGreaterThan(0);
    expect(AFTER_MODEL_MARGIN_MS).toBeLessThan(20_000 - 2 * MIN_ATTEMPT_MS);
  });
});
