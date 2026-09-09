/**
 * Recording Hub → Podcast tab (#442): the transcripts the podcast pipeline
 * produced, beside the show's episodes.
 *
 * Transcripts come from `GET cms/podcast/transcripts` (a listing with no
 * bodies) and open one at a time through `GET cms/podcast/transcripts/{id}`,
 * which is the review view: the dialogue beside its source — an article's
 * title, slug and key takeaways, or a recording's id, title and the
 * generator's `attributionLeaks`, shown as a review warning because a
 * transcript label the finished dialogue repeated is exactly what #434's
 * attribution rule forbids and exactly what a reviewer fixes by hand.
 *
 * Approve / return-to-draft go through `POST cms/podcast/transcripts/review`,
 * which is publisher-gated: an editor sees the button and the API's 403.
 *
 * The Host line reads `doc.host.rsscom` (#437): `pending` means approval
 * queued the publish job and it has not written its outcome yet ("publishing…");
 * `episodeId` means the episode is on RSS.com; `error` shows the host's
 * message with a Retry that POSTs `cms/podcast/transcripts/{id}/publish`;
 * `skipped` shows its reason. Approval answers 202 with a job id while a
 * publish is in flight and 200 otherwise; `postJSON` returns the body for
 * either, and the toast says which. Retry keeps a guard for a 404 on the
 * publish route — a deployment that predates #437 slice 2 — and says so in a
 * plain toast rather than reporting a failure.
 *
 * Episodes below the transcripts are `GET public/podcasts?provider=main` —
 * the show under the reserved `main` provider (ADR 0029 §1a) — read-only.
 * Season and per-episode metadata editing is out of scope here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  FileText,
  Loader2,
  Mic,
  RefreshCw,
  Undo2,
} from 'lucide-react';
import { getJSON, postJSON } from '@/lib/api';
import { safeUrl } from '@/lib/safeUrl';

export function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Where a transcript came from, as a chip and a link when there is one. */
export function SourceChip({ item }) {
  if (item.sourceKind === 'article') {
    const publicPath =
      item.sourceProvider && item.sourceSlug
        ? `/${item.sourceProvider}/blog/${item.sourceSlug}`
        : null;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <Badge variant="secondary">article</Badge>
        {item.sourceId && (
          <Link to={`/admin/editor?id=${encodeURIComponent(item.sourceId)}`} className="underline">
            {item.sourceTitle || item.sourceSlug || item.sourceId}
          </Link>
        )}
        {publicPath && (
          <a
            href={publicPath}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-slate-500 hover:underline"
            aria-label={`Open ${item.sourceTitle || item.sourceSlug} on the site`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Badge variant="secondary">{item.sourceKind || 'recording'}</Badge>
      <span className="text-slate-600 dark:text-slate-300">
        {item.sourceTitle || item.sourceId || 'Untitled recording'}
      </span>
    </span>
  );
}

function StatusBadge({ status }) {
  if (status === 'published') return <Badge>published</Badge>;
  if (status === 'failed') return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="outline">{status || 'draft'}</Badge>;
}

/**
 * The `host.rsscom` record as one line. Rendered only when the record exists,
 * so a transcript nothing has tried to publish shows no host line at all.
 */
export function HostLine({ item, onRetry, retrying }) {
  const host = item.host?.rsscom;
  if (!host || typeof host !== 'object') return null;
  if (host.pending) {
    // Approval queued the publish-podcast-transcript job (#437 slice 2);
    // the record says so until the job writes its outcome.
    return (
      <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Host: publishing…
        {host.jobId ? ` (job ${host.jobId})` : ''}
      </p>
    );
  }
  if (host.episodeId) {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
        <CheckCircle className="h-3 w-3" /> Host: Published to RSS.com
        {host.publishedAt ? ` (${fmtDate(host.publishedAt)})` : ''}
      </p>
    );
  }
  if (host.error) {
    const message =
      typeof host.error === 'string' ? host.error : host.error.message || 'publish failed';
    return (
      <p className="text-xs text-red-700 dark:text-red-300 flex items-center gap-2 flex-wrap">
        <span>Host: {message}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs px-2"
          onClick={() => onRetry(item)}
          disabled={retrying}
        >
          {retrying ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Retry
        </Button>
      </p>
    );
  }
  if (host.skipped) {
    return <p className="text-xs text-slate-500">Host: skipped — {describeSkip(host)}</p>;
  }
  return null;
}

/**
 * Readable fallbacks for the skip codes `publish-transcript.js` records
 * (`HOST_SKIP`), used only when the record carries no `reason` sentence.
 */
const SKIP_PHRASES = Object.freeze({
  not_configured:
    'RSS.com is not configured (RSSCOM_API_KEY / RSSCOM_PODCAST_ID are not seeded), so nothing was sent',
  no_audio: 'the transcript has no audio, so nothing was sent to RSS.com',
  not_published: 'the transcript was returned to draft before the publish ran',
});

/**
 * The sentence for a skipped host publish. The backend stores the code in
 * `skipped` and the human sentence beside it in `reason`; the sentence is
 * what a reviewer needs, the code is the fallback of last resort.
 */
export function describeSkip(host) {
  if (!host || typeof host !== 'object') return '';
  const reason = typeof host.reason === 'string' ? host.reason.trim() : '';
  if (reason) return reason;
  const code = typeof host.skipped === 'string' ? host.skipped : host.skipped?.reason;
  return SKIP_PHRASES[code] || String(code || 'skipped');
}

function TranscriptRow({ item, onOpen, onReview, onRetry, busy }) {
  const audio = safeUrl(item.audioUrl);
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-violet-100 dark:bg-violet-900/40 p-2 mt-0.5 shrink-0">
            <Mic className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-semibold text-sm truncate">{item.title || item.id}</p>
            <div className="flex flex-wrap items-center gap-2">
              <SourceChip item={item} />
              <StatusBadge status={item.status} />
              {item.truncated && (
                <Badge variant="outline" className="border-amber-400 text-amber-700">
                  truncated
                </Badge>
              )}
              {item.audioError && (
                <Badge variant="destructive" title={item.audioError}>
                  audio failed
                </Badge>
              )}
              <span className="text-xs text-slate-500">{fmtDate(item.generatedAt)}</span>
            </div>
            {item.audioError && (
              <p className="text-xs text-red-700 dark:text-red-300">{item.audioError}</p>
            )}
            {item.error && item.status === 'failed' && (
              <p className="text-xs text-red-700 dark:text-red-300">{item.error}</p>
            )}
            <HostLine item={item} onRetry={onRetry} retrying={busy === `retry:${item.id}`} />
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2"
              onClick={() => onOpen(item.id)}
            >
              <FileText className="h-3 w-3 mr-1" /> Review
            </Button>
            {item.status === 'published' ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={() => onReview(item, 'draft')}
                disabled={busy === `review:${item.id}`}
              >
                <Undo2 className="h-3 w-3 mr-1" /> Return to draft
              </Button>
            ) : (
              item.status !== 'failed' && (
                <Button
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => onReview(item, 'published')}
                  disabled={busy === `review:${item.id}`}
                >
                  <CheckCircle className="h-3 w-3 mr-1" /> Approve
                </Button>
              )
            )}
          </div>
        </div>
        {audio && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio
            controls
            preload="none"
            src={audio}
            className="w-full h-8"
            aria-label={`Audio: ${item.title || item.id}`}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** The review view: the dialogue beside its source. */
export function TranscriptDetail({ item, onBack }) {
  const isArticle = item.sourceKind === 'article';
  const leaks = Array.isArray(item.attributionLeaks) ? item.attributionLeaks : [];
  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onBack}>
        <ArrowLeft className="h-3 w-3 mr-1" /> Back to transcripts
      </Button>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-base">{item.title}</h3>
              {item.summary && (
                <p className="text-sm text-slate-600 dark:text-slate-300">{item.summary}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={item.status} />
              {item.truncated && (
                <Badge variant="outline" className="border-amber-400 text-amber-700">
                  truncated
                </Badge>
              )}
              <span className="text-xs text-slate-500">{fmtDate(item.generatedAt)}</span>
            </div>
            {safeUrl(item.audioUrl) && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio
                controls
                preload="metadata"
                src={safeUrl(item.audioUrl)}
                className="w-full h-8"
              />
            )}
            {item.audioError && (
              <p className="text-xs text-red-700 dark:text-red-300">Audio: {item.audioError}</p>
            )}
            <ol className="space-y-2 text-sm" aria-label="Transcript">
              {(item.transcript || []).map((turn, i) => (
                <li key={i} className="grid grid-cols-[6rem_1fr] gap-2">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    {turn.speaker}
                  </span>
                  <span>{turn.text}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-3 text-sm">
            <h4 className="font-semibold">Source</h4>
            <SourceChip item={item} />
            {isArticle ? (
              <>
                <p>
                  <span className="text-slate-500">Title:</span> {item.sourceTitle || '—'}
                </p>
                <p>
                  <span className="text-slate-500">Slug:</span>{' '}
                  <code className="text-xs">{item.sourceSlug || '—'}</code>
                </p>
                {Array.isArray(item.keyTakeaways) && item.keyTakeaways.length > 0 && (
                  <div>
                    <p className="text-slate-500">Key takeaways</p>
                    <ul className="list-disc pl-5 space-y-1">
                      {item.keyTakeaways.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                <p>
                  <span className="text-slate-500">Recording id:</span>{' '}
                  <code className="text-xs">{item.sourceId || '—'}</code>
                </p>
                <p>
                  <span className="text-slate-500">Title:</span> {item.sourceTitle || '—'}
                </p>
                {item.source?.durationMs > 0 && (
                  <p>
                    <span className="text-slate-500">Duration:</span>{' '}
                    {Math.round(item.source.durationMs / 60000)} min
                    {Number.isFinite(item.source.segmentsIncluded) &&
                    Number.isFinite(item.source.segmentCount)
                      ? ` · ${item.source.segmentsIncluded}/${item.source.segmentCount} segments used`
                      : ''}
                  </p>
                )}
                {leaks.length > 0 ? (
                  <div
                    role="alert"
                    className="p-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs space-y-1"
                  >
                    <p className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Attribution check
                    </p>
                    <p>
                      The dialogue repeats {leaks.length} speaker label
                      {leaks.length === 1 ? '' : 's'} from the transcript verbatim. The episode is a
                      retelling and must not name or quote anyone who was in the room; fix the lines
                      before approving.
                    </p>
                    <ul className="list-disc pl-5">
                      {leaks.map((l, i) => (
                        <li key={i}>
                          <code>{typeof l === 'string' ? l : JSON.stringify(l)}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    Attribution check: no transcript speaker label appears in the dialogue.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EpisodeList({ episodes, feedUrl, loading }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-sm">Show episodes</h3>
        {feedUrl && (
          <a
            href={feedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1"
          >
            RSS feed <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <p className="text-xs text-slate-500">
        What the feed already carries, read from the ingested show. Season and episode metadata are
        edited on the host, not here.
      </p>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      {!loading && episodes.length === 0 && (
        <p className="text-xs text-slate-400">No episodes ingested for the show yet.</p>
      )}
      {episodes.length > 0 && (
        <ul className="divide-y border rounded-md text-sm">
          {episodes.map((ep) => (
            <li key={ep.id || ep.guid || ep.title} className="px-3 py-2 flex items-center gap-3">
              <span className="flex-1 min-w-0 truncate">{ep.title}</span>
              <span className="text-xs text-slate-500 shrink-0">
                {fmtDate(ep.publishedAt || ep.pubDate || ep.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PodcastTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [episodes, setEpisodes] = useState([]);
  const [feedUrl, setFeedUrl] = useState(null);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const { toast } = useToast();

  // A load failure is rendered in place rather than toasted, so `load` has
  // no dependencies and keeps one identity for the life of the tab: an
  // effect keyed on a per-render toast function would re-run every render.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getJSON('cms/podcast/transcripts');
      setItems(Array.isArray(res?.items) ? res.items : []);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message || 'Could not load transcripts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred, so the first render commits before any state moves — the
    // same shape the Plaud library list uses.
    const timer = setTimeout(async () => {
      load();
      try {
        const res = await getJSON('public/podcasts?provider=main');
        setEpisodes(Array.isArray(res?.items) ? res.items : []);
        setFeedUrl(res?.mainFeedUrl || res?.feedUrl || null);
      } catch {
        setEpisodes([]);
      } finally {
        setEpisodesLoading(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const open = async (id) => {
    setBusy(`open:${id}`);
    try {
      const res = await getJSON(`cms/podcast/transcripts/${encodeURIComponent(id)}`);
      setDetail(res.item);
    } catch (err) {
      toast({
        title: 'Could not load the transcript',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setBusy('');
    }
  };

  const review = async (item, status) => {
    setBusy(`review:${item.id}`);
    try {
      // 200 or 202: authedFetch returns the body for any 2xx, and the review
      // route answers 202 with `jobId` (and `host.pending`) while the host
      // publish it queued is in flight, 200 when there was nothing to queue.
      const res = await postJSON('cms/podcast/transcripts/review', { id: item.id, status });
      const host = res?.host && typeof res.host === 'object' ? res.host : null;
      let hostNote = '';
      if (res?.jobId) hostNote = ` Publishing to RSS.com (job ${res.jobId}).`;
      else if (host?.skipped) hostNote = ` Host publish skipped: ${describeSkip(host)}.`;
      toast({
        title: status === 'published' ? 'Transcript approved' : 'Returned to draft',
        description: `${item.title || item.id}.${hostNote}`,
      });
      await load();
    } catch (err) {
      toast({ title: 'Review not saved', description: err.message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  const retryHost = async (item) => {
    setBusy(`retry:${item.id}`);
    try {
      await postJSON(`cms/podcast/transcripts/${encodeURIComponent(item.id)}/publish`, {});
      toast({ title: 'Host publish retried', description: item.title || item.id });
      await load();
    } catch (err) {
      // A deployment that predates the publish route (#437 slice 2) answers
      // 404 for the path, which authedFetch reports as "… failed with HTTP
      // 404". Kept as a guard: say so plainly rather than as a failure.
      const notHere = /HTTP 404/.test(err.message || '');
      toast({
        title: notHere ? 'Host retry is not available yet' : 'Host retry failed',
        description: notHere
          ? 'This deployment does not have the publish route yet; retry once it is deployed.'
          : err.message,
        variant: notHere ? undefined : 'destructive',
      });
    } finally {
      setBusy('');
    }
  };

  if (detail) return <TranscriptDetail item={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold text-sm">Transcripts</h3>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={load}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
        {loading && items.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}
        {loadError && (
          <p className="text-xs text-red-700 dark:text-red-300" role="alert">
            Could not load transcripts: {loadError}
          </p>
        )}
        {!loading && !loadError && items.length === 0 && (
          <p className="text-sm text-slate-400 py-6 text-center">
            No transcripts yet. Generate one from a live article on the Publish page, or from a
            recording on the Plaud tab.
          </p>
        )}
        <div className="space-y-2">
          {items.map((item) => (
            <TranscriptRow
              key={item.id}
              item={item}
              onOpen={open}
              onReview={review}
              onRetry={retryHost}
              busy={busy}
            />
          ))}
        </div>
      </div>
      <EpisodeList episodes={episodes} feedUrl={feedUrl} loading={episodesLoading} />
    </div>
  );
}
