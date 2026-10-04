/**
 * A chapter's audio versions (ADR 0033 §4): every take, oldest first, with
 * a player each, which one is live, and a delete for the ones that are not.
 * The active take cannot be deleted — the players would point at nothing —
 * and the server refuses it too; choosing another first is the path.
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { Loader2, Trash2 } from 'lucide-react';
import ChapterPlayer from './ChapterPlayer';
import { formatCost, versionLabel } from './episodeView';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} props.chapter
 * @param {boolean} props.busy
 * @param {(versionId: string) => Promise<unknown>} props.onActivate
 * @param {(versionId: string) => Promise<unknown>} props.onDelete
 * @param {() => void} props.onClose
 */
export default function VersionsDialog({ open, chapter, busy, onActivate, onDelete, onClose }) {
  const [confirm, setConfirm] = useState(null);
  const versions = Array.isArray(chapter?.versions) ? chapter.versions : [];
  const activeId = chapter?.activeVersionId;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Versions — {chapter?.title || chapter?.areaName}</DialogTitle>
          <DialogDescription>
            Every take this chapter has had. The active one is what the site plays; regenerating
            adds a take rather than replacing one, so an earlier reading can be brought back.
          </DialogDescription>
        </DialogHeader>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No audio yet — Regenerate makes the first take.
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Audio versions, oldest first">
            {versions.map((version, index) => {
              const active = version.id === activeId;
              return (
                <li
                  key={version.id}
                  className={`rounded-lg border p-3 ${active ? 'border-primary/50 bg-primary/5' : 'border-border'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs">
                      <p className="font-medium">
                        Take {index + 1}
                        {active ? ' · active' : ''}
                      </p>
                      <p className="text-muted-foreground">
                        {versionLabel(version)}
                        {typeof version.costUsd === 'number'
                          ? ` · ${formatCost(version.costUsd)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!active && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onActivate(version.id)}
                        >
                          {busy && (
                            <Loader2
                              className="mr-1.5 h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          )}
                          Make active
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || active}
                        title={
                          active
                            ? 'The active take cannot be deleted; make another active first'
                            : 'Delete this take and its file'
                        }
                        aria-label={`Delete take ${index + 1}`}
                        onClick={() => setConfirm(version)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  {version.audioUrl && (
                    <div className="mt-2">
                      <ChapterPlayer
                        positionKey={`listen-and-learn:${chapter.setId}/${chapter.id}#${version.id}`}
                        audioUrl={version.audioUrl}
                        title={`${chapter.title || chapter.areaName} — take ${index + 1}`}
                        durationSeconds={version.durationSeconds}
                        audioBytes={version.audioBytes}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <ConfirmModal
          open={Boolean(confirm)}
          title="Delete this take?"
          description="Its audio file is deleted from storage and cannot be recovered. The active take and the chapter's status are not affected."
          confirmLabel="Delete take"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const id = confirm?.id;
            setConfirm(null);
            if (id) await onDelete(id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
