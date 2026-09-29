/**
 * time-budget.js — the arithmetic behind a synchronous AI call's time budget.
 *
 * The contract is in router.js's header, "SYNCHRONOUS CALLS HAVE A TIME
 * BUDGET". This is its pure half. It has no imports, so the handlers and the
 * drafter can measure what is left of a budget without loading the router.
 * prompt-fence.js is a module of its own for the same reason.
 */

/**
 * The shortest attempt worth sending. With less than this left, a provider is
 * not tried at all. A request cut off after a second or two cannot answer
 * what the call asked, and it still costs a slot in NVIDIA's window, or money.
 */
export const MIN_ATTEMPT_MS = 5_000;

/**
 * Held back from a handler's own budget for the work after the model
 * answers: a write, a render, the response. The handler's deadline and the
 * router's would otherwise race, and the handler's generic "exceeded" could
 * beat the router's error, which names each provider and why it failed.
 */
export const AFTER_MODEL_MARGIN_MS = 5_000;

/**
 * Start a budget: its deadline on `now`'s clock, and the failover reserve.
 *
 * The reserve is half the budget. It is held back from each provider that has
 * another behind it, so a slow first provider cannot spend the time the next
 * one needs to answer. Half, because the call's size is only known to its
 * caller: a caption and a draft need very different times, and half scales
 * with whichever budget the caller chose.
 *
 * A budget that is not a finite number is treated as no time at all. A caller
 * that computed NaN has a bug, and failing before anything is sent says so;
 * silently running without a budget would hide it.
 *
 * @param {number} budgetMs
 * @param {number} startedAt  `now()` when the call began
 * @returns {{ totalMs: number, deadline: number, reserveMs: number }}
 */
export function startBudget(budgetMs, startedAt) {
  const totalMs = Number.isFinite(budgetMs) ? Math.max(0, Math.floor(budgetMs)) : 0;
  return { totalMs, deadline: startedAt + totalMs, reserveMs: Math.floor(totalMs / 2) };
}

/**
 * How long one provider may spend on a budgeted call, its retries included.
 *
 * With another provider behind it, it stops early enough to leave `reserveMs`
 * for that one. The exception is when that would leave it less than
 * MIN_ATTEMPT_MS. Then it may use everything that remains, because the
 * provider behind it could not have had a useful attempt either way. The last
 * provider may always use everything that remains.
 *
 * Less than MIN_ATTEMPT_MS remaining is 0, and 0 means nothing is sent. So the
 * result is never negative and never between 0 and MIN_ATTEMPT_MS.
 *
 * @param {{ remainingMs: number, reserveMs: number, hasNext: boolean }} args
 * @returns {number}
 */
export function providerShareMs({ remainingMs, reserveMs, hasNext }) {
  // Written as a negated >= so that NaN is refused too.
  if (!(remainingMs >= MIN_ATTEMPT_MS)) return 0;
  if (hasNext && remainingMs - reserveMs >= MIN_ATTEMPT_MS) return remainingMs - reserveMs;
  return remainingMs;
}

/**
 * A caller's clock over its budget. Call the result to learn how much is left.
 *
 * A caller that does work before the model call, such as scraping a page or
 * reading a document, hands the router what remains, not what it started
 * with. With no budget the clock reads `undefined`, so a background caller
 * passes none on and the router behaves as it always has.
 *
 * @param {number|null|undefined} budgetMs
 * @param {() => number} [now]
 * @returns {() => number|undefined}
 */
export function startBudgetClock(budgetMs, now = () => Date.now()) {
  if (budgetMs === undefined || budgetMs === null) return () => undefined;
  const startedAt = now();
  return () => budgetMs - (now() - startedAt);
}
