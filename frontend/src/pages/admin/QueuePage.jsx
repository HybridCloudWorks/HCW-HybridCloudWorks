import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { getCoverImageUrl } from '@/lib/blogUtils';
import { postJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';
import { ADMIN_ROUTES } from '@/config/admin';
import { requestContentInspection } from '@/lib/contentWorkflow';
import { getPublishTargetForItem } from '@/lib/contentModel';
import { toDate, toMillis } from '@/lib/dateUtils';
import {
  CheckCircle,
  XCircle,
  Eye,
  Edit3,
  RefreshCw,
  Loader2,
  BookOpen,
  Filter,
  Undo2,
  Calendar,
  Trash2,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react';

function getReviewPath(contentId) {
  return `${ADMIN_ROUTES.REVIEW.replace(':id', contentId)}?source=content`;
}

const toDateMaybe = toDate;

function formatPublishedDate(item) {
  const published =
    item?.publishedAt ||
    item?.blogPublishedAt ||
    item?.['Published At'] ||
    item?.publishedDate ||
    item?.datePublished ||
    item?.pubDate;
  const publishedDate = toDateMaybe(published);
  if (publishedDate) {
    return {
      label: publishedDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      isFallback: false,
    };
  }
  const fallback = item?.fetchedAt || item?.createdAt;
  const fallbackDate = toDateMaybe(fallback);
  if (fallbackDate) {
    return {
      label: `Fetched ${fallbackDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}`,
      isFallback: true,
    };
  }
  return null;
}

function getRootDomain(item) {
  const url = item?.sourceUrl || item?.url || item?.link;
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function getEditorPath(contentId) {
  return ADMIN_ROUTES.EDITOR.replace(':id', contentId);
}

// Sort options for the queue toolbar. The default is `published_desc` —
// newest published article first, falling back to fetched date when an
// item lacks a publish date. Each entry's `compare` returns the standard
// negative/positive/zero for ascending order; the toolbar negates the
// result for descending.
function getPublishedMs(item) {
  const v =
    item?.publishedAt ||
    item?.blogPublishedAt ||
    item?.['Published At'] ||
    item?.publishedDate ||
    item?.datePublished ||
    item?.pubDate;
  return toMillis(v) || null;
}

function getIngestedMs(item) {
  return toMillis(item?.fetchedAt) || toMillis(item?.createdAt);
}

function getRootDomainForSort(item) {
  const url = item?.sourceUrl || item?.url || item?.link || '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const SORT_OPTIONS = {
  published: {
    label: 'Published date',
    compare: (a, b) => {
      const aMs = getPublishedMs(a);
      const bMs = getPublishedMs(b);
      // Items without a published date sort to the bottom of asc order
      // (so they land at the top in desc), matching the existing fallback
      // behavior in formatPublishedDate.
      if (aMs === null && bMs === null) return getIngestedMs(a) - getIngestedMs(b);
      if (aMs === null) return 1;
      if (bMs === null) return -1;
      return aMs - bMs;
    },
  },
  ingested: {
    label: 'Ingested date',
    compare: (a, b) => getIngestedMs(a) - getIngestedMs(b),
  },
  domain: {
    label: 'Source domain',
    compare: (a, b) => getRootDomainForSort(a).localeCompare(getRootDomainForSort(b)),
  },
  title: {
    label: 'Title',
    compare: (a, b) =>
      String(a?.Title || a?.title || '').localeCompare(String(b?.Title || b?.title || '')),
  },
};

function sortQueueItemsBy(items, sortKey, direction) {
  const opt = SORT_OPTIONS[sortKey] || SORT_OPTIONS.published;
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => factor * opt.compare(a, b));
}

// Default sort retained for the initial fetch: published date, descending.
function sortQueueItems(a, b) {
  return -SORT_OPTIONS.published.compare(a, b);
}

function getLiveBadge(item) {
  if (item.Live === true) {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
        ✓ Live
      </Badge>
    );
  }

  if (item.contentStatus?.startsWith('published_')) {
    return (
      <Badge variant="outline" className="text-orange-600 border-orange-400">
        Staged
      </Badge>
    );
  }

  return null;
}

// Decay badge for rejected / soft-deleted items. Two phases:
//   1. contentStatus === 'rejected' and no softDeletedAt yet → counting down
//      to the 04:00 CT cron that will set softDeletedAt. (~0-24h.)
//   2. softDeletedAt is set → counting down to permanent removal by the
//      hourly soft-delete reaper (7-day window from softDeletedAt).
// Returns null for any item not in those states.
const SOFT_DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const REJECTION_GRACE_MS = 24 * 60 * 60 * 1000;

function formatRemaining(ms) {
  if (ms <= 0) return 'imminent';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `${minutes}m`;
}

function getDecayBadge(item) {
  if (!item) return null;
  const now = Date.now();

  const softDeletedAt = toDate(item.softDeletedAt);
  if (softDeletedAt) {
    const remaining = SOFT_DELETE_GRACE_MS - (now - softDeletedAt.getTime());
    return (
      <Badge
        variant="outline"
        className="text-[10px] font-mono border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-300"
        title="Soft-deleted. Will be permanently removed when this counter reaches zero."
      >
        purges in {formatRemaining(remaining)}
      </Badge>
    );
  }

  if (item.contentStatus === 'rejected') {
    const rejectedAt = toDate(item.rejectedAt) || toDate(item.reviewedAt) || toDate(item.updatedAt);
    if (!rejectedAt) return null;
    const remaining = REJECTION_GRACE_MS - (now - rejectedAt.getTime());
    return (
      <Badge
        variant="outline"
        className="text-[10px] font-mono border-orange-400 text-orange-700 dark:border-orange-500 dark:text-orange-300"
        title="Rejected. Will be moved to soft-delete (7-day recovery) at the next 04:00 CT cron run."
      >
        soft-delete in {formatRemaining(remaining)}
      </Badge>
    );
  }

  return null;
}

function getSourceBadge(item) {
  if (item.source === 'rss') {
    return (
      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
        RSS
      </Badge>
    );
  }

  if (item.source === 'manual_url') {
    return (
      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
        Manual URL
      </Badge>
    );
  }

  return null;
}

function getConfirmModalCopy(confirmTarget) {
  if (confirmTarget?.type === 'reject') {
    return {
      title: 'Reject content?',
      description:
        'Rejected items remain recoverable for ~8 days (24h grace, then 7-day soft-delete window) before being permanently removed.',
      confirmLabel: 'Reject',
      destructive: true,
    };
  }

  if (confirmTarget?.type === 'bulkDelete') {
    return {
      title: 'Move all rejected items to soft-delete?',
      description:
        'All rejected items are marked for soft-delete now. They remain recoverable for 7 days, then are permanently removed. This batches what the nightly cron does automatically after 24h.',
      confirmLabel: 'Soft-Delete All',
      destructive: true,
    };
  }

  if (confirmTarget?.type === 'bulkReject') {
    const count = confirmTarget.ids?.length || 0;
    return {
      title: `Reject ${count} items?`,
      description: `These ${count} items will be marked rejected. Recoverable for ~8 days (24h grace, then 7-day soft-delete window) before permanent removal.`,
      confirmLabel: 'Reject All',
      destructive: true,
    };
  }

  if (confirmTarget?.type === 'deleteRejected') {
    return {
      title: 'Delete rejected content permanently?',
      description:
        'This removes the rejected item from Firestore immediately. This cannot be undone — use soft-delete instead if you want a 7-day recovery window.',
      confirmLabel: 'Delete Permanently',
      destructive: true,
    };
  }

  return {
    title: 'Restore content?',
    description: 'This will return the content to the review queue.',
    confirmLabel: 'Restore',
    destructive: false,
  };
}

function QueueList({
  items,
  loading,
  actionLoading,
  actionError,
  handleApprove,
  handleReject,
  handleReinspect,
  handleRestore,
  handlePermanentDelete,
  handleGenerateHero,
  navigate,
  statusFilter,
  selectedIds,
  toggleSelected,
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-blue" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-muted-foreground">No items in this status.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <QueueItemCard
          key={item.id}
          item={item}
          statusFilter={statusFilter}
          actionLoading={actionLoading}
          actionError={actionError}
          handleApprove={handleApprove}
          handleReject={handleReject}
          handleReinspect={handleReinspect}
          handleRestore={handleRestore}
          handlePermanentDelete={handlePermanentDelete}
          handleGenerateHero={handleGenerateHero}
          navigate={navigate}
          isSelected={selectedIds?.has(item.id)}
          toggleSelected={toggleSelected}
        />
      ))}
    </div>
  );
}

