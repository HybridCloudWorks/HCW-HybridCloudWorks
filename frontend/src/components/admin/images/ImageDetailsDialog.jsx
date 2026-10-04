/**
 * The details view for one image (ADR 0033 acceptance: "from an image you
 * can see its prompt and set"). Preview on the left; on the right the
 * editable metadata, the facts (source, model, size, dates, owner), the
 * prompt and a link to its set on Image Prompts, where the image is used,
 * and its sibling variants. Usage and variants load when the dialog opens.
 *
 * This file composes the sections in ./imageDetails; the state lives in
 * useImageDetails and the field tables in imageDetailsFields.
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import ConfirmModal from '@/components/admin/ConfirmModal';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { getSourceLabel } from '@/lib/imageGallery';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { tileState } from './GalleryTile';
import {
  deleteDescription,
  fieldsToPatch,
  lineageSentence,
} from './imageDetails/imageDetailsFields';
import { useImageDetails } from './imageDetails/useImageDetails';
import ImageDetailsPreview from './imageDetails/ImageDetailsPreview';
import ImageDetailsFacts from './imageDetails/ImageDetailsFacts';
import { ImageDetailsActions, ImageDetailsFields } from './imageDetails/ImageDetailsForm';
import { ImageDetailsUsage, ImageDetailsVariants } from './imageDetails/ImageDetailsUsage';

function DialogHeading({ item, state }) {
  return (
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
  );
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
  const details = useImageDetails(item);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!item) return null;
  const state = tileState(item);
  const resolved = resolveMediaUrl(item.imageUrl);
  const { fields, usedBy, variants } = details;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeading item={item} state={state} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <ImageDetailsPreview
              item={item}
              state={state}
              resolved={resolved}
              altText={fields.altText}
              copied={copied}
              onCopy={onCopy}
              onReuse={onReuse}
            />
            <ImageDetailsFacts
              item={item}
              onOpenSet={onOpenSet}
              showPrompt={details.showPrompt}
              onTogglePrompt={details.togglePrompt}
            />
          </div>

          <div className="space-y-4">
            <ImageDetailsFields fields={fields} setField={details.setField} folders={folders} />
            <ImageDetailsActions
              state={state}
              busy={busy}
              onSave={() => onSave(item, fieldsToPatch(fields))}
              onRestore={() => onRestore(item)}
              onArchive={() => onArchive(item)}
              onTrash={() => onTrash(item)}
              onDeleteRequest={() => setConfirmDelete(true)}
            />
            <ImageDetailsUsage
              usage={details.usage}
              usageError={details.usageError}
              usedBy={usedBy}
              onOpenContent={onOpenContent}
            />
            <ImageDetailsVariants variants={variants} onOpenVariant={onOpenVariant} />
          </div>
        </div>

        <ConfirmModal
          open={confirmDelete}
          title="Delete this image permanently?"
          description={deleteDescription(usedBy.length)}
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
