/**
 * What a chapter says when its last regeneration failed (ADR 0033 §4), on
 * both the Library row and the Review card: the error, the fact that the
 * published take is still playing when it is, and the two ways out — Retry
 * runs it again, Keep current clears the note and leaves the take as it is.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function RegenerationNotice({ chapter, busy, onRetry, onKeepCurrent }) {
  const error = chapter?.lastError;
  if (!error) return null;
  const when = error.at ? ` on ${new Date(error.at).toLocaleString()}` : '';
  const live = chapter.status === 'published' ? ' The published take is still playing.' : '';
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          The last regeneration failed{when}: {error.message}
          {live}
        </span>
      </p>
      <div className="flex gap-2">
        {onRetry && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetry(chapter)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Retry
          </Button>
        )}
        {onKeepCurrent && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onKeepCurrent(chapter)}>
            Keep current
          </Button>
        )}
      </div>
    </div>
  );
}
