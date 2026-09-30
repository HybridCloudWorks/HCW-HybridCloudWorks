/**
 * The gate all 23 timers go through (#817).
 *
 * schedulers.test.js covers the master switch set to "false"; nothing pinned
 * the rest. The rule is deliberately strict in one direction and loose in the
 * other: a timer runs only on an exact "true", and the master switch stops
 * them all only on an exact "false". Terraform writes exactly those strings,
 * so anything else is a hand-edited setting, and the safe reading of a
 * hand-edited setting is "off" for a timer and "not an instruction" for the
 * master.
 */
import { describe, it, expect, vi } from 'vitest';
import { logDisabledSkip, timerEnabled } from './flag-gate.js';

describe('timerEnabled', () => {
  it('arms a timer only on an exact "true"', () => {
    expect(timerEnabled('X', { FEATURE_FLAG_X: 'true' })).toBe(true);
    for (const value of [undefined, '', 'TRUE', 'True', '1', 'yes', ' true', 'false']) {
      expect(timerEnabled('X', { FEATURE_FLAG_X: value }), String(value)).toBe(false);
    }
  });

  it('lets the master switch stop every timer, but only on an exact "false"', () => {
    const on = { FEATURE_FLAG_X: 'true' };
    expect(timerEnabled('X', { ...on, FEATURE_FLAG_SCHEDULERS: 'false' })).toBe(false);
    // Absent or anything else is not an instruction to stop.
    for (const value of [undefined, '', 'true', 'FALSE', '0']) {
      expect(timerEnabled('X', { ...on, FEATURE_FLAG_SCHEDULERS: value }), String(value)).toBe(true);
    }
  });

  it('reads the flag named for the timer, and no other', () => {
    expect(timerEnabled('PUBLISH_SCHEDULED_CONTENT', { FEATURE_FLAG_OTHER: 'true' })).toBe(false);
    expect(
      timerEnabled('PUBLISH_SCHEDULED_CONTENT', { FEATURE_FLAG_PUBLISH_SCHEDULED_CONTENT: 'true' })
    ).toBe(true);
  });
});

describe('logDisabledSkip', () => {
  const context = () => ({ log: vi.fn(), warn: vi.fn() });

  it('warns on the first skip of a timer, then logs at Information', () => {
    // Warning is what reaches Log Analytics (host.json), so the first skip
    // after a restart is visible and the rest do not raise a Warning per tick.
    const first = context();
    logDisabledSkip(first, 'FLAG_GATE_TEST_ONCE');
    expect(first.warn).toHaveBeenCalledWith(expect.stringContaining('[FLAG_GATE_TEST_ONCE] disabled'));
    expect(first.log).not.toHaveBeenCalled();

    const later = context();
    logDisabledSkip(later, 'FLAG_GATE_TEST_ONCE');
    logDisabledSkip(later, 'FLAG_GATE_TEST_ONCE');
    expect(later.warn).not.toHaveBeenCalled();
    expect(later.log).toHaveBeenCalledTimes(2);
  });

  it('counts each timer separately', () => {
    const ctx = context();
    logDisabledSkip(ctx, 'FLAG_GATE_TEST_A');
    logDisabledSkip(ctx, 'FLAG_GATE_TEST_B');
    expect(ctx.warn).toHaveBeenCalledTimes(2);
  });
});