// Filter ordering follows the article lifecycle. "Needs Review" is the
// union of Ingested + Inspected and is the default landing state. The
// individual exact-match chips below it let admins drill into one or the
// other without bulk-rejecting items in the *other* state by accident.
const STATUS_FILTERS = [
  { value: 'needs_review', label: 'Needs Review (Ingested + Inspected)' },
  { value: 'ingested', label: '⤷ Ingested (raw, uninspected)' },
  { value: 'inspected', label: '⤷ Inspected (AI-processed)' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'editing', label: 'Editing' },
  { value: 'approved_blog', label: 'Approved' },
  { value: 'ready_to_publish', label: 'Staged (Pre-Live)' },
  { value: 'published_live', label: 'Published (Live)' },
  { value: 'rejected', label: 'Rejected' },
];

const CONTENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'blog', label: 'Blogs' },
  { value: 'coder_corner', label: 'Coder Corner' },
  { value: 'framework', label: 'Frameworks' },
  { value: 'architecture', label: 'Architecture' },
];

/**
 * Action buttons component for queue items
 * Extracted to reduce complexity
 */
function QueueItemActions({
  item,
  statusFilter,
  isLoading,
  handleApprove,
  handleReject,
  handleReinspect,
  handleRestore,
  handlePermanentDelete,
  navigate,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      {statusFilter === 'published_live' && (
        <>
          <Button
            variant="default"
            size="sm"
            onClick={() => navigate(ADMIN_ROUTES.PUBLISHED)}
            className="gap-1"
          >
            Manage in Publish
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(getReviewPath(item.id))}
            className="gap-1"
          >
            <Eye className="h-4 w-4" /> View
          </Button>
        </>
      )}

      {statusFilter === 'ready_to_publish' && (
        <Button
          variant="default"
          size="sm"
          onClick={() => navigate(ADMIN_ROUTES.PUBLISHED)}
          className="gap-1"
        >
          Go to Publish→
        </Button>
      )}

      {(statusFilter === 'inspected' || statusFilter === 'needs_review') && (
        <>
          <Button
            variant="default"
            size="sm"
            onClick={() => handleApprove(item)}
            disabled={isLoading}
            className="gap-1"
          >
            {isLoading === 'approving' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            Send to Publish
          </Button>
        </>
      )}

      {statusFilter === 'ingested' && (
        <Button
          variant="default"
          size="sm"
          onClick={() => handleReinspect(item.id)}
          disabled={isLoading}
          className="gap-1"
        >
          {isLoading === 'inspecting' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Inspect Now
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate(getReviewPath(item.id))}
        className="gap-1"
      >
        <Eye className="h-4 w-4" /> View
      </Button>

      {statusFilter === 'ready_to_publish' && (
        <Button
          variant="default"
          size="sm"
          onClick={() => navigate(ADMIN_ROUTES.CALENDAR)}
          className="gap-1"
        >
          <Calendar className="h-4 w-4" /> Schedule on Calendar
        </Button>
      )}

      {(statusFilter === 'approved_blog' || item.publishTarget === 'blog') && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(getEditorPath(item.id))}
          className="gap-1"
        >
          <Edit3 className="h-4 w-4" /> Edit
        </Button>
      )}

      {statusFilter !== 'published_live' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(getEditorPath(item.id))}
          className="gap-1"
        >
          <Edit3 className="h-4 w-4" /> Open in Editor
        </Button>
      )}

      {statusFilter !== 'rejected' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleReject(item.id)}
          disabled={isLoading}
          className="gap-1 text-destructive hover:text-destructive"
        >
          {isLoading === 'rejecting' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          Reject
        </Button>
      )}

      {statusFilter === 'rejected' && (
        <>
          <Button
            variant="default"
            size="sm"
            onClick={() => handleRestore(item.id)}
            disabled={isLoading}
            className="gap-1"
          >
            {isLoading === 'restoring' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Undo2 className="h-4 w-4" />
            )}
            Restore to Review
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handlePermanentDelete(item.id)}
            disabled={isLoading}
            className="gap-1"
          >
            {isLoading === 'deleting' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete Permanently
          </Button>
        </>
      )}
    </div>
  );
}

