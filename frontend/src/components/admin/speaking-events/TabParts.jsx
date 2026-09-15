/**
 * Small pieces the Speaking Events Hub's tabs share (#573): the refresh
 * button, a dismissible notice, and the loading and error states of the reads
 * a tab depends on. Loading and error panels are the Integrations Hub's
 * (TabLoading / TabError), so every hub reads the same.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { TabError, TabLoading } from '@/components/admin/integrations/TabNotice';

export function RefreshButton({ onClick, busy, disabled, children = 'Refresh' }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={busy || disabled}>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin mr-1" />
      ) : (
        <RefreshCw className="h-4 w-4 mr-1" />
      )}
      {children}
    </Button>
  );
}

export function Dismissible({ tone = 'error', onDismiss, children }) {
  const toneClass =
    tone === 'error'
      ? 'text-destructive bg-destructive/10'
      : 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`text-sm rounded-lg px-4 py-2 flex items-center justify-between gap-3 ${toneClass}`}
    >
      <span>{children}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The state of the reads a tab needs, or null when every one has landed.
 * Each failing read gets its own panel and its own "Try again", so a stored
 * overrides failure never hides that Sessionize answered, and the reverse.
 */
export function ReadsStatus({ reads, label }) {
  const failed = reads.filter((read) => read.error);
  if (failed.length > 0) {
    return (
      <div className="space-y-2">
        {failed.map((read, index) => (
          // Index as well as message: two reads can fail with the same sentence.
          <TabError key={`${index}-${read.error}`} message={read.error} onRetry={read.refresh} />
        ))}
      </div>
    );
  }
  if (reads.some((read) => read.loading)) return <TabLoading>Loading {label}…</TabLoading>;
  return null;
}

/** True when every read has landed and none failed. */
export const allLanded = (reads) => reads.every((read) => read.loaded && !read.error);

/** Refresh every read; resolves when all have settled. */
export const refreshAll = (reads) => Promise.all(reads.map((read) => read.refresh()));
