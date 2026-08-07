import { useEffect, useRef, useState } from 'react';

/**
 * Tiny data hook for the anonymous public API (lib/publicApi.js) — the
 * replacement for the useFirestore* hooks on public pages.
 *
 * Callers pass the fetcher as an inline arrow function (a new reference every
 * render), so the fetch effect is keyed on `key` instead — a stable string
 * that only changes when the query meaningfully changes. This is the same
 * optionsKey pattern the Firestore hooks used to avoid infinite re-fetch
 * loops. A falsy key disables the fetch entirely, mirroring the ''
 * collection-path idiom the conditional legacy fallbacks relied on.
 *
 * Previous data is kept on screen while a new key loads (no empty flash when
 * e.g. the provider changes) — matching the Firestore hooks' behavior.
 *
 * @param {() => Promise<any>} fetcher
 * @param {string} key - stable identity of the query; '' disables
 * @returns {{ data: any, loading: boolean, error: Error|null }}
 */
export function usePublicData(fetcher, key) {
  const normalizedKey = key || '';
  const [state, setState] = useState({
    key: normalizedKey,
    data: null,
    loading: Boolean(normalizedKey),
    error: null,
  });

  // Adjust-during-render: when the key changes, flip to loading immediately
  // (before paint) while keeping the previous data visible.
  if (state.key !== normalizedKey) {
    setState((prev) => ({
      ...prev,
      key: normalizedKey,
      loading: Boolean(normalizedKey),
      error: null,
    }));
  }

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!normalizedKey) return undefined;
    let cancelled = false;

    fetcherRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, data: result, loading: false }));
        }
      })
      .catch((err) => {
        console.error('Public data fetch failed:', err);
        if (!cancelled) {
          setState((prev) => ({ ...prev, error: err, loading: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedKey]);

  return { data: state.data, loading: state.loading, error: state.error };
}

export default usePublicData;