function getHeroCacheBust(item) {
  if (typeof item.altCoverImage === 'string' && item.altCoverImage.includes('?t=')) {
    return item.altCoverImage.split('?t=')[1];
  }
  return null;
}

function getQueueItemCoverUrl(baseCoverUrl, cacheBust) {
  if (!baseCoverUrl || !cacheBust) return baseCoverUrl;
  return `${baseCoverUrl}${baseCoverUrl.includes('?') ? '&' : '?'}t=${cacheBust}`;
}

function QueueItemCover({ item, coverUrl, canGenerateHero, isGeneratingHero, handleGenerateHero }) {
  let icon = <Sparkles className="h-3.5 w-3.5" />;
  if (isGeneratingHero) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  } else if (coverUrl) {
    icon = <RefreshCw className="h-3.5 w-3.5" />;
  }

  return (
    <div className="relative w-full sm:w-32 h-24 shrink-0">
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className="w-full h-full object-cover rounded-md"
          loading="lazy"
        />
      ) : (
        <div
          className="w-full h-full rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-600"
          aria-label="No hero image yet"
        >
          <ImageIcon className="h-8 w-8" />
        </div>
      )}
      {canGenerateHero && (
        <button
          type="button"
          onClick={() => handleGenerateHero(item.id)}
          disabled={isGeneratingHero}
          title={coverUrl ? 'Regenerate hero image' : 'Generate hero image'}
          aria-label={coverUrl ? 'Regenerate hero image' : 'Generate hero image'}
          className="absolute bottom-1 right-1 h-7 w-7 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white flex items-center justify-center shadow-md disabled:opacity-60"
        >
          {icon}
        </button>
      )}
    </div>
  );
}

