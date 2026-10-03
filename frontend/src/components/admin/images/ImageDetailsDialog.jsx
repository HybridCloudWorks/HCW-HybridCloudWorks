/**
 * The details view for one image (ADR 0033 acceptance: "from an image you
 * can see its prompt and set"). Preview on the left; on the right the
 * editable metadata, the facts (source, model, size, dates, owner), the
 * prompt and a link to its set on Image Prompts, where the image is used,
 * and its sibling variants. Usage and variants load when the dialog opens.
 */
import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ConfirmModal from '@/components/admin/ConfirmModal';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import {
  COMMON_PROVIDERS,
  fetchImageUsage,
  formatBytes,
  formatDimensions,
  getSourceLabel,
  LICENSE_OPTIONS,
  SLOT_OPTIONS,
} from '@/lib/imageGallery';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { safeUrl } from '@/lib/safeUrl';
import { tileState } from './GalleryTile';

const selectClass =
  'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function Fact({ label, children }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1 text-xs last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

/** One sentence on where the image came from. */
function lineageSentence(item) {
  if (item.promptSet) {
    const prompt = item.promptName ? ` (${item.promptName})` : '';
    return `Generated from the "${item.promptSet}" image set${prompt}.`;
  }
  if (item.source === 'upload') return 'Uploaded by hand; no prompt lineage.';
  if (item.source === 'import') return `Imported from ${item.sourceUrl || 'a URL'}.`;
  return 'Generated without an image set; the built-in prompt applied.';
}

function fieldsFrom(item) {
  return {
    title: item?.title || '',
    altText: item?.altText || '',
    caption: item?.caption || '',
    license: item?.license || '',
    credit: item?.credit || '',
    tags: (item?.customTags || []).join(', '),
    folder: item?.folder || 'default',
    provider: String(item?.provider || '').toLowerCase(),
    slot: item?.slot || '',
  };
}

