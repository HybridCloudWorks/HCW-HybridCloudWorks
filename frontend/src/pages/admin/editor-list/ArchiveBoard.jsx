/**
 * The Archive board under the Editor list: pages taken down for good, behind
 * a disclosure, with their own search, provider filter and sort. The state
 * is the board's alone, so it lives here rather than on the page (PR #841).
 */
import React, { useMemo, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  ExternalLink as LinkIcon,
  Loader2,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EmptyState from '@/components/admin/shared/EmptyState';
import { toDate } from '@/lib/dateUtils';
import { safeUrl } from '@/lib/safeUrl';
import { PROVIDER_OPTIONS as ADMIN_PROVIDER_OPTIONS } from '@/config/admin';
import {
  TYPE_BADGE,
  filterAndSortArchivedItems,
  getContentType,
  getProviderDisplay,
  getPublicUrl,
} from './editorItems';

// Every provider the site routes, from the registry (config/admin.js), so the
// filter cannot fall behind it again: VMware and Ansible were missing here.
// Matched by substring of the stored value, so the label's lower case works.
const PROVIDER_OPTIONS = ['All', ...ADMIN_PROVIDER_OPTIONS.map((option) => option.label)];

const SORT_OPTIONS = [
  { value: 'archivedAt', label: 'Archived Date' },
  { value: 'publishedAt', label: 'Published Date' },
  { value: 'provider', label: 'Technology' },
];

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
          href={safeUrl(publicUrl)}
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

/** The chevron beside the active sort, pointing the way it sorts. */
function SortChevron({ active, dir }) {
  if (!active) return null;
  return dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
}

/** Search, provider filter and the sort buttons above the rows. */
function ArchiveControls({
  search,
  onSearch,
  providerFilter,
  onProviderFilter,
  sortField,
  sortDir,
  onToggleSort,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-45">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search archive…"
          className="pl-9 h-8 text-sm"
        />
      </div>
      <div className="flex gap-1 flex-wrap">
        {PROVIDER_OPTIONS.map((p) => (
          <button
            key={p}
            onClick={() => onProviderFilter(p)}
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              providerFilter === p
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
            onClick={() => onToggleSort(opt.value)}
            className={`flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              sortField === opt.value
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
            <SortChevron active={sortField === opt.value} dir={sortDir} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The rows, the spinner while they load, or the empty state. */
function ArchiveContent({ loading, items, filtered }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        variant={filtered ? 'filtered' : 'empty'}
        title={filtered ? 'No archived items match your filters.' : 'No archived content yet.'}
        description="Archive a live item from its row above and it is listed here."
      />
    );
  }
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <ArchiveRow key={item.id} item={item} />
      ))}
    </div>
  );
}

export default function ArchiveBoard({ archivedList, loading }) {
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveProviderFilter, setArchiveProviderFilter] = useState('All');
  const [archiveSortField, setArchiveSortField] = useState('archivedAt');
  const [archiveSortDir, setArchiveSortDir] = useState('desc');
  const [showArchive, setShowArchive] = useState(false);

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

  function toggleSort(field) {
    if (archiveSortField === field) {
      setArchiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setArchiveSortField(field);
      setArchiveSortDir('desc');
    }
  }

  const filtered = Boolean(archiveSearch) || archiveProviderFilter !== 'All';

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
            <ArchiveControls
              search={archiveSearch}
              onSearch={setArchiveSearch}
              providerFilter={archiveProviderFilter}
              onProviderFilter={setArchiveProviderFilter}
              sortField={archiveSortField}
              sortDir={archiveSortDir}
              onToggleSort={toggleSort}
            />

            <ArchiveContent loading={loading} items={filteredArchive} filtered={filtered} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}
