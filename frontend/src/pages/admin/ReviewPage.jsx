/**
 * /admin/queue/:id — one item, on the board its type calls for (ADR 0033).
 *
 *   architecture  → ArchitectureReviewBoard
 *   framework     → FrameworkReviewBoard
 *   coder_corner  → the Coder Corner card with its approve / reject / restore
 *                   (it was shown on the Blog board, which knows nothing of
 *                   languages, difficulty or code previews)
 *   everything else → BlogReviewBoard
 *
 * Every save and publish here reports its outcome: a toast, an inline
 * message on the board, a real `saving` state on the buttons, and no
 * navigation after a save that did not land. Until 2026-10-03 the handlers
 * swallowed every error to console.error, passed `saving={false}` and
 * navigated regardless (ADR 0033 §1, bug 7).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Eye, Loader2 } from 'lucide-react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { usePublicData } from '@/hooks/usePublicData';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import ArchitectureReviewBoard from '@/components/admin/ArchitectureReviewBoard';
import FrameworkReviewBoard from '@/components/admin/FrameworkReviewBoard';
import BlogReviewBoard from '@/components/admin/BlogReviewBoard';
import { CoderCornerReviewBoard } from '@/components/admin/CoderCornerReviewBoard';
import PipelineStepper from '@/components/admin/PipelineStepper';
import EmptyState from '@/components/admin/shared/EmptyState';
import PageHeader from '@/components/admin/shared/PageHeader';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import TaxonomyChips from '@/components/admin/shared/TaxonomyChips';
import TaxonomyPicker from '@/components/admin/shared/TaxonomyPicker';
import { postJSON, getJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';
import { getPublishTargetForType } from '@/lib/contentModel';
import { contentStatusInfo } from '@/lib/status';
import { resolveIdeaOrigin, resolveKind } from '@/lib/taxonomy';
import { useContentTransitions } from './queue/useContentTransitions';

const REVIEW_HELP = [
  'What arrives here: one item from the Review Queue, on the board its type calls for (blog, framework, architecture blueprint or Coder Corner).',
  'What to do: read it, fix the metadata and the kind / idea origin, then Save, Approve (Send to Publish) or Reject. A framework or blueprint is saved from its own board.',
  'Kind says what the item will become; idea origin says how it started. They decide which downstream tools fit, so set them before approving.',
  'Where it goes next: an approved item appears in the Editor for polishing and then on the Publish page; a rejected one decays unless restored from the queue.',
];

const BOARD_LABEL = {
  architecture: 'Architecture Studio',
  framework: 'Framework Studio',
  coder_corner: 'Coder Corner',
};

/** The Coder Corner card's `statusFilter`, from the item's own status. */
function coderCornerFilterFor(blog) {
  const info = contentStatusInfo(blog);
  if (info.id === 'live') return 'approved,forge_ready,published';
  if (['draft', 'ingested', 'inspected'].includes(info.id)) return 'needs_review';
  return info.id;
}

