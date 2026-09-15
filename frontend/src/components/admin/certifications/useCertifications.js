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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getJSON, sendJSON } from '@/lib/api';
import { COLLECTION, sortByDisplayOrder } from './certView';

const EMPTY = Object.freeze([]);

/** One GET of the collection, as `{ rows }` or `{ error }` — never throws. */
async function fetchRows() {
  try {
    const res = await getJSON(`cms/${COLLECTION}`);
    const rows = (res?.items || []).map((item) => ({ _docId: item.id, ...item }));
    return { rows: sortByDisplayOrder(rows) };
  } catch (error) {
    return { error };
  }
}

function useWriteGuard() {
  const inFlight = useRef(new Set());
  const [busyIds, setBusyIds] = useState(() => new Set());

  const claim = useCallback((id) => {
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    setBusyIds(new Set(inFlight.current));
    return true;
  }, []);
  const release = useCallback((id) => {
    inFlight.current.delete(id);
    setBusyIds(new Set(inFlight.current));
  }, []);
  return { busyIds, claim, release };
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

  const read = useCallback(async (first) => {
    let mine = first;
    for (;;) {
      const epoch = writes.current;
      const outcome = await fetchRows();
      if (mine !== generation.current) return false;
      // A write answered while this read was out: re-read rather than paint
      // rows that may predate it.
      if (epoch !== writes.current) {
        mine = ++generation.current;
        continue;
      }
      setPending(false);
      if (outcome.rows) {
        setItems(outcome.rows);
        setLoaded(true);
        return true;
      }
      const err = outcome.error;
      console.error('[Certifications] load failed', err);
      setItems(EMPTY);
      setLoaded(false);
      setError(err?.message || String(err));
      toastRef.current?.({
        title: 'Failed to load',
        description: err?.message,
        variant: 'destructive',
      });
      return false;
    }
  }, []);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    setPending(true);
    setError('');
    return read(mine);
  }, [read]);

  useEffect(() => {
    if (!authReady) return undefined;
    read(++generation.current);
    return () => {
      generation.current += 1;
    };
  }, [authReady, read]);

  /** Put a row the editor saved into the list: replace by id, else append. */
  const upsertLocal = useCallback((saved) => {
    writes.current += 1;
    setItems((p) => {
      const idx = p.findIndex((x) => x._docId === saved._docId);
      if (idx === -1) return [...p, saved];
      const copy = [...p];
      copy[idx] = saved;
      return copy;
    });
  }, []);

  /** PATCH one cert. Resolves true when it landed, false when refused or already in flight. */
  const patch = useCallback(
    async (cert, changes) => {
      if (!claim(cert._docId)) return false;
      try {
        await sendJSON(`cms/${COLLECTION}/${cert._docId}`, 'PATCH', changes);
        writes.current += 1;
        setItems((p) => p.map((c) => (c._docId === cert._docId ? { ...c, ...changes } : c)));
        return true;
      } catch (err) {
        toastRef.current?.({
          title: 'Update failed',
          description: err.message,
          variant: 'destructive',
        });
        return false;
      } finally {
        release(cert._docId);
      }
    },
    [claim, release]
  );

  const remove = useCallback(
    async (cert) => {
      if (!claim(cert._docId)) return false;
      try {
        await sendJSON(`cms/${COLLECTION}/${cert._docId}`, 'DELETE');
        writes.current += 1;
        setItems((p) => p.filter((c) => c._docId !== cert._docId));
        toastRef.current?.({ title: 'Deleted' });
        return true;
      } catch (err) {
        toastRef.current?.({
          title: 'Delete failed',
          description: err.message,
          variant: 'destructive',
        });
        return false;
      } finally {
        release(cert._docId);
      }
    },
    [claim, release]
  );

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
