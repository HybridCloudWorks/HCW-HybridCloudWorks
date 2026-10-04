/**
 * VersionHistoryDialog — the saved versions of the open article, and a way
 * back to one (ADR 0033 §1: `content_versions` was written on every save and
 * read by nothing).
 *
 * The list comes from GET cms/content/{id}/versions (no bodies); Restore
 * reads the one version with its body, puts its fields into the editor, and
 * saves through the editor's own save path — so the restore is itself a new
 * version, the conflict check still runs, and nothing is written behind the
 * editor's back. The body of the current draft is never lost: it is the
 * version that was just saved before this one.
 */
import { useEffect, useRef, useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import EmptyState from '@/components/admin/shared/EmptyState';
import { getJSON } from '@/lib/api';
import { useEditor } from '../context/EditorContext';

const REASON_LABEL = {
  draft_saved: 'Saved in the editor',
  draft_force_saved: 'Force-saved over a remote change',
  review_updated: 'Updated on the review page',
};

function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The editor fields a version carries, in the shape `setField` takes. */
export function fieldsFromVersion(version = {}) {
  const fields = {};
  if (typeof version.draft === 'string') fields.draft = version.draft;
  if (typeof version.title === 'string') fields.title = version.title;
  if (typeof version.summary === 'string') fields.summary = version.summary;
  if (typeof version.authorName === 'string' && version.authorName) {
    fields.authorName = version.authorName;
  }
  if (typeof version.sidebarContent === 'string') fields.sidebarContent = version.sidebarContent;
  if (Array.isArray(version.tags)) fields.tags = version.tags.join(', ');
  if (typeof version.publishedDate === 'string' && version.publishedDate) {
    [fields.publishedDate] = version.publishedDate.split('T');
  }
  return fields;
}

/** The one-line "why · who · how long" under a version's time. */
export function describeVersion(version) {
  const parts = [REASON_LABEL[version.versionReason] || version.versionReason || 'Saved'];
  if (version.versionCreatedBy) parts.push(version.versionCreatedBy);
  if (typeof version.draftChars === 'number') {
    parts.push(`${version.draftChars.toLocaleString()} characters`);
  }
  return parts.join(' · ');
}

/**
 * The version list for the open record. The list is keyed by the record it
 * was read for: a different record (or nothing yet) is the loading state, so
 * no state is reset inside an effect.
 */
function useVersionListing(open, contentId) {
  const [listing, setListing] = useState({ key: null, versions: null, error: null });

  useEffect(() => {
    if (!open || !contentId) return undefined;
    let cancelled = false;
    getJSON(`cms/content/${encodeURIComponent(contentId)}/versions`)
      .then((res) => {
        if (!cancelled) setListing({ key: contentId, versions: res.versions || [], error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setListing({
            key: contentId,
            versions: [],
            error: err?.message || 'The version history could not be read.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, contentId]);

  const current = listing.key === contentId;
  return { versions: current ? listing.versions : null, error: current ? listing.error : null };
}

function VersionRow({ version, restoringId, onRestore }) {
  const when = formatWhen(version.versionCreatedAt);
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{when || 'Unknown time'}</p>
        <p className="truncate text-xs text-muted-foreground">{describeVersion(version)}</p>
        {version.title && (
          <p className="truncate text-xs text-muted-foreground">“{version.title}”</p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 gap-1"
        disabled={Boolean(restoringId)}
        onClick={() => onRestore(version.id)}
        aria-label={`Restore the version from ${when}`}
      >
        {restoringId === version.id ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Restore this version
      </Button>
    </li>
  );
}

/** The dialog body below the header: error, loading, empty, or the list. */
function VersionListBody({ open, versions, error, restoringId, onRestore }) {
  const loading = open && versions === null && !error;
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading versions…
        </p>
      )}
      {versions?.length === 0 && (
        <EmptyState
          compact
          title="No saved versions yet"
          description="A version is written each time the article is saved here or on the review page."
        />
      )}
      {versions?.length > 0 && (
        <ul className="max-h-96 space-y-2 overflow-y-auto" aria-label="Saved versions">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              restoringId={restoringId}
              onRestore={onRestore}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export default function VersionHistoryDialog({ open, onOpenChange }) {
  const { blog, setField, handleSave } = useEditor();
  const { toast } = useToast();
  const contentId = blog?.id;
  const listing = useVersionListing(open, contentId);
  const [restoreError, setRestoreError] = useState(null);
  const [restoringId, setRestoringId] = useState('');
  // The restore in flight. Set with the fields; the effect below saves on the
  // render that carries them, so handleSave closes over the restored fields.
  const pendingSaveRef = useRef(null);
  const [saveTick, setSaveTick] = useState(0);

  useEffect(() => {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    const { versionId } = pending;
    handleSave().then((saved) => {
      setRestoringId('');
      if (saved) {
        toast({
          title: 'Version restored',
          description: 'The editor now holds that version, saved as a new one.',
        });
        onOpenChange(false);
      } else {
        toast({
          title: 'Restored into the editor, not saved',
          description: `Version ${versionId.slice(0, 8)} is in the editor; the save did not land. Check the message in the save bar.`,
          variant: 'destructive',
        });
      }
    });
  }, [saveTick, handleSave, toast, onOpenChange]);

  const restore = async (versionId) => {
    setRestoringId(versionId);
    setRestoreError(null);
    try {
      const res = await getJSON(
        `cms/content/${encodeURIComponent(contentId)}/versions/${encodeURIComponent(versionId)}`
      );
      const fields = fieldsFromVersion(res.version);
      if (!Object.keys(fields).length) throw new Error('This version carries no editor fields.');
      for (const [key, value] of Object.entries(fields)) setField(key, value);
      pendingSaveRef.current = { versionId };
      setSaveTick((n) => n + 1);
    } catch (err) {
      setRestoringId('');
      setRestoreError(err?.message || 'The version could not be restored.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" aria-hidden="true" /> Version history
          </DialogTitle>
          <DialogDescription>
            Every save of this article, newest first. Restoring puts that version into the editor
            and saves it as a new version; the current text stays in the history.
          </DialogDescription>
        </DialogHeader>

        <VersionListBody
          open={open}
          versions={listing.versions}
          error={listing.error || restoreError}
          restoringId={restoringId}
          onRestore={restore}
        />
      </DialogContent>
    </Dialog>
  );
}
