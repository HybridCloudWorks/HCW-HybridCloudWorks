/**
 * The left column of ImageDetailsDialog (ADR 0033): the picture and the
 * actions on it — copy its URL or a Markdown embed, open the file, use it in
 * new content.
 */
import React from 'react';
import { Copy, ExternalLink, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { safeUrl } from '@/lib/safeUrl';

export default function ImageDetailsPreview({
  item,
  state,
  resolved,
  altText,
  copied,
  onCopy,
  onReuse,
}) {
  const urlKey = `url-${item.id}`;
  const markdownKey = `md-${item.id}`;
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
        {item.imageUrl ? (
          <img
            src={resolved}
            alt={item.altText || item.title}
            className="max-h-[420px] w-full object-contain"
          />
        ) : (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No file recorded
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => onCopy(item.imageUrl, urlKey)}
          disabled={!item.imageUrl}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />{' '}
          {copied === urlKey ? 'Copied' : 'Copy URL'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => onCopy(`![${altText || item.title}](${item.imageUrl})`, markdownKey)}
          disabled={!item.imageUrl}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />{' '}
          {copied === markdownKey ? 'Copied' : 'Copy Markdown'}
        </Button>
        {item.imageUrl && (
          <Button asChild type="button" size="sm" variant="outline" className="gap-1">
            <a href={safeUrl(resolved)} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open file
            </a>
          </Button>
        )}
        {!state && (
          <Button
            type="button"
            size="sm"
            className="gap-1"
            onClick={() => onReuse(item)}
            disabled={!item.imageUrl}
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Use in new content
          </Button>
        )}
      </div>
    </>
  );
}
