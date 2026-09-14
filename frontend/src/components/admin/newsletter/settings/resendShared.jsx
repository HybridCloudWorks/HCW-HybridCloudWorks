/**
 * Pieces shared by the Resend cards on the Mailing List Settings tab (#504):
 * the alert and loading lines, a status badge, a copy button, and the paging
 * hook for the emails and logs lists.
 *
 * Every card loads on its own and fails on its own, so a Resend outage or a
 * missing key shows inside the card that asked and never blocks the newsletter
 * settings above it. Errors are worded by `describeResendError`: 503 says
 * Resend is not configured, 429 says how long to wait, anything else is the
 * server's own reason.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Check, Copy, Loader2 } from 'lucide-react';
import { getJSON } from '@/lib/api';
import { describeResendError } from '../resendFormat';

export const RESEND_ROUTE = 'cms/mailing-list';
export const RESEND_PAGE_SIZE = 20;

export function Notice({ children }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function Loading({ children }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {children}
    </p>
  );
}

const GOOD_STATUSES = new Set(['verified', 'delivered', 'opened', 'clicked', 'sent', 'success']);
const BAD_STATUSES = new Set([
  'failed',
  'temporary_failure',
  'failure',
  'bounced',
  'complained',
  'canceled',
]);

/** The badge variant for a Resend status word: verified-like, failed-like, or neutral. */
export function statusVariant(status) {
  const value = String(status || '').toLowerCase();
  if (GOOD_STATUSES.has(value)) return 'default';
  if (BAD_STATUSES.has(value)) return 'destructive';
  return 'secondary';
}

/** A status as Resend sent it, with underscores read as spaces. */
export function StatusBadge({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={statusVariant(status)}>{String(status).replace(/_/g, ' ')}</Badge>;
}

/**
 * Copies `value` to the clipboard. Where the clipboard is unavailable (an
 * insecure origin, a refused permission) it says so, so the value can be
 * selected by hand instead.
 */
export function CopyButton({ value, label }) {
  const [state, setState] = useState('idle');
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(String(value ?? ''));
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2"
        onClick={copy}
        aria-label={label}
      >
        {state === 'copied' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      {state === 'failed' && (
        <span className="text-xs text-muted-foreground">
          Copy failed; select the value instead.
        </span>
      )}
    </span>
  );
}

/** A list route for one page, with the cursor when there is one. */
export function pagedRoute(path, after = null) {
  const params = new URLSearchParams({ limit: String(RESEND_PAGE_SIZE) });
  if (after) params.set('after', after);
  return `${RESEND_ROUTE}/${path}?${params.toString()}`;
}

/**
 * Rows from a paged Mailing List route (`emails` or `logs`), loaded when the
 * card mounts, with Load more following `next_after`.
 */
export function usePagedList(path, key) {
  const [rows, setRows] = useState([]);
  const [nextAfter, setNextAfter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (after) => {
      const mine = generation.current;
      const res = await getJSON(pagedRoute(path, after));
      if (mine !== generation.current) return;
      const page = Array.isArray(res?.[key]) ? res[key] : [];
      setRows((previous) => [...(after ? previous : []), ...page]);
      setNextAfter(res?.has_more && res?.next_after ? res.next_after : null);
      setError('');
    },
    [path, key]
  );

  const reload = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    setLoading(true);
    try {
      await fetchPage(null);
    } catch (err) {
      if (mine === generation.current) {
        setRows([]);
        setNextAfter(null);
        setError(describeResendError(err));
      }
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    queueMicrotask(reload);
  }, [reload]);

  // A ref, not the loadingMore state: a double click lands before the button
  // re-renders as disabled, and would fetch the same cursor twice.
  const loadingMoreRef = useRef(false);
  const loadMore = async () => {
    if (!nextAfter || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      await fetchPage(nextAfter);
    } catch (err) {
      // A reload started meanwhile discards this page, and its error with it.
      if (mine === generation.current) setError(describeResendError(err));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  return { rows, hasMore: Boolean(nextAfter), loading, loadingMore, error, reload, loadMore };
}

/** The Load more button under a paged table, shown only while there is more. */
export function LoadMore({ list }) {
  if (list.loading || !list.hasMore) return null;
  return (
    <Button variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
      {list.loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Load more
    </Button>
  );
}