/** Kind and idea origin, editable in the header and saved through updateContentItem. */
function TaxonomyEditor({ blog, blogId, onSaved }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({
    kind: resolveKind(blog),
    ideaOrigin: resolveIdeaOrigin(blog),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await postJSON('updateContentItem', { contentId: blogId, updates: draft });
      toast({ title: 'Classification saved', description: 'Kind and idea origin updated.' });
      setOpen(false);
      onSaved?.(draft);
    } catch (err) {
      setError(err?.message || 'The classification could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <TaxonomyChips item={{ ...blog, ...draft }} />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setOpen(true)}
        >
          Change
        </Button>
      </span>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="space-y-3 pt-4">
        <TaxonomyPicker
          kind={draft.kind}
          ideaOrigin={draft.ideaOrigin}
          onChange={setDraft}
          disabled={saving}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Save classification
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** The Coder Corner board on the review page: the card, with the shared transitions. */
function CoderCornerReviewPanel({ blog, blogId, onTransitioned }) {
  const [confirmTarget, setConfirmTarget] = useState(null);
  const transitions = useContentTransitions({ onTransitioned });
  const statusFilter = coderCornerFilterFor(blog);

  const handleConfirm = async () => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    if (target.type === 'reject') {
      await transitions.reject(blogId, { reviewNotes: 'Rejected from the review page' });
    } else if (target.type === 'restore') {
      await transitions.restore(blogId, { reviewNotes: 'Restored from rejected' });
    }
  };

  return (
    <>
      <CoderCornerReviewBoard
        item={blog}
        statusFilter={statusFilter}
        isLoading={transitions.loading[blogId]}
        itemError={transitions.errors[blogId]}
        handleApprove={() =>
          transitions.approve(blog, { reviewNotes: 'Approved from the review page' })
        }
        handleReject={() => setConfirmTarget({ type: 'reject' })}
        handleRestore={() => setConfirmTarget({ type: 'restore' })}
      />
      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={
          confirmTarget?.type === 'reject' ? 'Reject this coder corner item?' : 'Restore this item?'
        }
        description={
          confirmTarget?.type === 'reject'
            ? 'Rejected items stay recoverable for about eight days before they are removed.'
            : 'This returns it to the review queue as Inspected.'
        }
        confirmLabel={confirmTarget?.type === 'reject' ? 'Reject' : 'Restore'}
        destructive={confirmTarget?.type === 'reject'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmTarget(null)}
      />
    </>
  );
}

export default function ReviewPage() {
  const { blogId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  const {
    data: blog,
    error,
    loading,
  } = usePublicData(
    () =>
      getJSON(`cms/content/item?contentId=${encodeURIComponent(blogId)}`).then((res) => res.item),
    blogId ? `review:${blogId}:${version}` : ''
  );
  const [frameworkDeleteOpen, setFrameworkDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [boardError, setBoardError] = useState(null);

  const transitions = useContentTransitions({
    onTransitioned: (_id, result) => {
      toast({
        title: result?.to ? `Moved to ${contentStatusInfo(result.to).label}` : 'Status updated',
      });
      refresh();
    },
  });

  const boardLabel = useMemo(() => BOARD_LABEL[blog?.type] || 'Blog review', [blog?.type]);

  /** Save the board's fields; true when the write landed. */
  const saveFields = useCallback(
    async (formData, noun) => {
      setSaving('save');
      setBoardError(null);
      try {
        await postJSON('updateContentItem', { contentId: blogId, updates: formData });
        toast({ title: `${noun} saved` });
        return true;
      } catch (err) {
        const message = `Save failed: ${err?.message || 'Unknown error'}`;
        setBoardError(message);
        toast({ title: `${noun} not saved`, description: err?.message, variant: 'destructive' });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [blogId, toast]
  );

  /** Save, then approve; navigate only when both landed. */
  const publishFields = useCallback(
    async (formData, type, noun) => {
      if (!(await saveFields(formData, noun))) return;
      setSaving('publish');
      setBoardError(null);
      try {
        const result = await transitions.approve(blogId, {
          publishTarget: getPublishTargetForType(type),
          reviewNotes: `${noun} review complete and sent to publish stage`,
        });
        if (!result) {
          setBoardError(transitions.errors[blogId] || 'Approve failed.');
          return;
        }
        navigate(`/admin/queue?contentType=${type}`);
      } finally {
        setSaving(false);
      }
    },
    [blogId, navigate, saveFields, transitions]
  );

  const doFrameworkDelete = async () => {
    setFrameworkDeleteOpen(false);
    setSaving('delete');
    setBoardError(null);
    try {
      await postJSON('deleteContentItem', { contentId: blogId });
      // deleteContentItem writes no server audit row; this one is the record.
      await logAdminAction('framework_deleted', { contentId: blogId });
      toast({ title: 'Framework deleted' });
      navigate('/admin/queue?contentType=framework');
    } catch (err) {
      setBoardError(`Delete failed: ${err?.message || 'Unknown error'}`);
      toast({ title: 'Framework not deleted', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !blog) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground" role="status">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Loading content…
      </div>
    );
  }

  if (error || !blog) {
    return (
      <EmptyState
        variant="error"
        title="This item could not be loaded"
        description={error?.message || 'It may have been deleted, or the request failed.'}
        onRetry={refresh}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/queue')}>
            Back to Queue
          </Button>
        }
      />
    );
  }

  const boardErrorFor = boardError || transitions.errors[blogId] || null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Eye}
        title={blog.Title || blog.title || 'Untitled'}
        eyebrow="Pipeline · Review"
        description={`Reviewing on the ${boardLabel} board.`}
        help={REVIEW_HELP}
        status={
          <>
            <StatusBadge content={blog} />
            <Badge variant="outline">{boardLabel}</Badge>
            <TaxonomyEditor blog={blog} blogId={blogId} onSaved={refresh} />
          </>
        }
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/queue')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Queue
          </Button>
        }
      >
        <PipelineStepper item={blog} />
      </PageHeader>

      {blog.type === 'architecture' && (
        <ArchitectureReviewBoard
          blog={blog}
          saving={saving}
          error={boardErrorFor}
          onSave={(formData) => saveFields(formData, 'Blueprint')}
          onPublish={(formData) => publishFields(formData, 'architecture', 'Blueprint')}
        />
      )}

      {blog.type === 'framework' && (
        <>
          <FrameworkReviewBoard
            blog={blog}
            saving={saving}
            error={boardErrorFor}
            onSave={(formData) => saveFields(formData, 'Framework')}
            onPublish={(formData) => publishFields(formData, 'framework', 'Framework')}
            onDelete={() => setFrameworkDeleteOpen(true)}
          />
          <ConfirmModal
            open={frameworkDeleteOpen}
            title="Delete this framework?"
            description="This content item will be permanently deleted. This cannot be undone."
            confirmLabel="Delete"
            onConfirm={doFrameworkDelete}
            onCancel={() => setFrameworkDeleteOpen(false)}
          />
        </>
      )}

      {blog.type === 'coder_corner' && (
        <CoderCornerReviewPanel blog={blog} blogId={blogId} onTransitioned={refresh} />
      )}

      {!['architecture', 'framework', 'coder_corner'].includes(blog.type) && (
        <BlogReviewBoard blog={blog} blogId={blogId} onChanged={refresh} />
      )}
    </div>
  );
}
