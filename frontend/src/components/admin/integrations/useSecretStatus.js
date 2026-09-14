/**
 * `GET cms/secrets`, owned by whichever tab mounts it (#570).
 *
 * Each tab that needs the credential lights calls this itself, so a failure
 * belongs to that tab alone and never blanks the tab bar or another tab.
 *
 * Race-safety, as the Newsletter Hub hardened it in #555:
 *   - every load takes a generation number, and only the newest may write
 *     state, so a slow first load cannot land over a Refresh;
 *   - unmounting bumps the generation, so nothing writes after the tab closes;
 *   - a failed load CLEARS the data it replaces. Lights from before a refused
 *     refresh are not lights any more, and showing them beside the error would
 *     be the page contradicting itself.
 *
 * The response never carries a value (the route has no read path for one), and
 * nothing here asks for one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { getJSON } from '@/lib/api';

export const SECRETS_ROUTE = 'cms/secrets';

export default function useSecretStatus() {
  // Every cms/secrets route is super_admin, so a fetch before the token exists
  // is a guaranteed 401 that renders as "could not load".
  const { authReady } = useAuthReady();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const generation = useRef(0);

  // State is only ever set in the promise callbacks, and only by the newest load.
  const fetchStatus = useCallback((mine) => {
    const current = () => mine === generation.current;
    return getJSON(SECRETS_ROUTE)
      .then((response) => {
        if (!current()) return;
        setData(response);
        setError(null);
      })
      .catch((err) => {
        if (!current()) return;
        setData(null);
        setError(err?.message ?? 'Could not load credential status.');
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
  }, []);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    return fetchStatus(mine);
  }, [fetchStatus]);

  useEffect(() => {
    if (!authReady) return undefined;
    fetchStatus(++generation.current);
    return () => {
      generation.current += 1;
    };
  }, [authReady, fetchStatus]);

  return { data, loading, error, reload };
}
