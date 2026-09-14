/**
 * This session's connection tests, held by the Integrations Hub page (#570).
 *
 * Lives on the page rather than in a tab so a result survives switching tabs:
 * a test run from a Services card shows on the Overview grid, and "Test all"
 * keeps going if the Overview tab is left. It is not persisted — "last tested"
 * means in this browser session, and says so.
 *
 * The tests themselves are the registry's own `service.test` functions, called
 * exactly as the cards always called them. Nothing here builds a request.
 *
 * Race-safety:
 *   - a service already under test is not started again (an in-flight set, in
 *     a ref, so two clicks in one tick cannot both pass the check);
 *   - "Test all" runs ONE AT A TIME, awaiting each before the next, so pressing
 *     it sends one request to each provider in turn rather than a burst to all
 *     of them; and a second press while it runs does nothing;
 *   - while "Test all" runs, a test started from a card is refused too, so
 *     the one-provider-at-a-time guarantee holds from either direction;
 *   - a service marked `skipInTestAll` (YouTube, which spends quota) is left
 *     out of "Test all"; the Overview says so on its tile, so it is never
 *     silent, and any result from testing it on its own is kept.
 */

import { useCallback, useRef, useState } from 'react';

const stamp = () => new Date().toISOString();

export default function useServiceTests() {
  const [results, setResults] = useState({});
  const [testing, setTesting] = useState(() => new Set());
  const [runningAll, setRunningAll] = useState(false);
  const inFlight = useRef(new Set());
  const allInFlight = useRef(false);

  // The test itself. `runAll` calls this directly; everything else goes
  // through `runTest`, which refuses while "Test all" owns the queue.
  const startTest = useCallback(async (service, arg) => {
    if (!service?.test || inFlight.current.has(service.id)) return null;
    inFlight.current.add(service.id);
    setTesting(new Set(inFlight.current));
    let result;
    try {
      result = { ok: true, message: await service.test(arg), at: stamp() };
    } catch (err) {
      result = { ok: false, message: err?.message ?? 'The test failed.', at: stamp() };
    } finally {
      inFlight.current.delete(service.id);
      setTesting(new Set(inFlight.current));
    }
    setResults((previous) => ({ ...previous, [service.id]: result }));
    return result;
  }, []);

  const runTest = useCallback(
    (service, arg) => (allInFlight.current ? Promise.resolve(null) : startTest(service, arg)),
    [startTest]
  );

  /**
   * @param {ReadonlyArray<object>} services
   * @param {(service: object) => Promise<unknown>|unknown} argFor what to pass
   *   each test (Sessionize takes its speaker id), resolved just before it runs
   */
  const runAll = useCallback(
    async (services, argFor = () => undefined) => {
      // Not while any test is already running (e.g. one started from a Services
      // card): runTest skips a service in flight without awaiting it, which
      // would let "Test all" start the next provider concurrently.
      if (allInFlight.current || inFlight.current.size > 0) return;
      allInFlight.current = true;
      setRunningAll(true);
      try {
        for (const service of services) {
          if (!service.test || service.skipInTestAll) continue;
          await startTest(service, await argFor(service));
        }
      } finally {
        allInFlight.current = false;
        setRunningAll(false);
      }
    },
    [startTest]
  );

  return { results, testing, runningAll, runTest, runAll };
}
