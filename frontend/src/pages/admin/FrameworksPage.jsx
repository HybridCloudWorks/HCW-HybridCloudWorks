import React, { useState, useEffect, useCallback } from 'react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { getCoverImageUrl } from '@/lib/blogUtils';
import { postJSON, getJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';
import { ADMIN_ROUTES } from '@/config/admin';
import { getPublishTargetForType } from '@/lib/contentModel';
import {
  CheckCircle,
  XCircle,
  Eye,
  Edit3,
  RefreshCw,
  Loader2,
  ListChecks,
  Undo2,
  Filter,
} from 'lucide-react';

const STATUS_FILTERS = [
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'in_review', label: 'In Review' },
  { value: 'editing', label: 'Editing' },
  { value: 'approved_blog', label: 'Approved' },
  { value: 'published_blog', label: 'Ready / Published' },
  { value: 'rejected', label: 'Rejected' },
];

function getStatusParam(statusFilter) {
  if (statusFilter === 'needs_review') {
    return 'ingested,inspected';
  }
  return statusFilter;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByDate(a, b) {
  const aTime = toMillis(a.fetchedAt) || toMillis(a.createdAt);
  const bTime = toMillis(b.fetchedAt) || toMillis(b.createdAt);
  return bTime - aTime;
}

async function fetchFrameworks(statusFilter) {
  const params = new URLSearchParams({
    type: 'framework',
    status: getStatusParam(statusFilter),
    limit: '200',
  });
  const res = await getJSON(`cms/content?${params.toString()}`);
  return (res.items || []).sort(sortByDate);
}

function getReviewPath(id) {
  return `${ADMIN_ROUTES.REVIEW.replace(':id', id)}?source=content`;
}

function getEditorPath(id) {
  return ADMIN_ROUTES.EDITOR.replace(':id', id);
}

function FrameworkActions({
  item,
  statusFilter,
  isLoading,
  handleApprove,
  handleReject,
  handleRestore,
  navigate,
}) {
  const showModerationActions =
    statusFilter !== 'rejected' && !item.Live && statusFilter !== 'published_blog';
  const canApprove = statusFilter === 'needs_review' || statusFilter === 'in_review';

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate(getReviewPath(item.id))}
        className="gap-1"
      >
        <Eye className="h-4 w-4" /> View
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(getEditorPath(item.id))}
        className="gap-1"
      >
        <Edit3 className="h-4 w-4" /> Edit
      </Button>

      {showModerationActions && (
        <>
          {canApprove && (
            <Button
              variant="default"
              size="sm"
              onClick={() => handleApprove(item.id)}
              disabled={Boolean(isLoading)}
              className="gap-1"
            >
              {isLoading === 'approving' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Approve
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleReject(item.id)}
            disabled={Boolean(isLoading)}
            className="gap-1 text-destructive hover:text-destructive"
          >
            {isLoading === 'rejecting' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Reject
          </Button>
        </>
      )}

      {statusFilter === 'rejected' && (
        <Button
          variant="default"
          size="sm"
          onClick={() => handleRestore(item.id)}
          disabled={Boolean(isLoading)}
          className="gap-1"
        >
          {isLoading === 'restoring' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Undo2 className="h-4 w-4" />
          )}
          Restore
        </Button>
      )}
    </div>
  );
}

