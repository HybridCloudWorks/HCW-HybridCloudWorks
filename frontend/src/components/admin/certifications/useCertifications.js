/**
 * The Certifications Hub's one admin read, `GET cms/certifications`, and the
 * writes that change it. Shared by Catalog, Featured, Renewals, Settings and
 * the diff on Publishing, so it lives at page level: switching tabs never
 * refetches, and an edit on one tab is on every other.
 *
 * Race-safe the way the Newsletter Hub hardened it in #555 (and the Health
 * Hub's useOpsSnapshot does):
 *
 * - every read goes through one generation counter, so a slow read that
 *   resolves after a newer one is dropped instead of painting older rows;
 * - unmounting (or auth going away) supersedes the read in flight;
 * - a FAILED read empties the list rather than leaving old rows beside an
 *   error that says they could not be read;
 * - a write that lands while a read is in flight makes that read stale (it
 *   may have been answered before the write), so the read is re-issued rather
 *   than painted over the write;
 * - writes are guarded per certification: a second toggle or delete on a cert
 *   whose first write has not answered is ignored, not sent twice.
 *
 * `refresh` never throws: it resolves true when its read landed and false
 * when it failed or was superseded; the failure is in `error`.
 *
 * The hook only holds state. The read below and the writes in certWrites.js
 * are module-level functions over one state bag, so each has a single exit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJSON } from '@/lib/api';
import { COLLECTION, sortByDisplayOrder } from './certView';
import { patchCert, removeCert, upsertCert, useWriteGuard } from './certWrites';

const EMPTY = Object.freeze([]);

/** One GET of the collection, as `{ rows }` or `{ error }` — never throws. */
async function fetchRows() {
  let outcome;
  try {
    const res = await getJSON(`cms/${COLLECTION}`);
    const rows = (res?.items || []).map((item) => ({ _docId: item.id, ...item }));
    outcome = { rows: sortByDisplayOrder(rows) };
  } catch (error) {
    outcome = { error };
  }
  return outcome;
}

/** Paint one current read: its rows, or an empty list and the error. True when rows landed. */
function applyOutcome(state, outcome) {
  state.setPending(false);
  if (outcome.rows) {
    state.setItems(outcome.rows);
    state.setLoaded(true);
  } else {
    const err = outcome.error;
    console.error('[Certifications] load failed', err);
    state.setItems(EMPTY);
    state.setLoaded(false);
    state.setError(err?.message || String(err));
    state.toastRef.current?.({
      title: 'Failed to load',
      description: err?.message,
      variant: 'destructive',
    });
  }
  return Boolean(outcome.rows);
}

/**
 * Read as generation `first`. A superseded read paints nothing; a read that a
 * write overtook is re-issued as a new generation rather than painted.
 */
async function readList(state, first) {
  let mine = first;
  let landed = false;
  let settled = false;
  while (!settled) {
    const epoch = state.writes.current;
    const outcome = await fetchRows();
    if (mine !== state.generation.current) {
      settled = true;
    } else if (epoch !== state.writes.current) {
      mine = ++state.generation.current;
    } else {
      landed = applyOutcome(state, outcome);
      settled = true;
    }
  }
  return landed;
}

function refreshList(state) {
  const mine = ++state.generation.current;
  state.setPending(true);
  state.setError('');
  return readList(state, mine);
}

/** The first read once auth is ready; its cleanup supersedes whatever is in flight. */
function startList(state, authReady) {
  let cleanup;
  if (authReady) {
    readList(state, ++state.generation.current);
    cleanup = () => {
      state.generation.current += 1;
    };
  }
  return cleanup;
}

export default function useCertifications(authReady, { toast } = {}) {
  const [items, setItems] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const writes = useRef(0);
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  const { busyIds, claim, release } = useWriteGuard();

  const state = useMemo(
    () => ({
      setItems,
      setLoaded,
      setPending,
      setError,
      generation,
      writes,
      toastRef,
      claim,
      release,
    }),
    [claim, release]
  );

  useEffect(() => startList(state, authReady), [state, authReady]);

  const refresh = useCallback(() => refreshList(state), [state]);
  const upsertLocal = useCallback((saved) => upsertCert(state, saved), [state]);
  const patch = useCallback((cert, changes) => patchCert(state, cert, changes), [state]);
  const remove = useCallback((cert) => removeCert(state, cert), [state]);

  return {
    items,
    loaded,
    loading: pending && !loaded,
    error,
    refresh,
    upsertLocal,
    patch,
    remove,
    busyIds,
  };
}
