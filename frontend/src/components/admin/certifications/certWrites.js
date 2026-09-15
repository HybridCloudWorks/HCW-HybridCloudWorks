/**
 * The Certifications Hub's writes, as plain functions over the list hook's
 * state bag (`useCertifications` builds it): the per-cert in-flight guard, the
 * PATCH and DELETE paths, and the editor's local upsert. Kept out of the hook
 * so each path is one small function with one exit.
 *
 * Every write that lands bumps `writes`, which is how a read already in flight
 * learns it may predate the write and must be re-issued (useCertifications).
 */

import { useCallback, useRef, useState } from 'react';
import { sendJSON } from '@/lib/api';
import { COLLECTION } from './certView';

/**
 * Per-cert in-flight guard. `claim(id)` is false when a write to that cert is
 * already out; `busyIds` is the set the cards disable their buttons from.
 */
export function useWriteGuard() {
  const inFlight = useRef(new Set());
  const [busyIds, setBusyIds] = useState(() => new Set());

  const claim = useCallback((id) => {
    const free = !inFlight.current.has(id);
    if (free) {
      inFlight.current.add(id);
      setBusyIds(new Set(inFlight.current));
    }
    return free;
  }, []);
  const release = useCallback((id) => {
    inFlight.current.delete(id);
    setBusyIds(new Set(inFlight.current));
  }, []);
  return { busyIds, claim, release };
}

/** The list with `saved` replacing the row of the same id, or appended. */
export function upsertRow(rows, saved) {
  const copy = [...rows];
  const idx = copy.findIndex((x) => x._docId === saved._docId);
  if (idx === -1) copy.push(saved);
  else copy[idx] = saved;
  return copy;
}

/**
 * One guarded write to one cert: claim it, send, apply the change to the list
 * and count the write, or toast the failure; release either way. Resolves true
 * only when the write landed; a cert already being written is not sent.
 */
async function writeCert(state, cert, { send, apply, success, failure }) {
  const id = cert._docId;
  let landed = false;
  if (state.claim(id)) {
    try {
      await send();
      state.writes.current += 1;
      state.setItems(apply);
      if (success) state.toastRef.current?.(success);
      landed = true;
    } catch (err) {
      state.toastRef.current?.({
        title: failure,
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      state.release(id);
    }
  }
  return landed;
}

/** PATCH one cert. Resolves true when it landed, false when refused or already in flight. */
export function patchCert(state, cert, changes) {
  return writeCert(state, cert, {
    send: () => sendJSON(`cms/${COLLECTION}/${cert._docId}`, 'PATCH', changes),
    apply: (rows) => rows.map((c) => (c._docId === cert._docId ? { ...c, ...changes } : c)),
    failure: 'Update failed',
  });
}

/** DELETE one cert and drop its row. Same contract as patchCert. */
export function removeCert(state, cert) {
  return writeCert(state, cert, {
    send: () => sendJSON(`cms/${COLLECTION}/${cert._docId}`, 'DELETE'),
    apply: (rows) => rows.filter((c) => c._docId !== cert._docId),
    success: { title: 'Deleted' },
    failure: 'Delete failed',
  });
}

/** Put a row the editor saved into the list (the editor already sent it). */
export function upsertCert(state, saved) {
  state.writes.current += 1;
  state.setItems((rows) => upsertRow(rows, saved));
}
