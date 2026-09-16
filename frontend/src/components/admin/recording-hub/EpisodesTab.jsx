/**
 * Episodes — what is live on the show (#576).
 *
 * The public feed's own view of the podcast, read through `public/podcasts`
 * rather than the admin container: this is what a listener would get, which is
 * the point of having the tab. Distribution answers the other question — what
 * this hub has tried to send and how that went.
 */
import React from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { fmtDate } from './recordingView';

/** The show as the public feed presents it. */
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

export default function EpisodesTab({ hub }) {
  const { episodes, feedUrl, episodesLoading, episodesError } = hub;

  return (
    <div className="space-y-2">
      {episodesError && (
        <p className="text-xs text-red-700 dark:text-red-300" role="alert">
          Could not load episodes: {episodesError}
        </p>
      )}
      <EpisodeList episodes={episodes} feedUrl={feedUrl} loading={episodesLoading} />
    </div>
  );
}