export default function ImageDetailsDialog({
  item,
  folders,
  onClose,
  onSave,
  onArchive,
  onRestore,
  onTrash,
  onDelete,
  onReuse,
  onCopy,
  onOpenSet,
  onOpenContent,
  onOpenVariant,
  copied,
  busy,
}) {
  const [fields, setFields] = useState(() => fieldsFrom(item));
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [itemId, setItemId] = useState(item?.id);
  if (item?.id !== itemId) {
    // A different image opened in the same dialog: reset the form to it.
    setItemId(item?.id);
    setFields(fieldsFrom(item));
    setUsage(null);
    setUsageError('');
  }

  useEffect(() => {
    if (!item?.id) return undefined;
    let cancelled = false;
    fetchImageUsage(item)
      .then((res) => {
        if (!cancelled) setUsage(res);
      })
      .catch((err) => {
        if (!cancelled) setUsageError(err?.message || 'Could not read where this image is used.');
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) return null;
  const state = tileState(item);
  const resolved = resolveMediaUrl(item.imageUrl);
  const dims = formatDimensions(item);
  const usedBy = usage?.usedBy ?? item.usedBy ?? [];
  const variants = usage?.variants ?? [];
  const set = (key) => (e) => setFields((prev) => ({ ...prev, [key]: e.target.value }));
  const save = () =>
    onSave(item, {
      title: fields.title,
      altText: fields.altText,
      caption: fields.caption,
      license: fields.license,
      credit: fields.credit,
      customTags: fields.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      folder: fields.folder,
      provider: fields.provider,
      slot: fields.slot,
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {item.title}
            <Badge variant="outline">{getSourceLabel(item.source)}</Badge>
            {state && <StatusBadge status={state} size="xs" />}
            {item.duplicateOf && (
              <Badge variant="secondary" title={`Duplicate of ${item.duplicateOf}`}>
                Duplicate
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{lineageSentence(item)}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
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
                onClick={() => onCopy(item.imageUrl, `url-${item.id}`)}
                disabled={!item.imageUrl}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                {copied === `url-${item.id}` ? 'Copied' : 'Copy URL'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  onCopy(`![${fields.altText || item.title}](${item.imageUrl})`, `md-${item.id}`)
                }
                disabled={!item.imageUrl}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                {copied === `md-${item.id}` ? 'Copied' : 'Copy Markdown'}
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

            <dl className="rounded-lg border border-border p-3">
              <Fact label="Source">{getSourceLabel(item.source)}</Fact>
              {(item.imageProvider || item.imageModel) && (
                <Fact label="Generated by">
                  {[item.imageProvider, item.imageModel].filter(Boolean).join(' · ')}
                </Fact>
              )}
              {item.promptSet && (
                <Fact label="Image set">
                  <button
                    type="button"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                    onClick={() => onOpenSet(item.promptSet)}
                  >
                    {item.promptSet}
                  </button>
                  {item.promptName ? ` / ${item.promptName}` : ''}
                  {item.promptTemplateVersion ? ` (${item.promptTemplateVersion})` : ''}
                </Fact>
              )}
              {dims && <Fact label="Dimensions">{dims}</Fact>}
              {item.format && <Fact label="Format">{item.format.toUpperCase()}</Fact>}
              {item.bytes ? <Fact label="Size">{formatBytes(item.bytes)}</Fact> : null}
              <Fact label="Created">{formatDate(item.createdAt)}</Fact>
              {item.createdBy && <Fact label="Owner">{item.createdBy}</Fact>}
              {item.archivedAt && <Fact label="Archived">{formatDate(item.archivedAt)}</Fact>}
              {item.softDeletedAt && <Fact label="Trashed">{formatDate(item.softDeletedAt)}</Fact>}
              {item.sourceUrl && (
                <Fact label="Imported from">
                  <a
                    href={safeUrl(item.sourceUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {item.sourceUrl}
                  </a>
                </Fact>
              )}
              <Fact label="Record">
                <code className="text-[10px]">
                  {item.galleryCollection}/{item.id}
                </code>
              </Fact>
            </dl>

            {item.prompt && (
              <div className="rounded-lg border border-border p-3">
                <button
                  type="button"
                  className="text-xs font-medium hover:underline"
                  onClick={() => setShowPrompt(!showPrompt)}
                  aria-expanded={showPrompt}
                >
                  {showPrompt ? 'Hide' : 'Show'} the prompt that produced this image
                </button>
                {showPrompt && (
                  <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">
                    {item.prompt}
                  </pre>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="img-title" className="text-xs font-medium">
                  Title
                </label>
                <Input id="img-title" value={fields.title} onChange={set('title')} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="img-alt" className="text-xs font-medium">
                  Alt text
                </label>
                <Input
                  id="img-alt"
                  value={fields.altText}
                  onChange={set('altText')}
                  placeholder="What the image shows, for readers who cannot see it"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="img-caption" className="text-xs font-medium">
                  Caption
                </label>
                <Textarea
                  id="img-caption"
                  value={fields.caption}
                  onChange={set('caption')}
                  rows={2}
                />
              </div>
              <div>
                <label htmlFor="img-license" className="text-xs font-medium">
                  Licence
                </label>
                <select
                  id="img-license"
                  value={fields.license}
                  onChange={set('license')}
                  className={selectClass}
                >
                  {LICENSE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="img-credit" className="text-xs font-medium">
                  Credit
                </label>
                <Input
                  id="img-credit"
                  value={fields.credit}
                  onChange={set('credit')}
                  placeholder="Photographer, source or model"
                />
              </div>
              <div>
                <label htmlFor="img-folder" className="text-xs font-medium">
                  Folder
                </label>
                <select
                  id="img-folder"
                  value={fields.folder}
                  onChange={set('folder')}
                  className={selectClass}
                >
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="img-provider" className="text-xs font-medium">
                  Provider
                </label>
                <select
                  id="img-provider"
                  value={fields.provider}
                  onChange={set('provider')}
                  className={selectClass}
                >
                  {COMMON_PROVIDERS.map((o) => (
                    <option key={o.value || 'none'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  {fields.provider &&
                    !COMMON_PROVIDERS.some((o) => o.value === fields.provider) && (
                      <option value={fields.provider}>{fields.provider}</option>
                    )}
                </select>
              </div>
              <div>
                <label htmlFor="img-slot" className="text-xs font-medium">
                  Slot
                </label>
                <select
                  id="img-slot"
                  value={fields.slot}
                  onChange={set('slot')}
                  className={selectClass}
                >
                  {SLOT_OPTIONS.map((o) => (
                    <option key={o.value || 'none'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="img-tags" className="text-xs font-medium">
                  Tags (comma-separated)
                </label>
                <Input
                  id="img-tags"
                  value={fields.tags}
                  onChange={set('tags')}
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={save} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}{' '}
                Save changes
              </Button>
              {state ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onRestore(item)}
                  disabled={busy}
                >
                  Restore
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onArchive(item)}
                    disabled={busy}
                  >
                    Archive
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onTrash(item)}
                    disabled={busy}
                  >
                    Move to trash
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete permanently
              </Button>
            </div>

            <section
              aria-labelledby="img-usage-heading"
              className="rounded-lg border border-border p-3"
            >
              <h3 id="img-usage-heading" className="text-xs font-semibold">
                Used by {usage ? `(${usedBy.length})` : ''}
              </h3>
              {usageError && <p className="mt-1 text-xs text-destructive">{usageError}</p>}
              {!usage && !usageError && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking content…
                </p>
              )}
              {usage && usedBy.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No content points at this image. Deleting it removes nothing from the site.
                </p>
              )}
              {usedBy.length > 0 && (
                <ul className="mt-1 space-y-1 text-xs">
                  {usedBy.map((use) => (
                    <li
                      key={`${use.id}-${use.field}`}
                      className="flex items-center justify-between gap-2"
                    >
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
              )}
            </section>

            {variants.length > 0 && (
              <section
                aria-labelledby="img-variants-heading"
                className="rounded-lg border border-border p-3"
              >
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
            )}
          </div>
        </div>

        <ConfirmModal
          open={confirmDelete}
          title="Delete this image permanently?"
          description={
            usedBy.length > 0
              ? `${usedBy.length} content item${usedBy.length === 1 ? '' : 's'} point at this image and will lose it. The file is removed unless another record shares it. This cannot be undone.`
              : 'The record and its file are removed. This cannot be undone.'
          }
          confirmLabel="Delete permanently"
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(item);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
