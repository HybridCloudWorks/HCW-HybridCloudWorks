/**
 * The Code and Security tab's read: `GET cms/code-quality` (#569).
 *
 * NOT READ ON PAGE LOAD. The route pages through every open Qlty issue and
 * caches the answer for ten minutes, so it is read the first time the tab is
 * opened and on Refresh, and never merely because someone opened the hub.
 * `enabled` turning true is the request; turning false again (another tab)
 * does not cancel it, so the answer is waiting when the tab is reopened.
 *
 * The same generation guard as `useOpsSnapshot` (#555):
 * - a slow read that resolves after a newer one is dropped;
 * - unmounting supersedes whatever is in flight;
 * - a FAILED read empties what was shown, so no stale grades sit beside the
 *   error.
 *
 * "Not configured" is an answer, not an error: the route says 200
 * `{ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' }`, and the tab shows where
 * to add the key. Any other `ok: false` body, and every thrown HTTP failure
 * (429, 502, 500), is `error`.
 *
 * `refresh` never throws: true when its read landed, false otherwise.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getJSON } from '@/lib/api';
import { NOT_CONFIGURED_CODE } from './codeQuality';

export const CODE_QUALITY_ROUTE = 'cms/code-quality';

/** The body when it is an answer this tab renders; throws for anything else. */
function acceptBody(body) {
  if (body?.ok === true) return body;
  if (body?.ok === false && body.code === NOT_CONFIGURED_CODE) return body;
  throw new Error(body?.error || 'The Code and Security summary could not be read.');
}

export default function useCodeQuality(enabled) {
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  // Whether the first read has started, and whether any read has answered
  // (data, not-configured or an error). Refs, not state, so nothing is set
  // during render: the first time `enabled` is true, the effect below starts
  // the one read, and later toggles of `enabled` start nothing.
  const started = useRef(false);
  const answered = useRef(false);

  const read = useCallback(async (mine) => {
    const current = () => mine === generation.current;
    let landed = false;
    try {
      const body = acceptBody(await getJSON(CODE_QUALITY_ROUTE));
      if (current()) {
        setResult(body);
        answered.current = true;
        landed = true;
      }
    } catch (err) {
      if (current()) {
        setResult(null);
        setError(err?.message || 'The Code and Security summary could not be read.');
        answered.current = true;
      }
    } finally {
      if (current()) setPending(false);
    }
    return landed;
  }, []);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    setPending(true);
    setError('');
    return read(mine);
  }, [read]);

  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      read(++generation.current);
    }
  }, [enabled, read]);

  // Unmount supersedes the read in flight. If nothing has answered yet, the
  // next mount (including StrictMode's dev remount) must be free to start again.
  useEffect(
    () => () => {
      generation.current += 1;
      if (!answered.current) started.current = false;
    },
    []
  );

  // "Asked for": the tab is open now, or an answer from an earlier open is held.
  const requested = enabled || result !== null || error !== '';

  return {
    requested,
    loading: requested && pending && result === null,
    refreshing: pending && result !== null,
    data: result?.ok === true ? result : null,
    notConfigured: result?.ok === false ? result : null,
    error,
    refresh,
  };
}
