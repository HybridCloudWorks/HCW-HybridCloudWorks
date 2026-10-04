/**
 * The Image Gallery's paging strip (split out of ImageGalleryPage.jsx for
 * PR #841): page N of M, the per-page size, Previous and Next. Renders nothing
 * while the listing is empty.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { PAGE_SIZES, pagePosition } from './galleryPageModel';

export default function GalleryPager({ filters, onChange, total, hasMore, loading, count }) {
  if (total <= 0) return null;
  const { page, pageCount } = pagePosition(filters, total, count);
  return (
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
          onChange={(e) => onChange({ ...filters, limit: Number(e.target.value), offset: 0 })}
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
            onChange({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })
          }
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasMore || loading}
          onClick={() => onChange({ ...filters, offset: filters.offset + filters.limit })}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
