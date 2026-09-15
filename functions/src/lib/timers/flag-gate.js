/**
 * The per-timer feature-flag gate, shared by every timer registration.
 *
 * A timer runs when the master switch `FEATURE_FLAG_SCHEDULERS` is not
 * explicitly "false" AND its own `FEATURE_FLAG_<NAME>` is "true". It lived
 * inside schedulers.js until the pricing refresh timer (#613) needed the same
 * gate from a second file; jobs-sweeper.js and cosmos-export.js each carry a
 * private copy of the boolean, and this is the one the skip log belongs to.
 */

const masterDisabled = (env) => env.FEATURE_FLAG_SCHEDULERS === 'false';

/**
 * @param {string} name - env var suffix, e.g. 'PUBLISH_SCHEDULED_CONTENT'
 * @param {NodeJS.ProcessEnv} [env]
 */
export const timerEnabled = (name, env = process.env) =>
  !masterDisabled(env) && env[`FEATURE_FLAG_${name}`] === 'true';

/**
 * Timers that have already logged a flag-disabled skip in this process.
 *
 * `host.json` holds the `Function` category at Warning, so an Information
 * line never reaches Log Analytics — and from 2026-09-02 a timer whose flag
 * was left off left no trace there beyond a suspiciously short `DurationMs`
 * (#461 item 12). The first skip after every restart is therefore logged at
 * Warning, which ships; every later skip in the same process drops back to
 * Information, so a timer that is deliberately off does not raise a Warning
 * on each schedule tick. Module-level on purpose: the set lives exactly as
 * long as the process, which is what "once per restart" means.
 */
const skipWarned = new Set();

/** @param {import('@azure/functions').InvocationContext} context */
export function logDisabledSkip(context, name) {
  if (skipWarned.has(name)) {
    context.log(`[${name}] disabled — skipping`);
    return;
  }
  skipWarned.add(name);
  context.warn(
    `[${name}] disabled — skipping (first skip since this process started; later skips log at Information)`
  );
}
