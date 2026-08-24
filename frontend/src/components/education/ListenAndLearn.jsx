/**
 * Listen & Learn — one study podcast per weighted skill area of a
 * certification's official study guide, plus the videos worth watching next.
 *
 * Renders on certification detail pages for the platforms whose exam guides
 * can be parsed. Everything else gets an honest "coming soon" rather than an
 * empty section, because a heading with nothing under it reads as broken.
 *
 * Only approved episodes ever reach here, and that is enforced on the server:
 * `GET /api/public/listen-and-learn` filters to `status === 'published'` and
 * offers no way to ask for anything else. Upstream relied on a Firestore rule
 * for the same guarantee; the difference is that a rule had to be re-satisfied
 * by every query, and this cannot be forgotten at a call site.
 */
import React, { useState } from 'react';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublishedEpisodes, isSupportedPlatform } from '@/lib/listenAndLearn';
import { resolveMediaUrl } from '@/lib/functionsBase';

const ACCENTS = {
  azure: {
    icon: 'text-primary',
    chip: 'bg-primary/15 text-primary border-primary/30',
    hover: 'hover:border-primary/30',
    bar: 'bg-primary',
  },
  github: {
    icon: 'text-purple-400',
    chip: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    hover: 'hover:border-purple-400/30',
    bar: 'bg-purple-400',
  },
  aws: {
    icon: 'text-amber-400',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    hover: 'hover:border-amber-400/30',
    bar: 'bg-amber-400',
  },
};

const formatBytes = (bytes) => (bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : null);

function SectionShell({ children, accent }) {
  return (
    <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
        <span className={`${accent.icon} material-symbols-outlined text-[20px]`}>headphones</span>
        Listen &amp; Learn
      </h2>
      {children}
    </section>
  );
}

/** One episode: player, what it covers, and the videos to watch next. */
function Episode({ episode, accent }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const takeaways = Array.isArray(episode.keyTakeaways) ? episode.keyTakeaways : [];
  const videos = Array.isArray(episode.videos) ? episode.videos : [];
  const transcript = Array.isArray(episode.transcript) ? episode.transcript : [];

  return (
    <article className="bg-card/40 border border-card/30 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{episode.title}</h3>
          <p className="text-xs text-foreground/60 mt-0.5">{episode.areaName}</p>
        </div>
        {episode.weightLabel && (
          <span
            className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${accent.chip}`}
            title="Share of the exam this area is worth"
          >
            {episode.weightLabel} of exam
          </span>
        )}
      </div>

      {episode.summary && <p className="text-xs text-foreground/70 mb-3">{episode.summary}</p>}

      {episode.audioUrl && (
        // Native audio: keyboard accessible, respects OS media keys and
        // playback-speed preferences, and costs nothing to ship.
        //
        // resolveMediaUrl is not optional. The API stores this as the
        // site-relative `/api/public/media/...` path so a topology change
        // cannot invalidate every episode already generated — which means it
        // resolves against the SPA's own origin unless it is rewritten, and a
        // cross-origin deployment would serve index.html to an <audio> tag.
        <audio
          controls
          preload="none"
          src={resolveMediaUrl(episode.audioUrl)}
          className="w-full h-10 mb-3"
          aria-label={`Listen: ${episode.title}`}
        >
          <track kind="captions" />
        </audio>
      )}

      {takeaways.length > 0 && (
        <ul className="space-y-1 mb-3">
          {takeaways.map((point) => (
            <li key={point} className="text-xs text-foreground/70 flex gap-2">
              <span className={`mt-1.5 h-1 w-1 rounded-full shrink-0 ${accent.bar}`} />
              {point}
            </li>
          ))}
        </ul>
      )}

      {videos.length > 0 && (
        <div className="mt-3 pt-3 border-t border-card/30">
          <p className="text-[10px] uppercase tracking-wide text-foreground/50 mb-2">Watch next</p>
          <div className="space-y-1.5">
            {videos.map((video) => (
              <a
                key={video.videoId}
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 group rounded-lg px-2 py-1.5 border border-transparent ${accent.hover} transition-all`}
              >
                <span className="material-symbols-outlined text-[14px] text-foreground/40 shrink-0">
                  play_circle
                </span>
                <span className="text-xs text-foreground/80 group-hover:text-foreground truncate flex-1">
                  {video.title}
                </span>
                <span className="text-[10px] text-foreground/40 shrink-0">{video.duration}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {transcript.length > 0 && (
        <div className="mt-3 pt-3 border-t border-card/30">
          <button
            type="button"
            onClick={() => setShowTranscript((open) => !open)}
            aria-expanded={showTranscript}
            className="text-[11px] font-semibold text-foreground/60 hover:text-foreground flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">
              {showTranscript ? 'expand_less' : 'expand_more'}
            </span>
            {showTranscript ? 'Hide transcript' : 'Read transcript'}
          </button>
          {showTranscript && (
            <div className="mt-2 space-y-2">
              {transcript.map((turn, i) => (
                <p key={`${turn.speaker}-${i}`} className="text-xs text-foreground/70">
                  <span className="font-semibold text-foreground/90">{turn.speaker}: </span>
                  {turn.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function ListenAndLearn({ platform, examCode, studyGuideUrl }) {
  const accent = ACCENTS[platform] || ACCENTS.azure;
  const supported = isSupportedPlatform(platform);
  const enabled = supported && Boolean(examCode);

  const { data, loading } = usePublicData(
    () => fetchPublishedEpisodes({ platform, examCode }),
    enabled ? `listen-and-learn:${platform}:${examCode}` : ''
  );
  const episodes = data?.episodes || [];

  if (!supported) {
    return (
      <SectionShell accent={accent}>
        <p className="text-sm text-foreground/70 mt-2">
          Study podcasts are live for Azure, GitHub and AWS certifications. This platform is next —
          its exam guides are published in a different format and need their own parser.
        </p>
      </SectionShell>
    );
  }

  // Nothing rendered while loading or empty: a certification with no approved
  // episodes yet has nothing to say, and an empty player list is worse than
  // silence.
  if (loading || episodes.length === 0) return null;

  return (
    <SectionShell accent={accent}>
      <p className="text-sm text-foreground/70 mb-4">
        One episode per scored area of the{' '}
        {studyGuideUrl ? (
          <a
            href={studyGuideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            official study guide
          </a>
        ) : (
          'official study guide'
        )}
        , with the videos worth watching alongside.
      </p>

      <div className="space-y-3">
        {episodes.map((episode) => (
          <Episode key={episode.id} episode={episode} accent={accent} />
        ))}
      </div>

      <p className="text-[10px] text-foreground/40 mt-4">
        Audio is AI-generated from the official exam objectives and reviewed before publishing.
        Always check the study guide for the authoritative wording.
        {episodes[0]?.audioBytes ? ` · ${formatBytes(episodes[0].audioBytes)} per episode` : ''}
      </p>
    </SectionShell>
  );
}
