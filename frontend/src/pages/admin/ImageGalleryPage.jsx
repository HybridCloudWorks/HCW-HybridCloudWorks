/**
 * Image Gallery — the central media library (ADR 0033 Creative slice).
 *
 * Visual first: a thumbnail grid with hover actions and a details dialog per
 * image; server-side search, filters, sort and paging (lib/imageGallery.js
 * → GET cms/images); bulk actions that patch each selected image against its
 * own document (POST cms/images/bulk — the fix for "Update Selected" touching
 * one image and tag toggles erasing tags); archive, trash and permanent
 * delete; folders persisted in admin_config/gallery_folders; upload and
 * import-from-URL. Every image that came from a prompt set links back to it
 * on Image Prompts.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Images, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/admin/shared/PageHeader';
import EmptyState from '@/components/admin/shared/EmptyState';
import GalleryTile from '@/components/admin/images/GalleryTile';
import GalleryToolbar from '@/components/admin/images/GalleryToolbar';
import BulkActionsBar from '@/components/admin/images/BulkActionsBar';
import ImageDetailsDialog from '@/components/admin/images/ImageDetailsDialog';
import UploadPanel from '@/components/admin/images/UploadPanel';
import {
  asListing,
  bulkGalleryImages,
  customTagOptions,
  deleteGalleryImage,
  fetchGalleryFolders,
  folderOptions,
  providerOptions,
  queryGalleryImages,
  saveGalleryFolders,
  slotOptions,
  toggledSelection,
  updateGalleryImage,
} from '@/lib/imageGallery';
import { resolveMediaUrl } from '@/lib/functionsBase';

const DEFAULT_FILTERS = Object.freeze({
  q: '',
  folder: 'all',
  source: 'all',
  provider: 'all',
  slot: 'all',
  tag: 'all',
  set: '',
  state: 'active',
  sort: 'newest',
  offset: 0,
  limit: 60,
});

const PAGE_SIZES = [60, 120, 200];

/** What a permanent delete did, in one sentence. */
export function deletionMessage(item, res) {
  if (res.storageDeleted) return `"${item.title}" and its file were deleted.`;
  if (res.sharedWith) {
    const others = `${res.sharedWith} other record${res.sharedWith === 1 ? '' : 's'}`;
    return `"${item.title}" was deleted; the file stays because ${others} use it.`;
  }
  return `"${item.title}" was deleted; no stored file was found for it.`;
}

/** The empty-state copy for a state tab with nothing in it. */
function emptyStateFor(state) {
  if (state === 'trash') {
    return {
      title: 'Trash is empty',
      description: 'Trashed images appear here until you restore or delete them.',
    };
  }
  if (state === 'archived') {
    return {
      title: 'No archived images',
      description: 'Archived images appear here, hidden from pickers but kept.',
    };
  }
  return { title: 'No images', description: 'Nothing has been recorded in any state.' };
}

/** True when any filter other than paging and state differs from the default. */
export function hasActiveFilters(filters) {
  return ['q', 'folder', 'source', 'provider', 'slot', 'tag', 'set'].some(
    (key) => String(filters[key] || '') !== String(DEFAULT_FILTERS[key] || '')
  );
}

const HELP = [
  'Every image the site holds is here: uploaded by hand, imported from a URL, generated as an AI cover or preview, or curated for a news grid.',
  'Hover or tab to a tile for its actions; open Details to edit the title, alt text, caption, licence, tags and folder, and to see which content uses it and the prompt and set that produced it.',
  'Tick several tiles to tag, move, archive, trash or delete them together. A tag toggle adds to every selected image, or removes it when all of them already have it — other tags are untouched.',
  'Archive keeps an image but hides it from pickers. Trash hides it everywhere and keeps the file until you delete permanently from the Trash filter.',
  'A "Duplicate" chip means the same bytes or URL already exist in an earlier record. "Used in N" counts the content documents whose cover or inline slots point at the image.',
];

/** Filters a link can carry: `?set=NAME`, `?q=TEXT`, `?state=trash`, `?folder=aws`. */
export function filtersFromSearch(search) {
  const params = new URLSearchParams(search || '');
  const next = { ...DEFAULT_FILTERS };
  for (const key of ['q', 'set', 'folder', 'source', 'provider', 'slot', 'tag', 'state', 'sort']) {
    const value = params.get(key);
    if (value) next[key] = value;
  }
  // A link into a set or a search should find the image whatever its state.
  if ((next.set || next.q) && !params.get('state')) next.state = 'all';
  return next;
}

