/**
 * The podcast voice on the Audio tab: ElevenLabs's plan and credits, what the
 * last render billed, and the owner's live check (#432; ADR 0029 §2a, amended
 * 2026-09-26).
 *
 *   GET  cms/podcast/elevenlabs          plan, credits used / limit, reset
 *                                        date, the last render's billed
 *                                        characters; "not configured" is a
 *                                        200, not an error
 *   POST cms/podcast/elevenlabs/sample   a fixed two-turn sample of under 300
 *                                        characters through the real provider
 *
 * The server does the work (functions/src/lib/podcast/elevenlabs-admin.js).
 * This card reads it, and runs the check on a click, never on load, because
 * the check spends credits.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, Loader2, Mic, Play, RefreshCw } from 'lucide-react';
import { getJSON, postJSON } from '@/lib/api';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { safeUrl } from '@/lib/safeUrl';
import { relativeTime } from './settingShared';

export const ELEVENLABS_STATUS_ROUTE = 'cms/podcast/elevenlabs';
export const ELEVENLABS_SAMPLE_ROUTE = 'cms/podcast/elevenlabs/sample';

const count = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—';

const day = (iso) =>
  typeof iso === 'string' && iso.length >= 10 ? `${iso.slice(0, 10)} (UTC)` : 'not reported';

/** What wrote the last ElevenLabs usage row, as a person reads it. */
const RENDER_SOURCES = Object.freeze({
  'podcast:audio': 'an episode',
  'podcast:sample': 'a live check',
});

/**
 * The status read and the live check. Race-safe the way `useSetting` is: a
 * load only writes state while it is the newest, and a second click on the
 * check while one is running sends nothing.
 */
export function useElevenLabs(authReady) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [sample, setSample] = useState(null);
  const [running, setRunning] = useState(false);
  const generation = useRef(0);
  const runningRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!authReady) return undefined;
    const mine = ++generation.current;
    const current = () => mine === generation.current;
    getJSON(ELEVENLABS_STATUS_ROUTE)
      .then((response) => {
        if (!current()) return;
        setStatus(response ?? null);
        setError(null);
      })
      .catch((err) => {
        if (!current()) return;
        setStatus(null);
        setError(err?.message ?? 'Could not load the ElevenLabs status.');
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      if (current()) generation.current += 1;
    };
  }, [authReady, attempt]);

  const reload = useCallback(() => {
    generation.current += 1;
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const runSample = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const result = await postJSON(ELEVENLABS_SAMPLE_ROUTE, {});
      setSample(result ?? null);
      toast({
        title: 'Live check rendered',
        description: `${count(result?.charactersBilled)} characters billed; ${count(result?.creditsLeft)} credits left.`,
      });
      reload();
    } catch (err) {
      const message = err?.message ?? 'The live check failed.';
      setSample({ error: message });
      toast({ title: 'Live check not rendered', description: message, variant: 'destructive' });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [reload, toast]);

  return { status, loading, error, reload, sample, running, runSample };
}

function PlanFigures({ subscription }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Plan</dt>
      <dd>
        {subscription.tier ?? 'not reported'}
        {subscription.status ? ` (${subscription.status})` : ''}
      </dd>
      <dt className="text-muted-foreground">Credits</dt>
      <dd>
        {`${count(subscription.creditsUsed)} used of ${count(subscription.creditLimit)}, ${count(subscription.creditsLeft)} left`}
      </dd>
      <dt className="text-muted-foreground">Resets</dt>
      <dd>{day(subscription.resetAt)}</dd>
    </dl>
  );
}

function FreePlanNote() {
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span>
        Free plan: no commercial licence. Episodes voiced on it are for testing and are never
        published to RSS.com; approval refuses them. Upgrade, then regenerate, to publish.
      </span>
    </p>
  );
}

function LastRender({ lastRender, lastRenderError }) {
  if (lastRenderError) {
    return <p className="text-xs text-amber-700">Last render: {lastRenderError}</p>;
  }
  if (!lastRender) {
    return <p className="text-xs text-muted-foreground">No ElevenLabs render recorded yet.</p>;
  }
  const from = RENDER_SOURCES[lastRender.source];
  const when = relativeTime(lastRender.at);
  return (
    <p className="text-sm">
      {`Last render billed ${count(lastRender.characters)} characters`}
      {lastRender.estimated ? ' (our count; ElevenLabs sent no figure)' : ''}
      {from ? `, ${from}` : ''}
      {when ? `, ${when}` : ''}
    </p>
  );
}

function SampleResult({ sample }) {
  if (!sample) return null;
  if (sample.error) return <p className="text-sm text-destructive">{sample.error}</p>;
  const src = sample.audioUrl ? safeUrl(resolveMediaUrl(sample.audioUrl)) : undefined;
  return (
    <div className="space-y-1">
      {src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls preload="metadata" src={src} className="h-8 w-full" />
      ) : (
        <p className="text-xs text-amber-700">{sample.audioError ?? 'No audio was returned.'}</p>
      )}
      <p className="text-sm">
        {`Characters billed: ${count(sample.charactersBilled)}`}
        {sample.billedEstimated ? ' (our count)' : ''}
      </p>
      <p className="text-sm">
        {`Credits left: ${count(sample.creditsLeft)} of ${count(sample.creditLimit)}`}
      </p>
    </div>
  );
}

function LiveCheck({ characters, configured, running, onRun, sample }) {
  return (
    <div className="space-y-2 rounded-md border border-input p-3">
      <p className="text-sm font-medium">Live check</p>
      <p className="text-xs text-muted-foreground">
        Renders a fixed two-turn sample of {count(characters)} characters through the real provider,
        about {count(characters)} credits. It proves the key, both voices and the credit check
        without spending a month on an episode.
      </p>
      <Button type="button" size="sm" onClick={onRun} disabled={running || !configured}>
        {running ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="mr-2 h-3.5 w-3.5" />
        )}
        Run live check
      </Button>
      <SampleResult sample={sample} />
    </div>
  );
}

function StatusBody({ status }) {
  if (!status?.configured) {
    return (
      <div className="space-y-1">
        <Badge variant="outline">Not configured</Badge>
        <p className="text-xs text-muted-foreground">
          {status?.reason ?? 'ELEVENLABS_API_KEY is not configured.'}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {status.subscription ? <PlanFigures subscription={status.subscription} /> : null}
      {status.subscription?.freePlan ? <FreePlanNote /> : null}
      {status.subscriptionError ? (
        <p className="text-xs text-amber-700">{status.subscriptionError}</p>
      ) : null}
      <LastRender lastRender={status.lastRender} lastRenderError={status.lastRenderError} />
    </div>
  );
}

export default function ElevenLabsCard({ authReady }) {
  const eleven = useElevenLabs(authReady);
  const { status, loading, error } = eleven;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mic className="h-5 w-5" /> Podcast voice (ElevenLabs)
        </CardTitle>
        <CardDescription>
          ElevenLabs reads podcast episodes and never Listen &amp; Learn. Before a render sends
          anything it checks the credits left, and refuses a job they cannot cover in full.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the ElevenLabs account…
          </p>
        ) : null}
        {!loading && error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
          >
            <span>ElevenLabs: {error}</span>
            <Button type="button" size="sm" variant="outline" onClick={eleven.reload}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : null}
        {!loading && !error ? <StatusBody status={status} /> : null}
        <LiveCheck
          characters={status?.sample?.characters}
          configured={status?.configured === true}
          running={eleven.running}
          onRun={eleven.runSample}
          sample={eleven.sample}
        />
      </CardContent>
    </Card>
  );
}
