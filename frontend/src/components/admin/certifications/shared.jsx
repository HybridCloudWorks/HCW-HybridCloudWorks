/**
 * Pieces more than one Certifications Hub tab renders: the intro line, the
 * certification list's loading/error notice, and the delete confirmation.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { TabError, TabLoading } from '@/components/admin/integrations/TabNotice';

export function TabIntro({ children }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * The certification list's loading line or its error, or null once it has
 * landed. Each tab that shows the list renders this in place of its content,
 * so a refused read is said where the certifications would have been — and
 * Publishing, which reads its own snapshot, carries on.
 */
export function CertListNotice({ certs }) {
  if (certs.loading) return <TabLoading>Reading certifications…</TabLoading>;
  if (certs.error) {
    return (
      <TabError
        message={`Failed to read certification data: ${certs.error}`}
        onRetry={certs.refresh}
      />
    );
  }
  return null;
}

export function DeleteCertDialog({ cert, busy, onCancel, onConfirm }) {
  if (!cert) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-sm" role="alertdialog" aria-label="Delete this certification?">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
            <p className="font-semibold">Delete this certification?</p>
          </div>
          <p className="text-xs text-slate-500">
            <strong>{cert.name}</strong> will be permanently removed. The About page snapshot
            updates on next build.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => onConfirm(cert)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
