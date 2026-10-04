/**
 * The Image Gallery's main area (split out of ImageGalleryPage.jsx for
 * PR #841): the tiles, or the one thing to say instead of them — an error, a
 * first load, or an empty state worded for the filters and tab in force.
 */
import React from 'react';
import { Images, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/admin/shared/EmptyState';
import { emptyStateFor, hasActiveFilters } from './galleryPageModel';

/** Why there is nothing to show: filters, an empty state tab, or a bare gallery. */
export function GalleryEmpty({ filters, onClearFilters, onOpenPrompts }) {
  if (hasActiveFilters(filters)) {
    return (
      <EmptyState
        variant="filtered"
        title="Nothing matches these filters"
        description="Try a broader search, another folder or source, or clear the filters."
        action={
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  }
  if (filters.state !== 'active') return <EmptyState {...emptyStateFor(filters.state)} />;
  return (
    <EmptyState
      icon={Images}
      title="No images yet"
      description="Upload or import an image above, generate a cover from the review queue, or try an image set on Image Prompts — everything lands here."
      action={
        <Button variant="outline" size="sm" onClick={onOpenPrompts}>
          Open Image Prompts
        </Button>
      }
    />
  );
}

/**
 * @param {object} props
 * @param {(item: object) => React.ReactNode} props.renderTile one tile per item
 */
export default function GalleryGrid({
  error,
  loading,
  items,
  filters,
  onRetry,
  onClearFilters,
  onOpenPrompts,
  renderTile,
}) {
  if (error) {
    return (
      <EmptyState
        variant="error"
        title="The gallery could not be read"
        description={error}
        onRetry={onRetry}
      />
    );
  }
  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading images…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <GalleryEmpty
        filters={filters}
        onClearFilters={onClearFilters}
        onOpenPrompts={onOpenPrompts}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {items.map(renderTile)}
    </div>
  );
}
