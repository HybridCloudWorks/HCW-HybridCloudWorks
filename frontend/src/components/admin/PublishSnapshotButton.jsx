import React, { useState } from 'react';
import { UploadCloud, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { postJSON } from '@/lib/api';

/**
 * Triggers the publishSnapshot Azure Function, which snapshots both the
 * certifications and speakerevents content containers into _snapshots/
 * documents. The About page and speaking-events widget read from those
 * documents, so visitors see new content without a full site redeploy.
 */
export default function PublishSnapshotButton() {
  const { toast } = useToast();
  const [state, setState] = useState('idle'); // idle | publishing | done

  const handlePublish = async () => {
    setState('publishing');
    try {
      const result = await postJSON('publishSnapshot', {});
      setState('done');
      toast({
        title: 'Snapshot published',
        description: `Certifications: ${result.certifications} · Events: ${result.speakerevents}`,
      });
      setTimeout(() => setState('idle'), 3000);
    } catch (err) {
      setState('idle');
      toast({ title: 'Publish failed', description: err.message, variant: 'destructive' });
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
