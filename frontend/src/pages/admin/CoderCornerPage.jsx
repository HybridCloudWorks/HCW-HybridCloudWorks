import React, { useState, useEffect, useCallback } from 'react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { useSearchParams } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { postJSON, getJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';
import { byNewest } from '@/lib/dateUtils';
import { CoderCornerReviewBoard } from '@/components/admin/CoderCornerReviewBoard';
import { getPublishTargetForType } from '@/lib/contentModel';
import { RefreshCw, Loader2, Code2, Filter } from 'lucide-react';

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

const sortByDate = byNewest('fetchedAt', 'createdAt');

async function fetchCoderCorner(statusFilter) {
  const params = new URLSearchParams({
    type: 'coder_corner',
    status: getStatusParam(statusFilter),
    limit: '200',
  });
  const res = await getJSON(`cms/content?${params.toString()}`);
  return (res.items || []).sort(sortByDate);
}

export default function CoderCornerPage() {
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
        const data = await fetchCoderCorner(statusFilter);
        setItems(data);
      } catch (err) {
        console.error('Error loading coder corner items:', err);
        setLoadError(err.message || 'Failed to load coder corner items.');
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
        publishTarget: getPublishTargetForType('coder_corner'),
        markLive: false,
        reviewNotes: 'Approved in coder corner queue',
      });
      await logAdminAction('coder_corner_approved', { contentId });
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
        reviewNotes: 'Rejected from coder corner queue',
      });
      await logAdminAction('coder_corner_rejected', { contentId });
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
            <Code2 className="h-6 w-6 text-amber-500" /> Coder Corner
          </h1>
          <p className="text-muted-foreground">
            Code-focused content — snippets, breakdowns, use cases, and tutorials
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
            No coder corner items in this status.
          </CardContent>
        </Card>
      )}
      {!loading && items.length > 0 && (
        <div className="space-y-4">
          {items.map((item) => (
            <CoderCornerReviewBoard
              key={item.id}
              item={item}
              statusFilter={statusFilter}
              isLoading={actionLoading[item.id]}
              itemError={actionError[item.id]}
              handleApprove={handleApprove}
              handleReject={handleReject}
              handleRestore={handleRestore}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={confirmTarget?.type === 'reject' ? 'Reject coder corner item?' : 'Restore item?'}
        description={
          confirmTarget?.type === 'reject'
            ? 'This item will be auto-deleted in 24 hours.'
            : 'This will return the item to the review queue.'
        }
        confirmLabel={confirmTarget?.type === 'reject' ? 'Delete' : 'Restore'}
        destructive={confirmTarget?.type === 'reject'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
