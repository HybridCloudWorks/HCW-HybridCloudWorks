/**
 * "Refresh now" on the Cloud pricing cache card (#613, Phase 1).
 *
 * The one card whose service is a cache the site itself fills rather than a
 * credential someone else issued, so beside the beaker — which only reads —
 * it needs the button that writes. It enqueues the `refresh-tool-pricing`
 * platform job through the generic `enqueueJob` route, exactly as the Labs
 * console and Listen & Learn enqueue theirs (lib/jobs.js), waits for the
 * terminal state, and then asks the card to run its test again so the
 * refreshed-at line on the card is the refreshed cache and not the old one.
 *
 * Race-safety as SessionizeSetting's Save: an in-flight ref, so a double
 * click sends one job; and a generation guard on the poll, so a result
 * arriving after unmount sets nothing.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { runJob } from '@/lib/jobs';

export const CLOUD_PRICING_JOB_TYPE = 'refresh-tool-pricing';

/**
 * The refresh worker takes no arguments: it walks every region and service
 * the server catalogue declares. An empty payload is what `enqueueJob` sends
 * when a type has nothing to say, so the body is `{ type, payload: {} }`.
 */
export const CLOUD_PRICING_JOB_PAYLOAD = Object.freeze({});

export default function CloudPricingRefresh({ onRefreshed }) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setStatus('Queued…');
    try {
      const job = await runJob(CLOUD_PRICING_JOB_TYPE, CLOUD_PRICING_JOB_PAYLOAD, {
        onUpdate: (update) => {
          if (mounted.current) setStatus(update.status === 'running' ? 'Refreshing…' : 'Queued…');
        },
      });
      if (!mounted.current) return;
      if (job.status === 'succeeded') {
        toast({ title: 'Prices refreshed', description: 'The pricing cache was rebuilt.' });
        onRefreshed?.(job);
      } else {
        toast({
          title: 'Refresh failed',
          description: job.error || `The job ended ${job.status}.`,
          variant: 'destructive',
        });
      }
    } catch (err) {
      if (mounted.current) {
        toast({
          title: 'Refresh failed',
          description: err?.message ?? 'The job could not be queued.',
          variant: 'destructive',
        });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setRunning(false);
        setStatus('');
      }
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={running}
        className="shrink-0 gap-1.5"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {running ? status || 'Refreshing…' : 'Refresh now'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Rebuilds the cache for every region from the three providers&rsquo; price lists. The public
        page reads the new prices within fifteen minutes; the test above reads them at once.
      </p>
    </div>
  );
}
