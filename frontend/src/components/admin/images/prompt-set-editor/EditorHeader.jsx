/**
 * The editor's title row (ADR 0033): back to the library, the set's name,
 * version and state badges, and — for a saved, non-legacy set — rename,
 * duplicate, archive or restore, and delete.
 */
import React from 'react';
import { Archive, ArrowLeft, Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/admin/shared/StatusBadge';

const ARCHIVED_STATUS = { id: 'archived', label: 'Archived', tone: 'off' };

/** The row of set-level actions, in display order. */
function headerActions({ set, onArchiveSet, onRestoreSet, openDialog }) {
  const archiveOrRestore = set.archivedAt
    ? { key: 'restore', label: 'Restore', Icon: RotateCcw, onClick: () => onRestoreSet(set.name) }
    : {
        key: 'archive',
        label: 'Archive',
        Icon: Archive,
        onClick: () => onArchiveSet(set.name),
        title: 'Hide from generators and unassign its pages; keep everything',
      };
  return [
    { key: 'rename', label: 'Rename', Icon: Pencil, onClick: () => openDialog('rename') },
    { key: 'duplicate', label: 'Duplicate', Icon: Copy, onClick: () => openDialog('duplicate') },
    archiveOrRestore,
    {
      key: 'delete',
      label: 'Delete',
      Icon: Trash2,
      variant: 'destructive',
      onClick: () => openDialog('delete'),
    },
  ];
}

function HeaderActions({ set, busy, onArchiveSet, onRestoreSet, openDialog }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {headerActions({ set, onArchiveSet, onRestoreSet, openDialog }).map((action) => (
        <Button
          key={action.key}
          type="button"
          variant={action.variant || 'outline'}
          size="sm"
          className="gap-1"
          onClick={action.onClick}
          disabled={busy}
          title={action.title}
        >
          <action.Icon className="h-3.5 w-3.5" aria-hidden="true" /> {action.label}
        </Button>
      ))}
    </div>
  );
}

export default function EditorHeader({
  set,
  isNew,
  busy,
  onBack,
  onArchiveSet,
  onRestoreSet,
  openDialog,
}) {
  const saved = !isNew && !set.legacy;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All sets
        </Button>
        <h2 className="text-lg font-semibold">{isNew ? 'New image set' : set.name}</h2>
        {!isNew && <Badge variant="outline">v{set.version}</Badge>}
        {set?.archivedAt && <StatusBadge status={ARCHIVED_STATUS} size="xs" />}
        {set?.legacy && <Badge variant="outline">Legacy</Badge>}
      </div>
      {saved && (
        <HeaderActions
          set={set}
          busy={busy}
          onArchiveSet={onArchiveSet}
          onRestoreSet={onRestoreSet}
          openDialog={openDialog}
        />
      )}
    </div>
  );
}
