/**
 * The Image Gallery's two one-liners (split out of ImageGalleryPage.jsx for
 * PR #841): the state counts in the page header, and the status sentence the
 * last action left.
 */
import React from 'react';

/** `12 active · 3 archived · 1 in trash`, or nothing until the facets arrive. */
export function GalleryCounts({ counts }) {
  if (!counts) return null;
  return (
    <span className="text-muted-foreground">
      {counts.active} active · {counts.archived} archived · {counts.trash} in trash
    </span>
  );
}

/** The last action's sentence, announced as a status; nothing when there is none. */
export function GalleryMessage({ text }) {
  if (!text) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      {text}
    </p>
  );
}
