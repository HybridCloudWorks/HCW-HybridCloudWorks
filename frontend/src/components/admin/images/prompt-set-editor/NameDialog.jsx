/**
 * A dialog that asks for a set name (ADR 0033): rename and duplicate both
 * use it. The field resets to `initial` each time the dialog opens.
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function NameDialog({
  open,
  title,
  description,
  confirmLabel,
  initial,
  onConfirm,
  onCancel,
  busy,
}) {
  const [value, setValue] = useState(initial || '');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(initial || '');
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <label htmlFor="set-name-input" className="text-xs font-medium">
          Set name
        </label>
        <Input
          id="set-name-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={120}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && onConfirm(value.trim())}
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(value.trim())} disabled={busy || !value.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
