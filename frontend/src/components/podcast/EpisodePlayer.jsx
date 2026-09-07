/**
 * The one player on the podcast page (#349).
 *
 * A native `<audio>` element drives it, because that is what already honours
 * OS media keys, playback-speed preferences and the browser's own byte-range
 * seeking. The controls are the page's — play/pause and a real slider — so the
 * page can style them per provider and keep the list in step with what is
 * playing, without reimplementing decoding or buffering.
 *
 * Seeking is a `<input type="range">`, not a click on a div: it is keyboard
 * operable, announces its value, and its `max` is the real duration once
 * metadata has arrived. It works because the media route answers `Range`
 * requests — before that (lib/public-media.js) a seek into a Listen & Learn
 * episode downloaded the whole file first.
 *
 * `preload="metadata"` fetches only the header, so the page costs a few
 * kilobytes per episode until someone presses play. Mount with
 * `key={episode.id}` and every piece of state below resets with the element.
 */
import React, { useEffect, useRef, useState } from 'react';
import { formatSeconds, stripHtml } from '@/lib/audioEpisodes';
import { safeUrl } from '@/lib/safeUrl';

export default function EpisodePlayer({ episode, meta, onPlayingChange }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(null);

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      // jsdom and some embedded browsers return undefined rather than a
      // promise; a rejection (autoplay policy, network) drops back to paused.
      const result = audio.play();
      if (result && typeof result.catch === 'function') {
        result.catch(() => setIsPlaying(false));
      }
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // Decide on the sanitised value: an unsafe URL (javascript:, data:, control
  // characters) gets the placeholder, not an <img> with no src.
  const image = safeUrl(episode.image);
  const known = duration ?? episode.durationSeconds ?? null;
  const sliderMax = known && known > 0 ? known : 0;

  function handleSeek(event) {
    const audio = audioRef.current;
    const next = Number(event.target.value);
    setCurrentTime(next);
    if (audio) audio.currentTime = next;
  }

  return (
    <article
      className={`bg-card/40 backdrop-blur-md border ${meta.border} rounded-2xl overflow-hidden`}
      data-testid="episode-player"
    >
      {/* eslint-disable jsx-a11y/media-has-caption */}
      {episode.mediaUrl && (
        <audio
          ref={audioRef}
          src={episode.mediaUrl}
          preload="metadata"
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
          onEnded={() => setIsPlaying(false)}
          aria-label={`Audio: ${episode.title}`}
        />
      )}
      {/* eslint-enable jsx-a11y/media-has-caption */}

      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-4">
          <span className={`px-3 py-1 ${meta.badge} border text-xs font-bold rounded`}>
            Now Playing
          </span>
          <span className="px-3 py-1 bg-card/60 border border-card/80 text-foreground text-xs font-semibold rounded">
            {episode.sourceLabel}
          </span>
        </div>

        <div className="flex gap-6 items-start mb-6">
          {image ? (
            <img
              src={image}
              alt={episode.title}
              loading="lazy"
              decoding="async"
              className="w-full aspect-square max-w-[200px] rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div
              className={`w-full aspect-square max-w-[200px] rounded-lg bg-gradient-to-br ${meta.placeholder} flex items-center justify-center flex-shrink-0`}
            >
              <span className={`material-symbols-outlined ${meta.placeholderIcon} text-3xl`}>
                podcasts
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 leading-tight">
              {episode.title}
            </h2>
            <p className="text-sm text-foreground line-clamp-3">
              {stripHtml(episode.longDescription || episode.description)}
            </p>
          </div>
        </div>

        <div
          // The input inside is transparent so the styled bar shows through;
          // the ring on the track is what makes keyboard focus visible.
          className="relative w-full h-2 bg-card/60 rounded-full mb-2 focus-within:ring-2 focus-within:ring-white/80 focus-within:ring-offset-2 focus-within:ring-offset-transparent"
          data-testid="episode-track"
        >
          <div
            className={`h-full bg-gradient-to-r ${meta.progressBar} rounded-full transition-all duration-200`}
            style={{
              // Clamped like the slider's value: a document's durationSeconds
              // can be shorter than the real file, and the bar must not
              // overflow its track while the last seconds play.
              width: sliderMax ? `${(Math.min(currentTime, sliderMax) / sliderMax) * 100}%` : '0%',
            }}
            data-testid="episode-progress"
            aria-hidden="true"
          />
          <input
            type="range"
            aria-label="Seek"
            min="0"
            max={sliderMax}
            step="1"
            value={Math.min(currentTime, sliderMax)}
            onChange={handleSeek}
            disabled={!episode.mediaUrl || !sliderMax}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
          />
        </div>
        <div className="flex justify-between text-xs text-foreground mb-5">
          <span>{formatSeconds(currentTime)}</span>
          <span>{formatSeconds(known)}</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            disabled={!episode.mediaUrl}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className={`w-12 h-12 bg-gradient-to-br ${meta.playBtn} rounded-full flex items-center justify-center transition-all shadow-lg disabled:opacity-40`}
          >
            <span className="material-symbols-outlined text-white text-2xl">
              {isPlaying ? 'pause' : 'play_arrow'}
            </span>
          </button>
          {episode.mediaUrl && (
            <a
              href={safeUrl(episode.mediaUrl, '#')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-card/50 hover:bg-card/70 text-foreground rounded-lg transition-colors text-sm font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Download
            </a>
          )}
          {episode.link && (
            <a
              href={safeUrl(episode.link, '#')}
              {...(episode.link.startsWith('/')
                ? {}
                : { target: '_blank', rel: 'noopener noreferrer' })}
              className="flex items-center gap-2 px-4 py-2 bg-card/50 hover:bg-card/70 text-foreground rounded-lg transition-colors text-sm font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">
                {episode.link.startsWith('/') ? 'school' : 'open_in_new'}
              </span>
              {episode.link.startsWith('/') ? 'Certification' : 'Open'}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
