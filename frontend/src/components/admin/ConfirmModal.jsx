import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * ConfirmModal — accessible alternative to window.confirm() for destructive actions.
 *
 * Usage:
 *   const [confirmOpen, setConfirmOpen] = useState(false);
 *   <ConfirmModal
 *     open={confirmOpen}
 *     title="Delete item?"
 *     description="This cannot be undone."
 *     confirmLabel="Delete"
 *     onConfirm={() => { setConfirmOpen(false); doDelete(); }}
 *     onCancel={() => setConfirmOpen(false)}
 *   />
 *
 * Pass `preview` to render an arbitrary node (e.g. a list of items being
 * affected) between the description and the action buttons. Use it for
 * bulk destructive actions so the user can verify scope before confirming.
 *
 * @param {{
 *   open: boolean,
 *   title: string,
 *   description?: string,
 *   preview?: React.ReactNode,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   onConfirm: () => void,
 *   onCancel: () => void,
 *   destructive?: boolean,
 * }} props
 */
export default function ConfirmModal({
  open,
  title,
  description,
  preview,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destructive = true,
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className={preview ? 'sm:max-w-xl' : 'sm:max-w-md'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {preview && <div className="mt-2">{preview}</div>}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