function QueueItemDateMeta({ item }) {
  const dateInfo = formatPublishedDate(item);
  const domain = getRootDomain(item);

  return (
    <>
      {domain && <div className="font-mono text-[11px]">{domain}</div>}
      {dateInfo && (
        <div className={dateInfo.isFallback ? 'italic opacity-75' : ''}>{dateInfo.label}</div>
      )}
    </>
  );
}

function QueueItemBadges({ item }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">{item['Cloud Provider'] || item.cloudProvider || 'Unknown'}</Badge>
      <Badge variant="secondary">{item.category || 'Uncategorized'}</Badge>
      {getSourceBadge(item)}
      {item.publishTarget && (
        <Badge className="gap-1">
          {item.publishTarget === 'blog' && <BookOpen className="h-3 w-3" />}
          {item.publishTarget}
        </Badge>
      )}
      {getLiveBadge(item)}
      <Badge variant="outline" className="font-mono text-[10px]">
        {item.contentStatus || 'unknown'}
      </Badge>
      {getDecayBadge(item)}
    </div>
  );
}

function QueueItemStats({ item }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {item.wordCount && <span>{item.wordCount} words</span>}
      {item.readTime && <span>• {item.readTime} read</span>}
      {item.sourceUrl && (
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          • View source
        </a>
      )}
    </div>
  );
}

/**
 * Individual queue item card component
 * Extracted from main component to reduce complexity
 */
