/**
 * EmptyState — a list with nothing in it says what would fill it and offers
 * the action that does (ADR 0033 UX requirements). Never a bare "No items".
 *
 * `variant`:
 *   empty    nothing exists yet (default)
 *   filtered something exists but the current filter hides it
 *   error    the read failed; `onRetry` shows a Try again button
 */
import React from 'react';
import { AlertCircle, Inbox, SearchX, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ICONS = { empty: Inbox, filtered: SearchX, error: AlertCircle };

export default function EmptyState({
  variant = 'empty',
  icon,
  title,
  description,
  action,
  onRetry,
  compact = false,
  className = '',
}) {
  const Icon = icon || ICONS[variant] || Inbox;
  const tone = variant === 'error' ? 'text-destructive' : 'text-muted-foreground';
  return (
    <div
      role={variant === 'error' ? 'alert' : undefined}
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-center ${
        compact ? 'px-4 py-6' : 'px-6 py-12'
      } ${className}`}
    >
      <Icon className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} ${tone}`} aria-hidden="true" />
      {title && <p className="text-sm font-medium">{title}</p>}
      {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
      {(action || onRetry) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
