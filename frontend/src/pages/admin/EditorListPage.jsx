import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePublicData } from '@/hooks/usePublicData';
import { useAuthReady } from '@/hooks/useAuthReady';
import { getCoverImageUrl, formatPostDate } from '@/lib/blogUtils';
import { byNewest, toDate } from '@/lib/dateUtils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { postJSON, getJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';
import { unpublishToInspected } from '@/lib/contentWorkflow';
import {
  getCanonicalContentType,
  getContentPublicPath,
  getPublishTargetForItem,
} from '@/lib/contentModel';
import {
  PenLine,
  ExternalLink,
  Search,
  Loader2,
  Archive,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ExternalLink as LinkIcon,
  Clock3,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getContentType(item) {
  return getCanonicalContentType(item);
}

function getPublicUrl(item) {
  const explicitUrl =
    item.slugPageUrl ||
    item.publishedUrl ||
    item.blogUrl ||
    item.publicUrl ||
    (item.curatedSubpagePath
      ? `https://hybridcloudworks.com${String(item.curatedSubpagePath).startsWith('/') ? item.curatedSubpagePath : `/${item.curatedSubpagePath}`}`
      : '');
  if (explicitUrl) return explicitUrl;

  const publicPath = getContentPublicPath(item);
  if (publicPath) return publicPath;

  const publishTarget = getPublishTargetForItem(item);
  if (!publishTarget) return null;
  return null;
}

function getProviderDisplay(item) {
  return item['Cloud Provider'] || item.cloudProvider || '—';
}

const TYPE_BADGE = {
  blog: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  framework: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
  architecture: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  coder_corner: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  news: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
};

const PROVIDER_OPTIONS = ['All', 'Azure', 'AWS', 'GCP', 'FinOps', 'GitHub', 'Terraform'];

function matchesProviderFilter(item, providerFilter) {
  if (providerFilter === 'All') return true;
  const raw = (item['Cloud Provider'] || item.cloudProvider || '').toLowerCase();
  return raw.includes(providerFilter.toLowerCase());
}

function matchesItemSearch(item, queryText) {
  const query = queryText.trim().toLowerCase();
  if (!query) return true;
  const title = String(item.Title || item.title || '').toLowerCase();
  const provider = String(item['Cloud Provider'] || item.cloudProvider || '').toLowerCase();
  return title.includes(query) || provider.includes(query);
}

function filterByType(items, typeFilter) {
  if (typeFilter === 'all') return items;
  return items.filter((item) => getContentType(item) === typeFilter);
}

// Every comparator in this file was timestamp-object-only, so against the ISO strings
// Cosmos returns each scored 0 and the sorts were permanent no-ops — the lists
// rendered in raw Cosmos order while the controls appeared to work
// (TODO.md T-304).
const sortByPublishedDateDesc = byNewest('blogPublishedAt');
const sortByUpdatedDateDesc = byNewest('updatedAt', 'blogEditedAt');

function filterAndSortLiveItems(items, typeFilter, searchText) {
  const byType = filterByType(items, typeFilter);
  const bySearch = byType.filter((item) => matchesItemSearch(item, searchText));
  return [...bySearch].sort(sortByPublishedDateDesc);
}

function filterAndSortDraftItems(items, typeFilter, searchText) {
  const notLive = items.filter((item) => item.Live !== true);
  const byType = filterByType(notLive, typeFilter);
  const bySearch = byType.filter((item) => matchesItemSearch(item, searchText));
  return [...bySearch].sort(sortByUpdatedDateDesc);
}

const ARCHIVE_SORT_COMPARE = {
  // `archivedAt` and `updatedAt` were byte-identical before, so the two menu
  // entries did the same thing even once the comparator worked. Kept distinct
  // now, which is what the labels promise.
  archivedAt: byNewest('archivedAt', 'updatedAt'),
  updatedAt: byNewest('updatedAt'),
  publishedAt: byNewest('blogPublishedAt'),
  provider: (a, b) => getProviderDisplay(a).localeCompare(getProviderDisplay(b)),
};

function compareArchivedItems(a, b, archiveSortField, archiveSortDir) {
  const compare = ARCHIVE_SORT_COMPARE[archiveSortField];
  if (!compare) return 0;
  const dir = archiveSortDir === 'asc' ? 1 : -1;
  return compare(a, b) * dir;
}

function filterAndSortArchivedItems(
  items,
  archiveProviderFilter,
  archiveSearch,
  archiveSortField,
  archiveSortDir
) {
  const byProvider =
    archiveProviderFilter === 'All'
      ? items
      : items.filter((item) => matchesProviderFilter(item, archiveProviderFilter));
  const query = archiveSearch.trim().toLowerCase();
  const bySearch =
    query.length === 0
      ? byProvider
      : byProvider.filter((item) =>
          String(item.Title || item.title || '')
            .toLowerCase()
            .includes(query)
        );
  return [...bySearch].sort((a, b) => compareArchivedItems(a, b, archiveSortField, archiveSortDir));
}

// ── Live item row ─────────────────────────────────────────────────────────────

function LiveItemRow({ item, onArchive, onUnpublish, actionId }) {
  const coverUrl = getCoverImageUrl(item);
  const type = getContentType(item);
  const publicUrl = getPublicUrl(item);
  const provider = getProviderDisplay(item);
  const title = item.Title || item.title || 'Untitled';
  const isActing = actionId === item.id;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors">
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className="h-12 w-16 object-cover rounded shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="h-12 w-16 rounded bg-muted shrink-0 flex items-center justify-center">
          <PenLine className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {provider}
          </Badge>
          <span
            className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium ${TYPE_BADGE[type] || TYPE_BADGE.blog}`}
          >
            {type}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatPostDate(item.blogPublishedAt)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="View live page"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        <Link
          to={`/admin/editor/${item.id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors"
        >
          <PenLine className="h-3.5 w-3.5" />
          Edit
        </Link>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-xs"
          disabled={isActing}
          onClick={() => onUnpublish(item)}
          title="Unpublish — removes from live site and returns to Publish queue"
        >
          {isActing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
          Unpublish
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-xs text-muted-foreground hover:text-foreground"
          disabled={isActing}
          onClick={() => onArchive(item)}
          title="Archive — move to archive board"
        >
          {isActing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Archive className="h-3.5 w-3.5" />
          )}
          Archive
        </Button>
      </div>
    </div>
  );
}

// ── Archive board row ─────────────────────────────────────────────────────────

function ArchiveRow({ item }) {
  const publicUrl = getPublicUrl(item);
  const provider = getProviderDisplay(item);
  const type = getContentType(item);
  const archivedAt = toDate(item.archivedAt) || toDate(item.updatedAt);
  const publishedAt = toDate(item.blogPublishedAt);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors text-sm">
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-sm">{item.Title || item.title || 'Untitled'}</p>
        <div className="flex flex-wrap items-center gap-2 mt-0.5">
          <Badge variant="outline" className="text-[11px]">
            {provider}
          </Badge>
          <span
            className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_BADGE[type] || TYPE_BADGE.blog}`}
          >
            {type}
          </span>
          {publishedAt && (
            <span className="text-xs text-muted-foreground">
              Published{' '}
              {new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }).format(publishedAt)}
            </span>
          )}
          {archivedAt && (
            <span className="text-xs text-muted-foreground">
              · Archived{' '}
              {new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              }).format(archivedAt)}
            </span>
          )}
        </div>
      </div>
      {publicUrl && (
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-500 hover:underline shrink-0"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          View
        </a>
      )}
      <Badge variant="secondary" className="text-[10px] shrink-0">
        archived
      </Badge>
    </div>
  );
}

function DraftItemRow({ item }) {
  const type = getContentType(item);
  const provider = getProviderDisplay(item);
  const title = item.Title || item.title || 'Untitled';
  const status = String(item.contentStatus || 'editing').replace(/_/g, ' ');
  const updatedAt = toDate(item.updatedAt) || toDate(item.blogEditedAt);

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {provider}
          </Badge>
          <span
            className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium ${TYPE_BADGE[type] || TYPE_BADGE.blog}`}
          >
            {type}
          </span>
          <Badge variant="secondary" className="text-[11px]">
            {status}
          </Badge>
          {updatedAt && (
            <span className="text-xs text-muted-foreground">
              Updated{' '}
              {new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              }).format(updatedAt)}
            </span>
          )}
        </div>
      </div>

      <Link
        to={`/admin/editor/${item.id}`}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors"
      >
        <PenLine className="h-3.5 w-3.5" />
        Edit
      </Link>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EditorListPage() {
  const navigate = useNavigate();
  const { authReady } = useAuthReady();

  const listContent = (qs) => getJSON(`cms/content?${qs}`).then((res) => res.items || []);
  const { data: liveItems, loading: liveLoading } = usePublicData(
    () => listContent('live=true&limit=500'),
    authReady ? 'editor:live' : ''
  );
  const { data: archivedItems, loading: archiveLoading } = usePublicData(
    () => listContent('status=archived&limit=500'),
    authReady ? 'editor:archived' : ''
  );
  const { data: draftItems, loading: draftLoading } = usePublicData(
    () => listContent('status=editing,approved_blog&limit=500'),
    authReady ? 'editor:drafts' : ''
  );

  const loading = liveLoading || archiveLoading || draftLoading;
  const liveList = useMemo(() => liveItems ?? [], [liveItems]);
  const draftList = useMemo(() => draftItems ?? [], [draftItems]);
  const archivedList = useMemo(() => archivedItems ?? [], [archivedItems]);

  // Live board state
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  // Archive board state
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveProviderFilter, setArchiveProviderFilter] = useState('All');
  const [archiveSortField, setArchiveSortField] = useState('archivedAt');
  const [archiveSortDir, setArchiveSortDir] = useState('desc');
  const [showArchive, setShowArchive] = useState(false);

  // Action state
  const [actionId, setActionId] = useState('');
  const [actionError, setActionError] = useState('');
  const [unpublishTarget, setUnpublishTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);

  // Live counts
  const counts = useMemo(() => {
    const c = { blog: 0, framework: 0, architecture: 0, coder_corner: 0, news: 0 };
    liveList.forEach((item) => {
      const t = getContentType(item);
      c[t] = (c[t] || 0) + 1;
    });
    return c;
  }, [liveList]);

  // Filtered live items
  const filteredLive = useMemo(() => {
    return filterAndSortLiveItems(liveList, typeFilter, search);
  }, [liveList, search, typeFilter]);

  const filteredDrafts = useMemo(() => {
    return filterAndSortDraftItems(draftList, typeFilter, search);
  }, [draftList, search, typeFilter]);

  // Filtered + sorted archive items
  const filteredArchive = useMemo(() => {
    return filterAndSortArchivedItems(
      archivedList,
      archiveProviderFilter,
      archiveSearch,
      archiveSortField,
      archiveSortDir
    );
  }, [archivedList, archiveSearch, archiveProviderFilter, archiveSortField, archiveSortDir]);

  const TYPE_TABS = [
    { key: 'all', label: `All (${liveList.length})` },
    { key: 'blog', label: `Blogs (${counts.blog})` },
    { key: 'framework', label: `Frameworks (${counts.framework})` },
    { key: 'architecture', label: `Architecture (${counts.architecture})` },
    { key: 'coder_corner', label: `Code (${counts.coder_corner})` },
    { key: 'news', label: `News / RSS (${counts.news})` },
  ];

  const SORT_OPTIONS = [
    { value: 'archivedAt', label: 'Archived Date' },
    { value: 'publishedAt', label: 'Published Date' },
    { value: 'provider', label: 'Technology' },
  ];

  const emptyArchiveMessage =
    archiveSearch || archiveProviderFilter !== 'All'
      ? 'No archived items match your filters.'
      : 'No archived content yet.';

  function renderSortChevron(optionValue) {
    if (archiveSortField !== optionValue) {
      return null;
    }

    return archiveSortDir === 'asc' ? (
      <ChevronUp className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3" />
    );
  }

  function renderArchiveContent() {
    if (archiveLoading) {
      return (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (filteredArchive.length === 0) {
      return (
        <p className="text-sm text-muted-foreground text-center py-6">{emptyArchiveMessage}</p>
      );
    }

    return (
      <div className="space-y-1.5">
        {filteredArchive.map((item) => (
          <ArchiveRow key={item.id} item={item} />
        ))}
      </div>
    );
  }

  function toggleSort(field) {
    if (archiveSortField === field) {
      setArchiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setArchiveSortField(field);
      setArchiveSortDir('desc');
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  const doUnpublish = async (item) => {
    setActionError('');
    setActionId(item.id);
    try {
      const currentStatus = item.contentStatus || '';
      await unpublishToInspected(
        item.id,
        currentStatus,
        `Unpublished from Editor board (was ${currentStatus || 'unknown'}) - returned to review queue`
      );
      navigate('/admin/queue');
    } catch (err) {
      console.error('Unpublish error:', err);
      setActionError(`Unpublish failed: ${err.message}`);
    } finally {
      setActionId('');
    }
  };

  const doArchive = async (item) => {
    setActionError('');
    setActionId(item.id);
    try {
      await postJSON('transitionContentStatus', {
        contentId: item.id,
        newStatus: 'archived',
        markLive: false,
        reviewNotes: 'Archived from Editor board',
      });
      await logAdminAction('content_archived', { contentId: item.id });
    } catch (err) {
      console.error('Archive error:', err);
      setActionError(`Archive failed: ${err.message}`);
    } finally {
      setActionId('');
    }
  };

  function renderLiveBoardSection() {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or provider…"
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {TYPE_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTypeFilter(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  typeFilter === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!loading && filteredDrafts.length > 0 && (
          <Card className="border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock3 className="h-4 w-4" />
                Pre-Live Drafts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredDrafts.map((item) => (
                <DraftItemRow key={item.id} item={item} />
              ))}
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && filteredLive.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {search || typeFilter !== 'all'
                ? 'No items match your filters.'
                : 'No live published content found.'}
            </CardContent>
          </Card>
        )}

        {!loading && filteredLive.length > 0 && (
          <div className="space-y-2">
            {filteredLive.map((item) => (
              <LiveItemRow
                key={item.id}
                item={item}
                actionId={actionId}
                onUnpublish={(i) => setUnpublishTarget(i)}
                onArchive={(i) => setArchiveTarget(i)}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderArchiveSection() {
    return (
      <section>
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setShowArchive((v) => !v)}
        >
          <Archive className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold tracking-tight">Archive ({archivedList.length})</h2>
          {showArchive ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
          )}
        </button>

        {showArchive && (
          <Card className="mt-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Archived articles — removed from live site. Sorted by{' '}
                {SORT_OPTIONS.find((o) => o.value === archiveSortField)?.label}.
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={archiveSearch}
                    onChange={(e) => setArchiveSearch(e.target.value)}
                    placeholder="Search archive…"
                    className="pl-9 h-8 text-sm"
                  />
                </div>
                <div className="flex gap-1 flex-wrap">
                  {PROVIDER_OPTIONS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setArchiveProviderFilter(p)}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        archiveProviderFilter === p
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 ml-auto">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleSort(opt.value)}
                      className={`flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        archiveSortField === opt.value
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                      {renderSortChevron(opt.value)}
                    </button>
                  ))}
                </div>
              </div>

              {renderArchiveContent()}
            </CardContent>
          </Card>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Editor</h1>
        <p className="text-sm text-muted-foreground">
          {loading
            ? 'Loading…'
            : `${filteredDrafts.length} pre-live drafts and ${liveList.length} live published items`}
        </p>
        {actionError && <p className="text-sm text-destructive mt-1">{actionError}</p>}
      </div>

      {renderLiveBoardSection()}
      {renderArchiveSection()}

      {/* ── Confirm modals ── */}
      <ConfirmModal
        open={Boolean(unpublishTarget)}
        title="Unpublish this article?"
        description="This removes it from the live site and sitemap, and returns it to the Publish queue where it can be edited or rejected."
        confirmLabel="Unpublish"
        onConfirm={() => {
          const item = unpublishTarget;
          setUnpublishTarget(null);
          doUnpublish(item);
        }}
        onCancel={() => setUnpublishTarget(null)}
      />
      <ConfirmModal
        open={Boolean(archiveTarget)}
        title="Archive this article?"
        description="This removes it from the live site and moves it to the Archive board. It won't appear in the publish queue."
        confirmLabel="Archive"
        onConfirm={() => {
          const item = archiveTarget;
          setArchiveTarget(null);
          doArchive(item);
        }}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