function FrameworkCard({
  item,
  statusFilter,
  isLoading,
  itemError,
  handleApprove,
  handleReject,
  handleRestore,
  navigate,
}) {
  const coverUrl = getCoverImageUrl(item);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            className="w-full sm:w-32 h-24 object-cover rounded-md shrink-0"
            loading="lazy"
          />
        )}
        <div className="flex-1 space-y-2">
          <div>
            <h3 className="font-semibold text-base line-clamp-2">
              {item.Title || item.title || 'Untitled Framework'}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Badge variant="outline">
                {item['Cloud Provider'] || item.cloudProvider || 'Unknown'}
              </Badge>
              {item.category && <Badge variant="secondary">{item.category}</Badge>}
              <Badge variant="outline" className="font-mono text-[10px]">
                {item.contentStatus || 'unknown'}
              </Badge>
              {item.Live && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                  Live
                </Badge>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground line-clamp-2">
            {item.Summary || item.summary || 'No summary available'}
          </p>

          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              View source
            </a>
          )}

          <FrameworkActions
            item={item}
            statusFilter={statusFilter}
            isLoading={isLoading}
            handleApprove={handleApprove}
            handleReject={handleReject}
            handleRestore={handleRestore}
            navigate={navigate}
          />
          {itemError && <p className="text-xs text-destructive mt-1">{itemError}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function FrameworksPage() {
  const navigate = useNavigate();
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'needs_review');
  const [actionLoading, setActionLoading] = useState({});
  const [actionError, setActionError] = useState({});
  const [confirmTarget, setConfirmTarget] = useState(null);

  useEffect(() => {
    if (!authReady) return;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await fetchFrameworks(statusFilter);
        setItems(data);
      } catch (err) {
        console.error('Error loading frameworks:', err);
        setLoadError(err.message || 'Failed to load frameworks.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [authReady, statusFilter]);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set('status', statusFilter);
    setSearchParams(next, { replace: true });
  }, [statusFilter, setSearchParams]);

  const handleApprove = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'approving' }));
    try {
      await postJSON('transitionContentStatus', {
        contentId,
        newStatus: 'approved_blog',
        publishTarget: getPublishTargetForType('framework'),
        markLive: false,
        reviewNotes: 'Approved in frameworks queue',
      });
      await logAdminAction('framework_approved', { contentId });
      setItems((prev) => prev.filter((i) => i.id !== contentId));
    } catch (err) {
      console.error('Approve error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Approve failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleReject = (contentId) => setConfirmTarget({ type: 'reject', id: contentId });

  const doReject = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'rejecting' }));
    try {
      await postJSON('transitionContentStatus', {
        contentId,
        newStatus: 'rejected',
        markLive: false,
        reviewNotes: 'Rejected from frameworks queue',
      });
      await logAdminAction('framework_rejected', { contentId });
      setItems((prev) => prev.filter((i) => i.id !== contentId));
    } catch (err) {
      console.error('Reject error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Reject failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleRestore = (contentId) => setConfirmTarget({ type: 'restore', id: contentId });

  const doRestore = async (contentId) => {
    setActionLoading((prev) => ({ ...prev, [contentId]: 'restoring' }));
    try {
      await postJSON('transitionContentStatus', {
        contentId,
        newStatus: 'inspected',
        reviewNotes: 'Restored from rejected',
      });
      await postJSON('updateContentItem', {
        contentId,
        updates: {
          rejectedAt: null,
        },
      });
      setItems((prev) => prev.filter((i) => i.id !== contentId));
    } catch (err) {
      setActionError((prev) => ({ ...prev, [contentId]: `Restore failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleConfirm = useCallback(async () => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    if (target.type === 'reject') await doReject(target.id);
    else if (target.type === 'restore') await doRestore(target.id);
  }, [confirmTarget]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-sky-500" /> Frameworks
          </h1>
          <p className="text-muted-foreground">
            Manage framework content — matrices, pillars, and structured guides
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
          className="gap-1"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filter by Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map(({ value, label }) => (
              <Button
                key={value}
                variant={statusFilter === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-blue" />
        </div>
      )}
      {!loading && items.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            No frameworks in this status.
          </CardContent>
        </Card>
      )}
      {!loading && items.length > 0 && (
        <div className="space-y-4">
          {items.map((item) => (
            <FrameworkCard
              key={item.id}
              item={item}
              statusFilter={statusFilter}
              isLoading={actionLoading[item.id]}
              itemError={actionError[item.id]}
              handleApprove={handleApprove}
              handleReject={handleReject}
              handleRestore={handleRestore}
              navigate={navigate}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={confirmTarget?.type === 'reject' ? 'Reject framework?' : 'Restore framework?'}
        description={
          confirmTarget?.type === 'reject'
            ? 'This framework will be auto-deleted in 24 hours.'
            : 'This will return the framework to the review queue.'
        }
        confirmLabel={confirmTarget?.type === 'reject' ? 'Delete' : 'Restore'}
        destructive={confirmTarget?.type === 'reject'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
