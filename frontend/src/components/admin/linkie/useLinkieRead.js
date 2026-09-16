/**
 * One profile-scoped Linkie read, as a reloadable state bag (#577).
 *
 * The Links tab and the Analytics tab ask different endpoints for different
 * shapes, but the machinery either one needs is identical — and writing it
 * twice is the duplication Qlty measures.
 *
 * One settled result, tagged with the request that produced it. `loading` is
 * DERIVED from that tag rather than set at the top of the effect: a synchronous
 * setState in an effect body is a cascading render, and the React Compiler lint
 * (react-hooks/set-state-in-effect) rejects it.
 *
 * A failed read is REPLACED by the empty payload, never left beside its own
 * error: showing the previous profile's rows under "could not read" is the
 * defect #555 filed against the other hubs.
 */
import { useEffect, useState } from 'react';

/**
 * @param {string|null} profileId the profile to read, or null for none
 * @param {{fetch: (profileId: string) => Promise<object>, parse: (response: object) => object, empty: object}} read
 *   the endpoint, how to turn its response into the bag's payload (including
 *   the `error` string when Linkie refused), and what "nothing read" looks
 *   like. It is a dependency of the effect, so it must be a module-level
 *   constant at the call site — an object literal built during render would
 *   re-run the read on every render.
 */
export default function useLinkieRead(profileId, read) {
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState({ key: '', ...read.empty, error: '' });

  useEffect(() => {
    if (!profileId) return undefined;
    let cancelled = false;
    const key = `${profileId}#${reloadToken}`;
    const settle = (next) => {
      if (!cancelled) setResult({ key, ...next });
    };
    read
      .fetch(profileId)
      .then((response) => settle(read.parse(response)))
      .catch((err) => settle({ ...read.empty, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [profileId, reloadToken, read]);

  return {
    result,
    setResult,
    loading: Boolean(profileId) && result.key !== `${profileId}#${reloadToken}`,
    reload: () => setReloadToken((n) => n + 1),
  };
}
