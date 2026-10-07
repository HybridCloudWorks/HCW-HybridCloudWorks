/** The loading line and the error panel every Integrations Hub tab shares. */

import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

export function TabLoading({ children }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {children}
    </div>
  );
}

export function TabError({ message, onRetry }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The two notices every tab that reads key status shows: reading, and a
 * failed read that leaves only what the tests recorded. One place for the
 * sentence, since the Overview and the Directory would otherwise each carry
 * it. While a retry is in flight the stale error is held back, so the
 * reading notice and a Try again never show together (review of #923).
 */
export function KeyStatusNotices({ loading, data, error, onRetry, fallback }) {
  return (
    <>
      {loading && !data ? <TabLoading>Reading key status…</TabLoading> : null}
      <TabError
        message={error && !loading && `Key status could not be read, so ${fallback}: ${error}`}
        onRetry={onRetry}
      />
    </>
  );
}
