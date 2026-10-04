/**
 * Where an image is used and its sibling variants (ADR 0033 acceptance:
 * "from an image you can see its prompt and set"). Both load when the
 * dialog opens; this renders the loading, error, empty and listed states.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { formatDate } from './imageDetailsFields';

function UsageList({ usedBy, onOpenContent }) {
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {usedBy.map((use) => (
        <li key={`${use.id}-${use.field}`} className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="truncate text-left text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => onOpenContent(use)}
          >
            {use.title}
          </button>
          <span className="shrink-0 text-muted-foreground">
            {use.field}
            {use.status ? ` · ${use.status}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ImageDetailsUsage({ usage, usageError, usedBy, onOpenContent }) {
  const loading = !usage && !usageError;
  const empty = Boolean(usage) && usedBy.length === 0;
  return (
    <section aria-labelledby="img-usage-heading" className="rounded-lg border border-border p-3">
      <h3 id="img-usage-heading" className="text-xs font-semibold">
        Used by {usage ? `(${usedBy.length})` : ''}
      </h3>
      {usageError && <p className="mt-1 text-xs text-destructive">{usageError}</p>}
      {loading && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking content…
        </p>
      )}
      {empty && (
        <p className="mt-1 text-xs text-muted-foreground">
          No content points at this image. Deleting it removes nothing from the site.
        </p>
      )}
      {usedBy.length > 0 && <UsageList usedBy={usedBy} onOpenContent={onOpenContent} />}
    </section>
  );
}

export function ImageDetailsVariants({ variants, onOpenVariant }) {
  if (variants.length === 0) return null;
  return (
    <section aria-labelledby="img-variants-heading" className="rounded-lg border border-border p-3">
      <h3 id="img-variants-heading" className="text-xs font-semibold">
        Other versions of this slot ({variants.length})
      </h3>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {variants.map((variant) => (
          <button
            key={variant.id}
            type="button"
            className="overflow-hidden rounded border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            onClick={() => onOpenVariant(variant.id)}
            title={`${variant.title || variant.id} · ${formatDate(variant.createdAt)}`}
          >
            <img
              src={resolveMediaUrl(variant.imageUrl)}
              alt={variant.title || 'Variant'}
              className="aspect-video w-full object-cover"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
