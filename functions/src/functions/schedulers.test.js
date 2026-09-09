/**
 * A flag-disabled timer is visible in Log Analytics once per restart.
 *
 * `host.json` holds the `Function` log category at Warning, so `context.log`
 * (Information) never ships. Until #461 item 12 the "disabled — skipping"
 * line was logged at that level, and a timer whose feature flag was left off
 * could not be told apart from one that never fired. Owner decision: the
 * first skip of each timer in a process is a Warning; every later skip in the
 * same process is Information, so a timer that is deliberately off does not
 * raise a Warning on every schedule tick.
 *
 * Runs the real registered handlers through the same `@azure/functions` mock
 * `timer-schedules-utc.test.js` uses, so this tests the wiring in
 * schedulers.js rather than a helper the wiring could forget to call.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** Registrations recorded in place of the real Functions host. */
const timerRegistrations = new Map();

vi.mock('@azure/functions', () => ({
  app: {
    http: () => {},
    timer: (name, options) => timerRegistrations.set(name, options),
    cosmosDB: () => {},
    storageQueue: () => {},
  },
  output: {
    storageQueue: (options) => ({ type: 'queue', ...options }),
  },
}));

await import('./schedulers.js');

const fakeContext = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

const previousMaster = process.env.FEATURE_FLAG_SCHEDULERS;

beforeAll(() => {
  // The master switch off makes every timer's flag irrelevant, so no
  // per-timer FEATURE_FLAG_* in the environment can enable one here.
  process.env.FEATURE_FLAG_SCHEDULERS = 'false';
});

afterAll(() => {
  if (previousMaster === undefined) delete process.env.FEATURE_FLAG_SCHEDULERS;
  else process.env.FEATURE_FLAG_SCHEDULERS = previousMaster;
});

describe('a flag-disabled timer skip', () => {
  it('registered the timers at all', () => {
    // Guards the guard: an empty map would let every assertion below pass on
    // a handler that does not exist.
    expect(timerRegistrations.size).toBeGreaterThan(10);
    expect(timerRegistrations.has('syncRssFeeds')).toBe(true);
    expect(timerRegistrations.has('scrapeSkillsHubRss')).toBe(true);
  });

  it('logs a Warning the first time in the process, then Information', async () => {
    const { handler } = timerRegistrations.get('syncRssFeeds');

    const first = fakeContext();
    await handler({}, first);
    expect(first.warn).toHaveBeenCalledTimes(1);
    expect(first.warn.mock.calls[0][0]).toMatch(/^\[syncRssFeeds\] disabled — skipping/);
    expect(first.log).not.toHaveBeenCalled();

    const second = fakeContext();
    await handler({}, second);
    expect(second.warn).not.toHaveBeenCalled();
    expect(second.log).toHaveBeenCalledTimes(1);
    expect(second.log.mock.calls[0][0]).toBe('[syncRssFeeds] disabled — skipping');

    // Neither call reached the timer's own work, so nothing else was logged.
    expect(first.error).not.toHaveBeenCalled();
    expect(second.error).not.toHaveBeenCalled();
  });

  it('warns once per timer, not once per process', async () => {
    // A second timer skipped after the first still gets its own Warning: the
    // set is keyed by timer name, so every disabled timer shows up in Log
    // Analytics after a restart, not only whichever one ticked first.
    const { handler } = timerRegistrations.get('scrapeSkillsHubRss');
    const context = fakeContext();
    await handler({}, context);
    expect(context.warn).toHaveBeenCalledTimes(1);
    expect(context.warn.mock.calls[0][0]).toMatch(/^\[scrapeSkillsHubRss\] disabled — skipping/);
    expect(context.log).not.toHaveBeenCalled();
  });
});
