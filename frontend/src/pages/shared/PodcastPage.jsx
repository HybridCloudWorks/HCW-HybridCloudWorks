import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router';
import usePodcastData from '@/hooks/usePodcastData';
import { useProviderConfig } from '@/context/ProviderContext';

const PLATFORM_LOGOS = {
  spotify: '/icons/logos/spotify.png',
  apple: '/icons/logos/apple-podcast.png',
  amazon: '/icons/logos/AmazonMusic.png',
  podbean: '/icons/logos/podbean.png',
};

const PROVIDER_META = {
  github: {
    name: 'GitHub',
    gradient:
      'from-slate-700 via-slate-900 to-slate-700 dark:from-slate-400 dark:via-white dark:to-slate-300',
    accent: 'text-slate-400',
    border: 'border-slate-500/30',
    badge: 'bg-slate-500/20 border-slate-500/30 text-slate-400',
    glow: 'bg-slate-500/5',
    selectedBg: 'bg-slate-500/10 border-slate-500/40',
    hoverBorder: 'hover:border-slate-500/20',
    playBtn:
      'from-slate-500 to-slate-700 hover:from-slate-400 hover:to-slate-800 shadow-slate-500/25',
    subscribeBg: 'from-slate-500/20 to-slate-900/20',
    subscribeBorder: 'border-slate-500/30',
    subscribeIcon: 'text-slate-400',
    subscribeHover: 'hover:bg-slate-500/20 hover:border-slate-500/40',
    progressBar: 'from-slate-400 to-slate-300',
    placeholder: 'from-slate-600/30 to-slate-900/40 border-slate-500/20',
    placeholderIcon: 'text-slate-400/60',
    sectionIcon: 'text-slate-400',
  },
  terraform: {
    name: 'Terraform',
    gradient: 'from-terraform-primary via-slate-900 to-terraform-primary dark:via-white',
    accent: 'text-purple-400',
    border: 'border-purple-500/30',
    badge: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
    glow: 'bg-purple-500/5',
    selectedBg: 'bg-purple-500/10 border-purple-500/40',
    hoverBorder: 'hover:border-purple-500/20',
    playBtn:
      'from-purple-500 to-purple-700 hover:from-purple-400 hover:to-purple-800 shadow-purple-500/25',
    subscribeBg: 'from-purple-500/20 to-purple-900/20',
    subscribeBorder: 'border-purple-500/30',
    subscribeIcon: 'text-purple-400',
    subscribeHover: 'hover:bg-purple-500/20 hover:border-purple-500/40',
    progressBar: 'from-purple-400 to-purple-300',
    placeholder: 'from-purple-600/30 to-purple-900/40 border-purple-500/20',
    placeholderIcon: 'text-purple-400/60',
    sectionIcon: 'text-purple-400',
  },
  finops: {
    name: 'FinOps',
    gradient: 'from-finops-primary via-slate-900 to-finops-primary dark:via-white',
    accent: 'text-emerald-400',
    border: 'border-emerald-500/30',
    badge: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    glow: 'bg-emerald-500/5',
    selectedBg: 'bg-emerald-500/10 border-emerald-500/40',
    hoverBorder: 'hover:border-emerald-500/20',
    playBtn:
      'from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-800 shadow-emerald-500/25',
    subscribeBg: 'from-emerald-500/20 to-emerald-900/20',
    subscribeBorder: 'border-emerald-500/30',
    subscribeIcon: 'text-emerald-400',
    subscribeHover: 'hover:bg-emerald-500/20 hover:border-emerald-500/40',
    progressBar: 'from-emerald-400 to-emerald-300',
    placeholder: 'from-emerald-600/30 to-emerald-900/40 border-emerald-500/20',
    placeholderIcon: 'text-emerald-400/60',
    sectionIcon: 'text-emerald-400',
  },
};

function detectProvider(pathname) {
  if (pathname.includes('/github')) return 'github';
  if (pathname.includes('/terraform')) return 'terraform';
  if (pathname.includes('/finops')) return 'finops';
  return 'github';
}

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

