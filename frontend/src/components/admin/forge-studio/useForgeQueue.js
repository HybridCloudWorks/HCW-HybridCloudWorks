/**
 * The Forge Studio Queue's reads and writes (owner request 2026-10-06), held
 * at page level so Start can add to it and the Queue tab can work it:
 *
 *   GET  cms/forge/queue          the entries
 *   POST cms/forge/queue          { urls }            add
 *   POST cms/forge/queue/update   { ids, fields }     apply fields; { ids, remove: true } removes
 *   POST cms/forge/queue/forge    { ids }             start a forge-from-url job per entry
 *
 * Every answer carries the whole list, so the state is always the server's.
 * While any entry is forging the list is re-read every REFRESH_MS: the job's
 * onComplete writes the outcome server-side, and the tab shows it without a
 * reload.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getJSON, postJSON } from '@/lib/api';

export const REFRESH_MS = 20000;

const EMPTY = Object.freeze({
  status: 'idle',
  items: [],
  total: 0,
  max: 200,
  error: null,
  busy: null,
});

export function useForgeQueue({ enabled = true } = {}) {
  const [state, setState] = useState(EMPTY);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const take = useCallback((answer) => {
    if (!mounted.current) return answer;
    if (!answer?.ok) throw new Error(answer?.error || 'The queue did not answer.');
    setState((current) => ({
      ...current,
      status: 'ready',
      items: answer.items || [],
      total: answer.total ?? (answer.items || []).length,
      max: answer.max ?? current.max,
      error: null,
    }));
    return answer;
  }, []);

  const load = useCallback(async () => {
    setState((current) => ({
      ...current,
      status: current.status === 'idle' ? 'loading' : current.status,
    }));
    try {
      return take(await getJSON('cms/forge/queue'));
    } catch (err) {
      if (mounted.current) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: err?.message || 'The queue could not be read.',
        }));
      }
      return null;
    }
  }, [take]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  // Re-read while a job is running, so forged/failed arrive on their own.
  const forging = state.items.some((item) => item.status === 'forging');
  useEffect(() => {
    if (!enabled || !forging) return undefined;
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, forging, load]);

  /** One write: `busy` names it, the answer replaces the list, an error lands on the state. */
  const write = useCallback(
    async (busy, call) => {
      setState((current) => ({ ...current, busy, error: null }));
      try {
        return await take(await call());
      } catch (err) {
        if (mounted.current) {
          setState((current) => ({ ...current, error: err?.message || 'The queue write failed.' }));
        }
        return null;
      } finally {
        if (mounted.current) setState((current) => ({ ...current, busy: null }));
      }
    },
    [take]
  );

  const add = useCallback(
    (urls) => write('add', () => postJSON('cms/forge/queue', { urls })),
    [write]
  );
  const update = useCallback(
    (ids, fields) => write('update', () => postJSON('cms/forge/queue/update', { ids, fields })),
    [write]
  );
  const remove = useCallback(
    (ids) => write('remove', () => postJSON('cms/forge/queue/update', { ids, remove: true })),
    [write]
  );
  const forge = useCallback(
    (ids) => write('forge', () => postJSON('cms/forge/queue/forge', { ids })),
    [write]
  );
  const clearError = useCallback(() => setState((current) => ({ ...current, error: null })), []);

  return { ...state, load, add, update, remove, forge, clearError };
}
