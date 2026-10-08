/**
 * The one place a Health Hub card shows its status (#1010): the top-right
 * corner of its header, the same on every card.
 *
 * The slot never shrinks and never wraps — the header row beside it gives
 * the title the rest (`min-w-0 flex-1`) — so a long description wraps under
 * the title and never pushes the badge onto a line of its own, which is what
 * every probe card but the one with the shortest description did until
 * 2026-10-08. Its minimum width holds the widest word ("Degraded"), so a
 * status changing from Healthy to Degraded re-colours the badge without
 * moving the title beside it.
 */
import React from 'react';
import StatusBadge from '@/components/admin/shared/StatusBadge';

const MIN_WIDTH = { xs: 'min-w-[4.75rem]', sm: 'min-w-[6rem]' };

export default function StatusSlot({ status, size = 'xs' }) {
  return (
    <div
      className={`flex shrink-0 justify-end ${MIN_WIDTH[size] ?? MIN_WIDTH.xs}`}
      data-slot="status"
    >
      <StatusBadge system={status ?? 'unknown'} size={size} />
    </div>
  );
}
