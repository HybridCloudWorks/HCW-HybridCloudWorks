import React from 'react';
import { Check, XCircle } from 'lucide-react';

/**
 * PipelineStepper — persistent progress indicator for the publishing pipeline.
 * Stages: Submit → Inspect → Review → Edit → Publish → Live
 *
 * Pass either the content item (preferred, so `Live` is considered) or a raw
 * contentStatus string. Renders compact enough to mount on item cards.
 */

export const PIPELINE_STAGES = ['Submit', 'Inspect', 'Review', 'Edit', 'Publish', 'Live'];

/** Map a content item / status string to the current stage index (0-5). */
export function getPipelineStageIndex(itemOrStatus) {
  const item =
    typeof itemOrStatus === 'string' ? { contentStatus: itemOrStatus } : itemOrStatus || {};
  const status = String(item.contentStatus || '').toLowerCase();

  if (item.Live === true || item.Status === 'Live' || status === 'published_live') return 5;
  if (
    status.startsWith('published_') ||
    status.includes('approved') ||
    status === 'ready_to_publish'
  )
    return 4;
  if (status === 'editing' || status.startsWith('edit')) return 3;
  if (status.includes('review') || status === 'inspected') return 2;
  if (status.includes('inspect')) return 1;
  return 0; // submitted / pending / unknown
}

export function isPipelineRejected(itemOrStatus) {
  const status =
    typeof itemOrStatus === 'string' ? itemOrStatus : String(itemOrStatus?.contentStatus || '');
  return status.toLowerCase() === 'rejected';
}

export default function PipelineStepper({ item, status, className = '' }) {
  const subject = item || status || '';
  const rejected = isPipelineRejected(subject);
  const currentIndex = getPipelineStageIndex(subject);

  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${className}`}
      role="list"
      aria-label="Publishing pipeline progress"
    >
      {PIPELINE_STAGES.map((stage, i) => {
        const isDone = !rejected && i < currentIndex;
        const isCurrent = !rejected && i === currentIndex;
        let chipClass = 'border-border text-muted-foreground/70';
        if (isCurrent) chipClass = 'border-primary bg-primary/10 text-primary';
        else if (isDone)
          chipClass =
            'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400';
        return (
          <React.Fragment key={stage}>
            {i > 0 && <span className="h-px w-3 bg-border shrink-0" aria-hidden="true" />}
            <span
              role="listitem"
              aria-current={isCurrent ? 'step' : undefined}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${chipClass}`}
            >
              {isDone && <Check className="h-2.5 w-2.5" />}
              {stage}
            </span>
          </React.Fragment>
        );
      })}
      {rejected && (
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
          <XCircle className="h-2.5 w-2.5" /> Rejected
        </span>
      )}
    </div>
  );
}