function QueueItemCard({
  item,
  statusFilter,
  actionLoading,
  actionError,
  handleApprove,
  handleReject,
  handleReinspect,
  handleRestore,
  handlePermanentDelete,
  handleGenerateHero,
  navigate,
  isSelected,
  toggleSelected,
}) {
  const baseCoverUrl = getCoverImageUrl(item);
  const cacheBust = item.__regenAt || getHeroCacheBust(item);
  const coverUrl = getQueueItemCoverUrl(baseCoverUrl, cacheBust);
  const isLoading = actionLoading[item.id];
  const itemError = actionError[item.id];
  const canSelectForReject = statusFilter !== 'rejected' && statusFilter !== 'published_live';

  return (
    <Card key={item.id} className="overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        {canSelectForReject && (
          <div className="flex items-start pt-1">
            <input
              type="checkbox"
              aria-label="Select for bulk reject"
              checked={Boolean(isSelected)}
              onChange={() => toggleSelected?.(item.id)}
              className="h-4 w-4 cursor-pointer accent-destructive"
            />
          </div>
        )}
        <QueueItemCover
          item={item}
          coverUrl={coverUrl}
          canGenerateHero={Boolean(handleGenerateHero)}
          isGeneratingHero={actionLoading[item.id] === 'generatingHero'}
          handleGenerateHero={handleGenerateHero}
        />

        <div className="flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-base line-clamp-2">
                {item.Title || item.title || 'Untitled'}
              </h3>
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0 leading-tight">
              <QueueItemDateMeta item={item} />
            </div>
          </div>
          <QueueItemBadges item={item} />

          <p className="text-sm text-muted-foreground line-clamp-2">
            {item.Summary || item.summary || 'No summary available'}
          </p>

          <QueueItemStats item={item} />

          <QueueItemActions
            item={item}
            statusFilter={statusFilter}
            isLoading={isLoading}
            handleApprove={handleApprove}
            handleReject={handleReject}
            handleReinspect={handleReinspect}
            handleRestore={handleRestore}
            handlePermanentDelete={handlePermanentDelete}
            navigate={navigate}
          />
          {itemError && <p className="text-xs text-destructive mt-1">{itemError}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function QueuePage() {
  const navigate = useNavigate();
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'needs_review');
  const [contentTypeFilter, setContentTypeFilter] = useState(
    searchParams.get('contentType') || 'all'
  );
  const [sortKey, setSortKey] = useState(() => {
    const v = searchParams.get('sort');
    return v && SORT_OPTIONS[v] ? v : 'published';
  });
  const [sortDirection, setSortDirection] = useState(() => {
    const v = searchParams.get('dir');
    return v === 'asc' ? 'asc' : 'desc';
  });
  const [actionLoading, setActionLoading] = useState({});
  const [actionError, setActionError] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [bulkDeletingRejected, setBulkDeletingRejected] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState(null);
  const [bulkDeleteMessage, setBulkDeleteMessage] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null); // { type: 'reject'|'bulkDelete'|'bulkReject'|'restore'|'deleteRejected', id?: string, ids?: string[] }
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [pageSize, setPageSize] = useState(() => {
    const fromUrl = Number(searchParams.get('pageSize'));
    return [50, 100, 200].includes(fromUrl) ? fromUrl : 100;
  });
  const confirmModalCopy = getConfirmModalCopy(confirmTarget);

  const displayedItems = useMemo(
    () => sortQueueItemsBy(items, sortKey, sortDirection),
    [items, sortKey, sortDirection]
  );

  // For bulk-reject confirmations, render a top-10 preview inside the modal
  // so the user can verify scope. Items are looked up out of the current
  // `items` array (only currently-rendered items can be selected anyway).
  const confirmModalPreview = (() => {
    if (confirmTarget?.type !== 'bulkReject') return null;
    const ids = confirmTarget.ids || [];
    if (ids.length === 0) return null;
    const byId = new Map(items.map((it) => [it.id, it]));
    const previewItems = ids
      .slice(0, 10)
      .map((id) => byId.get(id))
      .filter(Boolean);
    const overflow = Math.max(ids.length - previewItems.length, 0);
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 max-h-72 overflow-y-auto text-sm">
        <ul className="space-y-2">
          {previewItems.map((it) => {
            const dateInfo = formatPublishedDate(it);
            const domain = getRootDomain(it);
            return (
              <li key={it.id} className="flex flex-col gap-0.5">
                <span className="font-medium leading-snug line-clamp-2">
                  {it.Title || it.title || 'Untitled'}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {domain || ''}
                  {dateInfo ? ` · ${dateInfo.label}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
        {overflow > 0 && (
          <p className="mt-2 text-xs text-muted-foreground italic">
            …and {overflow} more not shown.
          </p>
        )}
      </div>
    );
  })();

  useEffect(() => {
    if (!authReady) return;
    async function loadItems() {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await postJSON('getQueueSnapshot', {
          statusFilter,
          contentTypeFilter,
          itemLimit: pageSize,
        });
        setItems((result.items || []).sort(sortQueueItems));
        setTotalCount(result.totalCount || 0);
      } catch (err) {
        console.error('Error loading queue:', err);
        setLoadError(err.message || 'Failed to load queue items.');
      } finally {
        setLoading(false);
      }
    }
    loadItems();
  }, [authReady, statusFilter, contentTypeFilter, pageSize]);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set('status', statusFilter);
    next.set('contentType', contentTypeFilter);
    next.set('pageSize', String(pageSize));
    next.set('sort', sortKey);
    next.set('dir', sortDirection);
    setSearchParams(next, { replace: true });
  }, [statusFilter, contentTypeFilter, pageSize, sortKey, sortDirection, setSearchParams]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, contentTypeFilter]);

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkReject = () => {
    const ids = Array.from(selectedIds).filter((id) => items.some((it) => it.id === id));
    if (ids.length < 2) return;
    setConfirmTarget({ type: 'bulkReject', ids });
  };

  const doBulkReject = async (ids) => {
    setBulkRejecting(true);
    setBulkDeleteError(null);
    setBulkDeleteMessage(null);
    let successCount = 0;
    const failures = [];
    try {
      for (const contentId of ids) {
        try {
          await postJSON('transitionContentStatus', {
            contentId,
            newStatus: 'rejected',
            markLive: false,
            reviewNotes: 'Bulk rejected from queue',
          });
          await logAdminAction('content_rejected', { contentId, bulk: true });
          successCount += 1;
        } catch (err) {
          console.error('Bulk reject error for', contentId, err);
          failures.push({ id: contentId, message: err?.message || 'Unknown error' });
        }
      }
      const failedIds = new Set(failures.map((f) => f.id));
      const successSet = new Set(ids.filter((id) => !failedIds.has(id)));
      setItems((prev) => prev.filter((item) => !successSet.has(item.id)));
      setSelectedIds(new Set());
      if (failures.length) {
        setActionError((prev) => {
          const next = { ...prev };
          for (const f of failures) next[f.id] = `Reject failed: ${f.message}`;
          return next;
        });
      }
      setBulkDeleteMessage(
        `Rejected ${successCount} item${successCount === 1 ? '' : 's'}.${
          failures.length
            ? ` ${failures.length} failed — see red error under each remaining card.`
            : ''
        }`
      );
    } finally {
      setBulkRejecting(false);
    }
  };

  const handleApprove = async (item) => {
    const contentId = item.id;
    const publishTarget = getPublishTargetForItem(item);

    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'approving' }));
    try {
      const newStatus = 'approved_blog';

      await postJSON('transitionContentStatus', {
        contentId,
        newStatus,
        publishTarget,
        markLive: false,
        reviewNotes: `Approved in queue for ${publishTarget} publish stage`,
      });

      await logAdminAction('content_approved', { contentId, publishTarget, newStatus });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Approve error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Approve failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleReject = (contentId) => {
    setConfirmTarget({ type: 'reject', id: contentId });
  };

  const doReject = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'rejecting' }));
    try {
      await postJSON('transitionContentStatus', {
        contentId,
        newStatus: 'rejected',
        markLive: false,
        reviewNotes: 'Rejected from queue',
      });
      await logAdminAction('content_rejected', { contentId });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Reject error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Reject failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleDeleteRejectedNow = () => {
    if (statusFilter !== 'rejected') {
      setBulkDeleteError('Switch the filter to Rejected to bulk delete those items.');
      return;
    }
    setConfirmTarget({ type: 'bulkDelete' });
  };

  const doBulkDelete = async () => {
    setBulkDeleteError(null);
    setBulkDeleteMessage(null);
    setBulkDeletingRejected(true);
    try {
      let deletedCount = 0;
      let hasMore = false;

      do {
        const result = await postJSON('deleteRejectedContent', { limit: 100 });
        deletedCount += result.deletedCount || 0;
        hasMore = result.hasMore === true && (result.deletedCount || 0) > 0;
      } while (hasMore);

      await logAdminAction('bulk_delete_rejected', { deletedCount, mode: 'soft' });
      setItems([]);
      setBulkDeleteMessage(`Soft-deleted ${deletedCount} rejected items. Recoverable for 7 days.`);
    } catch (err) {
      console.error('Delete rejected error:', err);
      setBulkDeleteError(`Delete rejected failed: ${err.message}`);
    } finally {
      setBulkDeletingRejected(false);
    }
  };

  const handleRestore = (contentId) => {
    setConfirmTarget({ type: 'restore', id: contentId });
  };

  const handlePermanentDelete = (contentId) => {
    setConfirmTarget({ type: 'deleteRejected', id: contentId });
  };

  const doRestore = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'restoring' }));
    try {
      await postJSON('transitionContentStatus', {
        contentId,
        newStatus: 'inspected',
        reviewNotes: 'Restored from rejected status',
      });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Restore error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Restore failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const doPermanentDelete = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'deleting' }));
    try {
      await postJSON('deleteContentItem', { contentId });
      await logAdminAction('content_deleted_from_rejected_queue', { contentId });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Permanent delete error:', err);
      setActionError((prev) => ({
        ...prev,
        [contentId]: `Permanent delete failed: ${err.message}`,
      }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleConfirm = useCallback(async () => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    if (target.type === 'reject') await doReject(target.id);
    else if (target.type === 'bulkDelete') await doBulkDelete();
    else if (target.type === 'bulkReject') await doBulkReject(target.ids || []);
    else if (target.type === 'restore') await doRestore(target.id);
    else if (target.type === 'deleteRejected') await doPermanentDelete(target.id);
  }, [confirmTarget]);

  const handleReinspect = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'inspecting' }));
    try {
      await requestContentInspection(contentId);
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Reinspect error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Reinspect failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleGenerateHero = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'generatingHero' }));
    try {
      const result = await postJSON('generateReviewHeroImage', { contentId });
      if (!result?.success) {
        throw new Error(result?.error || 'Image generation failed');
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === contentId
            ? {
                ...item,
                altCoverImage: result.imageUrl,
                __regenAt: Date.now(),
              }
            : item
        )
      );
    } catch (err) {
      console.error('Generate hero error:', err);
      setActionError((prev) => ({
        ...prev,
        [contentId]: `Image generation failed: ${err.message}`,
      }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content Queue</h1>
          <p className="text-muted-foreground">
            Mixed intake review board for manual URL submissions and RSS-fed candidates before
            staging in Publish
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Showing {items.length} of {totalCount} matching items.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeleteRejectedNow}
            disabled={bulkDeletingRejected || statusFilter !== 'rejected' || totalCount === 0}
            className="gap-1 text-destructive hover:text-destructive"
          >
            {bulkDeletingRejected ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete Rejected Now
          </Button>
          {selectedIds.size > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkReject}
              disabled={bulkRejecting}
              className="gap-1 text-destructive hover:text-destructive border-destructive/60"
            >
              {bulkRejecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Reject All Now ({selectedIds.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="gap-1"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Rejected decay-countdown explanation banner */}
      {statusFilter === 'rejected' && (
        <div className="rounded-md border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="font-medium">Rejected items decay automatically.</p>
          <p className="mt-1 text-xs">
            Rejected items get a 24-hour grace period, then move to soft-delete with a 7-day
            recovery window before permanent removal (the countdown badge on each card shows where
            it is in that decay). Use the <strong>Restore to Review</strong> button on a card to
            pull an item back into the pipeline before it expires.
          </p>
        </div>
      )}

      {/* Load error banner */}
      {loadError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load queue: {loadError}
        </div>
      )}

      {/* Bulk delete feedback */}
      {bulkDeleteError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {bulkDeleteError}
        </div>
      )}
      {bulkDeleteMessage && (
        <div className="rounded-md border border-green-500/50 bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {bulkDeleteMessage}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filter by Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Label className="text-xs">Content Type</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {CONTENT_TYPE_OPTIONS.map(({ value, label }) => (
                <Button
                  key={value}
                  variant={contentTypeFilter === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setContentTypeFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
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
          <div className="mt-3 flex flex-wrap items-end gap-6">
            <div>
              <Label className="text-xs">Show per page</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {[50, 100, 200].map((size) => (
                  <Button
                    key={size}
                    variant={pageSize === size ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPageSize(size)}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Sort by</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(SORT_OPTIONS).map(([value, { label }]) => (
                  <Button
                    key={value}
                    variant={sortKey === value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSortKey(value)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                  title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                >
                  {sortDirection === 'asc' ? '↑ Asc' : '↓ Desc'}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <QueueList
        items={displayedItems}
        loading={loading}
        actionLoading={actionLoading}
        actionError={actionError}
        handleApprove={handleApprove}
        handleReject={handleReject}
        handleReinspect={handleReinspect}
        handleRestore={handleRestore}
        handlePermanentDelete={handlePermanentDelete}
        handleGenerateHero={handleGenerateHero}
        navigate={navigate}
        statusFilter={statusFilter}
        selectedIds={selectedIds}
        toggleSelected={toggleSelected}
      />

      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={confirmModalCopy.title}
        description={confirmModalCopy.description}
        preview={confirmModalPreview}
        confirmLabel={confirmModalCopy.confirmLabel}
        destructive={confirmModalCopy.destructive}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