function EpisodeImage({ image, title, size = 'md', meta }) {
  const sizeClass = size === 'sm' ? 'w-14 h-14' : 'w-full aspect-square max-w-[200px]';
  if (image) {
    return (
      <img
        src={image}
        alt={title}
        loading="lazy"
        decoding="async"
        className={`${sizeClass} rounded-lg object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-lg bg-gradient-to-br ${meta.placeholder} flex items-center justify-center flex-shrink-0`}
    >
      <span className={`material-symbols-outlined ${meta.placeholderIcon} text-3xl`}>podcasts</span>
    </div>
  );
}

export default function SharedPodcastPage() {
  const { pathname } = useLocation();
  const provider = detectProvider(pathname);
  const meta = PROVIDER_META[provider];
  const podcastConfig = useProviderConfig();
  const { episodes = [], loading } = usePodcastData(provider);

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
        <title>{`${meta.name} Podcast | HCW`}</title>
        <meta
          name="description"
          content={`Expert audio episodes on ${meta.name} architecture, patterns, and enterprise solutions.`}
        />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        {/* Hero */}
        <section className="mb-10 relative">
          <div
            className={`absolute -top-10 -left-10 w-96 h-96 ${meta.glow} blur-3xl rounded-full pointer-events-none`}
          />
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white mb-4 relative z-10">
            <span className={`bg-clip-text text-transparent bg-gradient-to-r ${meta.gradient}`}>
              {meta.name} Podcast
            </span>
          </h1>
          <p className="text-base sm:text-lg text-foreground max-w-3xl relative z-10">
            Deep-dive podcast discussions on {meta.name} architecture, patterns, and enterprise
            solutions.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* Left: Featured + Episode List */}
          <div className="space-y-8">
            {loading && (
              <div
                className={`bg-card/40 ${meta.border} border rounded-2xl p-8 text-foreground animate-pulse h-64`}
              />
            )}

            {!loading && featured && (
              <article
                className={`bg-card/40 backdrop-blur-md border ${meta.border} rounded-2xl overflow-hidden`}
              >
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
                    <span className={`px-3 py-1 ${meta.badge} border text-xs font-bold rounded`}>
                      Now Playing
                    </span>
                  </div>

                  <div className="flex gap-6 items-start mb-6">
                    <EpisodeImage
                      image={featured.image}
                      title={featured.title}
                      size="lg"
                      meta={meta}
                    />
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 leading-tight">
                        {featured.title}
                      </h2>
                      <p className="text-sm text-foreground line-clamp-3">
                        {stripHtml(featured.longDescription || featured.description)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label="Seek audio"
                    className="w-full h-2 bg-card/60 rounded-full overflow-hidden cursor-pointer mb-2"
                    onClick={handleSeek}
                  >
                    <div
                      className={`h-full bg-gradient-to-r ${meta.progressBar} rounded-full transition-all duration-200`}
                      style={{ width: `${progress}%` }}
                    />
                  </button>
                  <div className="flex justify-between text-xs text-foreground mb-5">
                    <span>{formatTime(currentTime)}</span>
                    <span>
                      {duration ? formatTime(duration) : formatDuration(featured.duration)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsPlaying((p) => !p)}
                      disabled={!featured.mediaUrl}
                      className={`w-12 h-12 bg-gradient-to-br ${meta.playBtn} rounded-full flex items-center justify-center transition-all shadow-lg disabled:opacity-40`}
                    >
                      <span className="material-symbols-outlined text-white text-2xl">
                        {isPlaying ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                    <a
                      href={featured.mediaUrl || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-card/50 hover:bg-card/70 text-foreground rounded-lg transition-colors text-sm font-semibold"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Download
                    </a>
                    <a
                      href={featured.link || '#'}
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
              <div
                className={`bg-card/40 border ${meta.border} rounded-2xl p-8 text-foreground text-sm`}
              >
                No episodes available yet.
              </div>
            )}

            {/* Episode List */}
            <section>
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className={`material-symbols-outlined ${meta.sectionIcon} text-[22px]`}>
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
                            ? meta.selectedBg
                            : `bg-card/30 border-card/50 hover:bg-card/50 ${meta.hoverBorder}`
                        }`}
                    >
                      <EpisodeImage image={ep.image} title={ep.title} size="sm" meta={meta} />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-semibold truncate ${isSelected ? meta.accent : 'text-white'}`}
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
                        <span
                          className={`material-symbols-outlined ${meta.accent} text-[18px] flex-shrink-0`}
                        >
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
            <div
              className={`bg-gradient-to-br ${meta.subscribeBg} backdrop-blur-md border ${meta.subscribeBorder} rounded-2xl p-6`}
            >
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <span className={`material-symbols-outlined ${meta.subscribeIcon} text-[20px]`}>
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
                      className={`w-full py-2.5 px-3 bg-card/50 ${meta.subscribeHover} border border-card/60 text-foreground rounded-lg transition-all text-sm font-semibold flex items-center gap-3`}
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
