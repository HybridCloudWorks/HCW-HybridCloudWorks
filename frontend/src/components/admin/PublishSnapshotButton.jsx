import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { postJSON } from '@/lib/api';

/**
 * Triggers the publishSnapshot Azure Function, which snapshots both the
 * certifications and speakerevents content containers into _snapshots/
 * documents. The About page and speaking-events widget render the newer of
 * those documents and the JSON baked into the last deploy, so visitors see
 * new content without a full site redeploy (ADR 0033, Spotlight slice).
 *
 * `onPublished(result)` is called after a publish lands, so a page showing
 * the snapshot (the two Publishing tabs) can re-read it.
 *
 * Race-safety: the in-flight guard is a ref checked before any await — the
 * disabled attribute only takes effect after the re-render the first click
 * causes, so a fast double click used to send two publishes. The "Published"
 * flash is a timer that is cleared on unmount, so it never sets state on a
 * component that has gone.
 */
export default function PublishSnapshotButton({ onPublished } = {}) {
  const { toast } = useToast();
  const [state, setState] = useState('idle'); // idle | publishing | done
  const inFlight = useRef(false);
  const resetTimer = useRef(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  const handlePublish = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState('publishing');
    try {
      const result = await postJSON('publishSnapshot', {});
      setState('done');
      toast({
        title: 'Snapshot published',
        description: `Certifications: ${result.certifications} · Events: ${result.speakerevents}`,
      });
      onPublished?.(result);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        setState('idle');
      }, 3000);
    } catch (err) {
      setState('idle');
      toast({ title: 'Publish failed', description: err.message, variant: 'destructive' });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handlePublish}
      disabled={state !== 'idle'}
      className={
        state === 'done'
          ? 'border-emerald-400 text-emerald-600 dark:border-emerald-600 dark:text-emerald-400'
          : ''
      }
    >
      {state === 'publishing' && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
      {state === 'done' && <Check className="h-4 w-4 mr-1.5" />}
      {state === 'idle' && <UploadCloud className="h-4 w-4 mr-1.5" />}
      {state === 'publishing' && 'Publishing…'}
      {state === 'done' && 'Published'}
      {state === 'idle' && 'Publish snapshot'}
    </Button>
  );
}
