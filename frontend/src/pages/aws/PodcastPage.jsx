import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import usePodcastData from '@/hooks/usePodcastData';
import { useProviderConfig } from '@/context/ProviderContext';
import { safeUrl } from '@/lib/safeUrl';

const PLATFORM_LOGOS = {
  spotify: '/icons/logos/spotify.png',
  apple: '/icons/logos/apple-podcast.png',
  amazon: '/icons/logos/AmazonMusic.png',
  podbean: '/icons/logos/podbean.png',
};

function formatDuration(raw) {
  if (!raw) return '—';
  const n = Number(raw);
  if (!isNaN(n) && n > 0) {
    const m = Math.floor(n / 60);
    const s = String(n % 60).padStart(2, '0');
    return `${m}:${s}`;
  }
  return String(raw);
}

function stripHtml(html) {
  if (!html) return '';
  // Apply tag removal repeatedly until stable: a single pass leaves residues for
  // overlapping constructs like `<scr<script>ipt>`.
  let prev;
  let out = String(html);
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== prev);
  return out.trim();
}

function EpisodeImage({ image, title, size = 'md' }) {
  const sizeClass = size === 'sm' ? 'w-14 h-14' : 'w-full aspect-square max-w-[200px]';
  if (image) {
    return (
      <img
        src={safeUrl(image)}
        alt={title}
        loading="lazy"
        decoding="async"
        className={`${sizeClass} rounded-lg object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-lg bg-gradient-to-br from-amber-600/30 to-orange-900/40 border border-amber-500/20 flex items-center justify-center flex-shrink-0`}
    >
      <span className="material-symbols-outlined text-amber-400/60 text-3xl">podcasts</span>
    </div>
  );
}

export default function PodcastPage() {
  const podcastConfig = useProviderConfig();
  const { episodes = [], loading } = usePodcastData('aws');

  const [selectedId, setSelectedId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  const featured = selectedId
    ? (episodes.find((e) => e.id === selectedId) ?? episodes[0] ?? null)
    : (episodes[0] ?? null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setCurrentTime(audio.currentTime);
    setProgress((audio.currentTime / audio.duration) * 100);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (audio) setDuration(audio.duration);
  }

  function selectEpisode(id) {
    setSelectedId(id);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
  }

  function handleSeek(e) {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  }

  function formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = String(Math.floor(secs % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  const platforms = [
    { key: 'spotify', name: 'Spotify' },
    { key: 'apple', name: 'Apple Podcasts' },
    { key: 'amazon', name: 'Amazon Music' },
    { key: 'podbean', name: 'PodBean' },
  ];

  return (
    <>
      <Helmet>
        <title>AWS Podcast | HCW</title>
        <meta
          name="description"
          content="Expert audio episodes on AWS architecture, cloud design patterns, and enterprise solutions."
        />
        <meta property="og:title" content="AWS Podcast Series" />
        <meta
          property="og:description"
          content="Deep-dive podcast discussions on AWS cloud architecture and design."
        />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        {/* Hero */}
        <section className="mb-10 relative">
          <div className="absolute -top-10 -left-10 w-96 h-96 bg-amber-500/5 blur-3xl rounded-full pointer-events-none" />
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white mb-4 relative z-10">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-aws-primary via-slate-900 to-aws-primary dark:via-white">
              AWS Podcast
            </span>
          </h1>
          <p className="text-base sm:text-lg text-foreground max-w-3xl relative z-10">
            Deep-dive podcast discussions on AWS architecture, cloud design patterns, and enterprise
            solutions.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* Left: Featured + Episode List */}
          <div className="space-y-8">
            {/* Featured Player */}
            {loading && (
              <div className="bg-card/40 border border-amber-500/20 rounded-2xl p-8 text-foreground animate-pulse h-64" />
            )}

            {!loading && featured && (
              <article className="bg-card/40 backdrop-blur-md border border-amber-500/30 rounded-2xl overflow-hidden">
                {/* eslint-disable jsx-a11y/media-has-caption */}
                {featured.mediaUrl && (
                  <audio
                    key={featured.id}
                    ref={audioRef}
                    src={featured.mediaUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                    preload="metadata"
                  />
                )}
                {/* eslint-enable jsx-a11y/media-has-caption */}

                <div className="p-6 sm:p-8">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-3 py-1 bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold rounded">
                      Now Playing
                    </span>
                  </div>

                  <div className="flex gap-6 items-start mb-6">
                    <EpisodeImage image={featured.image} title={featured.title} size="lg" />
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 leading-tight">
                        {featured.title}
                      </h2>
                      <p className="text-sm text-foreground line-clamp-3">
                        {stripHtml(featured.longDescription || featured.description)}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <button
                    type="button"
                    aria-label="Seek audio"
                    className="w-full h-2 bg-card/60 rounded-full overflow-hidden cursor-pointer mb-2"
                    onClick={handleSeek}
                  >
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </button>
                  <div className="flex justify-between text-xs text-foreground mb-5">
                    <span>{formatTime(currentTime)}</span>
                    <span>
                      {duration ? formatTime(duration) : formatDuration(featured.duration)}
                    </span>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsPlaying((p) => !p)}
                      disabled={!featured.mediaUrl}
                      className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-700 rounded-full flex items-center justify-center transition-all shadow-lg shadow-amber-500/25 disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-white text-2xl">
                        {isPlaying ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                    <a
                      href={safeUrl(featured.mediaUrl, '#')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-card/50 hover:bg-card/70 text-foreground rounded-lg transition-colors text-sm font-semibold"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Download
                    </a>
                    <a
                      href={safeUrl(featured.link, '#')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-card/50 hover:bg-card/70 text-foreground rounded-lg transition-colors text-sm font-semibold"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      Open
                    </a>
                  </div>
                </div>
              </article>
            )}

            {!loading && !featured && (
              <div className="bg-card/40 border border-amber-500/20 rounded-2xl p-8 text-foreground text-sm">
                No episodes available yet.
              </div>
            )}

            {/* Episode List */}
            <section>
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[22px]">
                  library_music
                </span>
                All Episodes
              </h3>
              {loading && (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="h-20 rounded-xl bg-card/30 animate-pulse border border-card/50"
                    />
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {episodes.map((ep) => {
                  const isSelected = featured?.id === ep.id;
                  return (
                    <button
                      key={ep.id}
                      onClick={() => selectEpisode(ep.id)}
                      className={`w-full text-left flex items-center gap-4 p-3 rounded-xl border transition-all duration-200
                        ${
                          isSelected
                            ? 'bg-amber-500/10 border-amber-500/40'
                            : 'bg-card/30 border-card/50 hover:bg-card/50 hover:border-amber-500/20'
                        }`}
                    >
                      <EpisodeImage image={ep.image} title={ep.title} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-semibold truncate ${isSelected ? 'text-amber-400' : 'text-white'}`}
                        >
                          {ep.title}
                        </p>
                        <p className="text-xs text-foreground line-clamp-1 mt-0.5">
                          {stripHtml(ep.description)}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right space-y-1">
                        <p className="text-xs text-foreground flex items-center gap-1 justify-end">
                          <span className="material-symbols-outlined text-[13px]">schedule</span>
                          {formatDuration(ep.duration)}
                        </p>
                        {ep.publishedAtString && (
                          <p className="text-xs text-foreground/60">{ep.publishedAtString}</p>
                        )}
                      </div>
                      {isSelected && isPlaying && (
                        <span className="material-symbols-outlined text-amber-400 text-[18px] flex-shrink-0">
                          graphic_eq
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right Sidebar: Subscribe */}
          <aside className="h-fit sticky top-28">
            <div className="bg-gradient-to-br from-amber-500/20 to-orange-900/20 backdrop-blur-md border border-amber-500/30 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[20px]">
                  podcast
                </span>
                Subscribe Now
              </h3>
              <p className="text-sm text-foreground mb-5">
                Get new episodes delivered to your favorite podcast app.
              </p>
              <div className="space-y-2">
                {platforms.map((platform) => {
                  const url =
                    podcastConfig?.podcast?.subscribeLinks?.[platform.key] ||
                    podcastConfig?.podcast?.feedUrl ||
                    '#';
                  return (
                    <a
                      key={platform.key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2.5 px-3 bg-card/50 hover:bg-amber-500/20 hover:border-amber-500/40 border border-card/60 text-foreground rounded-lg transition-all text-sm font-semibold flex items-center gap-3"
                    >
                      <img
                        src={PLATFORM_LOGOS[platform.key]}
                        alt={platform.name}
                        loading="lazy"
                        decoding="async"
                        width="20"
                        height="20"
                        className="w-5 h-5 object-contain rounded-sm flex-shrink-0"
                      />
                      {platform.name}
                    </a>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