export default function ImageGalleryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [filters, setFilters] = useState(() => filtersFromSearch(location.search));
  const [debouncedQ, setDebouncedQ] = useState(() => filtersFromSearch(location.search).q);
  const [listing, setListing] = useState({ items: [], total: 0, hasMore: false, facets: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [persistedFolders, setPersistedFolders] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [detailsId, setDetailsId] = useState('');
  const [message, setMessage] = useState('');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q), 250);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const queryParams = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);

  // One read per (filters, generation); a slower older answer never paints
  // over a newer one because the cleanup marks it stale.
  const readListing = useCallback(async (params, isStale) => {
    setLoading(true);
    try {
      const next = await queryGalleryImages(params);
      if (isStale()) return;
      // asListing again here: idempotent on the envelope, and it means a
      // caller (or a test) handing back a bare array still renders.
      setListing(asListing(next));
      setError('');
    } catch (err) {
      if (isStale()) return;
      setListing({ items: [], total: 0, hasMore: false, facets: null });
      setError(err?.message || 'The gallery could not be read.');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The read marks itself pending; that is the one state write an effect
    // that starts a fetch has to make.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    readListing(queryParams, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [queryParams, generation, readListing]);

  useEffect(() => {
    let cancelled = false;
    fetchGalleryFolders()
      .then((folders) => {
        if (!cancelled) setPersistedFolders(folders);
      })
      .catch(() => {
        // Folders fall back to the seeds plus whatever the items use.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);
  const { items, facets } = listing;
  const folders = useMemo(() => folderOptions(items, persistedFolders), [items, persistedFolders]);
  const providerValues = useMemo(
    () =>
      facets?.providers?.length
        ? facets.providers.map((p) => p.toUpperCase())
        : providerOptions(items).slice(1),
    [facets, items]
  );
  const slotValues = useMemo(
    () => (facets?.slots?.length ? facets.slots : slotOptions(items).slice(1)),
    [facets, items]
  );
  const tagValues = useMemo(
    () => (facets?.tags?.length ? facets.tags : customTagOptions(items).slice(1)),
    [facets, items]
  );
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );
  const detailsItem = useMemo(
    () => items.find((item) => item.id === detailsId) || null,
    [items, detailsId]
  );

  const say = (text) => {
    setMessage(text);
    setError('');
  };
  const fail = (text) => setError(text);

  const withBusy = async (ids, work) => {
    setBusyIds((prev) => new Set([...prev, ...ids]));
    try {
      await work();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const runBulk = async (targets, action, extra = {}) => {
    if (!targets.length) return;
    setBulkBusy(true);
    try {
      await withBusy(
        targets.map((t) => t.id),
        async () => {
          const res = await bulkGalleryImages(targets, action, extra);
          const verb = {
            tag: 'retagged',
            move: `moved to ${extra.folder}`,
            archive: 'archived',
            restore: 'restored',
            trash: 'moved to trash',
            untrash: 'restored',
            delete: 'deleted permanently',
            set: 'updated',
          }[action];
          say(
            `${res.updated} image${res.updated === 1 ? '' : 's'} ${verb}${res.failed ? `; ${res.failed} failed` : ''}.`
          );
          if (['delete', 'trash', 'archive', 'restore'].includes(action)) {
            setSelectedIds(new Set());
            if (targets.some((t) => t.id === detailsId) && action === 'delete') setDetailsId('');
          }
          refresh();
        }
      );
    } catch (err) {
      fail(`${action} failed: ${err?.message || err}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const copyText = async (text, id) => {
    try {
      await navigator.clipboard.writeText(resolveMediaUrl(text));
      setCopiedId(id);
      setTimeout(() => setCopiedId(''), 2000);
    } catch (err) {
      fail(`Could not copy: ${err?.message || err}`);
    }
  };

  const reuse = (item) => {
    if (item?.imageUrl) navigate(`/admin/submit?reuseImage=${encodeURIComponent(item.imageUrl)}`);
  };

  const saveDetails = async (item, fields) => {
    try {
      await withBusy([item.id], async () => {
        await updateGalleryImage(item, fields);
        say(`"${fields.title || item.title}" saved.`);
        refresh();
      });
    } catch (err) {
      fail(`Save failed: ${err?.message || err}`);
    }
  };

  const deleteOne = async (item) => {
    try {
      await withBusy([item.id], async () => {
        const res = await deleteGalleryImage(item);
        say(deletionMessage(item, res));
        setDetailsId('');
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        refresh();
      });
    } catch (err) {
      fail(`Delete failed: ${err?.message || err}`);
    }
  };

  const changeFolders = async (next) => {
    try {
      setPersistedFolders(await saveGalleryFolders(next));
    } catch (err) {
      fail(`Folders could not be saved: ${err?.message || err}`);
    }
  };

  const page = Math.floor(filters.offset / filters.limit) + 1;
  const pageCount = Math.max(1, Math.ceil(listing.total / filters.limit));
  const first = listing.total === 0 ? 0 : filters.offset + 1;
  const last = Math.min(filters.offset + items.length, listing.total);
  const summary = loading
    ? 'Loading images…'
    : `Showing ${first}–${last} of ${listing.total}${selectedIds.size ? ` · ${selectedIds.size} selected` : ''}`;

  let grid;
  if (error) {
    grid = (
      <EmptyState
        variant="error"
        title="The gallery could not be read"
        description={error}
        onRetry={refresh}
      />
    );
  } else if (loading && items.length === 0) {
    grid = (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading images…
      </div>
    );
  } else if (items.length === 0 && hasActiveFilters(filters)) {
    grid = (
      <EmptyState
        variant="filtered"
        title="Nothing matches these filters"
        description="Try a broader search, another folder or source, or clear the filters."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilters({ ...DEFAULT_FILTERS, state: filters.state })}
          >
            Clear filters
          </Button>
        }
      />
    );
  } else if (items.length === 0 && filters.state !== 'active') {
    grid = <EmptyState {...emptyStateFor(filters.state)} />;
  } else if (items.length === 0) {
    grid = (
      <EmptyState
        icon={Images}
        title="No images yet"
        description="Upload or import an image above, generate a cover from the review queue, or try an image set on Image Prompts — everything lands here."
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/image-prompts')}>
            Open Image Prompts
          </Button>
        }
      />
    );
  } else {
    grid = (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((item) => (
          <GalleryTile
            key={item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            busy={busyIds.has(item.id)}
            copied={copiedId === `url-${item.id}`}
            onToggleSelect={(id) => setSelectedIds((prev) => toggledSelection(prev, id))}
            onOpen={(it) => setDetailsId(it.id)}
            onReuse={reuse}
            onCopy={copyText}
            onArchive={(it) => runBulk([it], 'archive')}
            onTrash={(it) => runBulk([it], 'trash')}
            onRestore={(it) => runBulk([it], 'restore')}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Images}
        title="Image Gallery"
        help={HELP}
        status={
          facets?.counts ? (
            <span className="text-muted-foreground">
              {facets.counts.active} active · {facets.counts.archived} archived ·{' '}
              {facets.counts.trash} in trash
            </span>
          ) : null
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => document.getElementById('gallery-files')?.focus()}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Add images
          </Button>
        }
      />

      {message && (
        <p
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {message}
        </p>
      )}

      <UploadPanel
        folders={folders}
        items={items}
        onFoldersChange={changeFolders}
        onUploaded={async () => refresh()}
        onMessage={say}
      />

      <GalleryToolbar
        filters={filters}
        onChange={setFilters}
        facets={facets}
        folders={folders}
        providerValues={providerValues}
        slotValues={slotValues}
        tagValues={tagValues}
        loading={loading}
        onRefresh={refresh}
        summary={summary}
      />

      <BulkActionsBar
        selectedItems={selectedItems}
        allItems={items}
        folders={folders}
        busy={bulkBusy}
        onClear={() => setSelectedIds(new Set())}
        onSelectAll={() => setSelectedIds(new Set(items.map((item) => item.id)))}
        onBulk={(action, extra) => runBulk(selectedItems, action, extra)}
      />

      {grid}

      {listing.total > 0 && (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
          aria-label="Gallery pages"
        >
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <label htmlFor="gallery-page-size">Per page</label>
            <select
              id="gallery-page-size"
              value={filters.limit}
              onChange={(e) => setFilters({ ...filters, limit: Number(e.target.value), offset: 0 })}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filters.offset === 0 || loading}
              onClick={() =>
                setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })
              }
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!listing.hasMore || loading}
              onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })}
            >
              Next
            </Button>
          </div>
        </nav>
      )}

      {detailsItem && (
        <ImageDetailsDialog
          item={detailsItem}
          folders={folders}
          busy={busyIds.has(detailsItem.id)}
          copied={copiedId}
          onClose={() => setDetailsId('')}
          onSave={saveDetails}
          onArchive={(it) => runBulk([it], 'archive')}
          onRestore={(it) => runBulk([it], 'restore')}
          onTrash={(it) => runBulk([it], 'trash')}
          onDelete={deleteOne}
          onReuse={reuse}
          onCopy={copyText}
          onOpenSet={(name) => navigate(`/admin/image-prompts?set=${encodeURIComponent(name)}`)}
          onOpenContent={(use) => navigate(`/admin/queue/${encodeURIComponent(use.id)}`)}
          onOpenVariant={(id) => {
            if (items.some((item) => item.id === id)) setDetailsId(id);
            else setFilters({ ...DEFAULT_FILTERS, state: 'all', q: id });
          }}
        />
      )}
    </div>
  );
}
