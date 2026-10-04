/**
 * EpisodePlaylist — the study podcast for one certification as a single
 * player with a chapter list, for the hero of a detail page (#498).
 *
 * `ListenAndLearn` below the fold renders one full card per episode: player,
 * takeaways, videos, transcript. That is the study surface. This is the
 * "press play" surface: one `<audio>` element and the chapters in study-guide
 * order, so a learner who has already decided to listen does not scroll past
 * the topics to find the button. Both read the same published-only endpoint,
 * so an episode is either on both or on neither.
 *
 * Renders nothing unless at least one approved episode has audio. A hero slot
 * with an empty player in it would be worse than the empty slot, and on
 * 2026-09-11 exactly one Azure certification (AB-100) had approved audio —
 * this component is present on every Azure detail page and visible on one.
 *
 * ONE INSTANCE PER EXAM — KEY IT AT THE CALL SITE. The selected chapter is
 * component state, and this component does not reset it when `examCode`
 * changes; it relies on the caller passing `key={examCode}` so a route
 * change remounts it. That is React's own answer to "reset state on prop
 * change" and it also resets the `<audio>` element and any playback in the
 * same stroke, which an effect syncing `index` to props would not. Without
 * the key, navigating between two exams with episodes would carry the first
 * exam's selected chapter — or an index past the second exam's last chapter —
 * into a page it was never on (Copilot review of 05b35783).
 *
 * Native `<audio>`, not a custom player: keyboard, OS media keys and
 * playback-speed preferences work for free, and it is what the rest of the
 * site uses. Switching chapter swaps `src` on the same element, which is why
 * it is one element and not one per chapter — one set of controls, one
 * position, one thing the screen reader announces.
 */
import React, { useMemo, useRef, useState } from 'react';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublishedEpisodes } from '@/lib/listenAndLearn';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { readPlaybackPosition, savePlaybackPosition } from '@/lib/audioEpisodes';

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '';
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `47 min` / `2 h 05 min` for the whole course; '' when nothing is known. */
function formatTotal(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** The key a chapter's position is remembered under — the same id the audio page uses for the row. */
const positionKey = (chapter) => `listen-and-learn:${chapter.setId}/${chapter.id}`;

export default function EpisodePlaylist({ platform, examCode, className = '' }) {
  const enabled = Boolean(platform && examCode);
  const { data, loading } = usePublicData(
    () => fetchPublishedEpisodes({ platform, examCode }),
    enabled ? `episode-playlist:${platform}:${examCode}` : ''
  );

  // Study-guide order, and only chapters that can actually play.
  const chapters = useMemo(
    () =>
      (data?.episodes || [])
        .filter((e) => typeof e.audioUrl === 'string' && e.audioUrl)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [data]
  );

  const [index, setIndex] = useState(0);
  const audioRef = useRef(null);

  const totalSeconds = useMemo(
    () => chapters.reduce((sum, c) => sum + (Number(c.durationSeconds) || 0), 0),
    [chapters]
  );

  if (loading || chapters.length === 0) return null;

  const current = chapters[Math.min(index, chapters.length - 1)];

  const play = (i) => {
    setIndex(i);
    // Let React swap `src` first; then start. A play() on the old src would
    // resume the previous chapter for a frame before the swap lands.
    requestAnimationFrame(() => audioRef.current?.play?.().catch(() => {}));
  };

  // Next chapter, automatically, when one ends (ADR 0033 §4); the finished
  // chapter's remembered position is cleared so a return starts it over.
  const advance = () => {
    savePlaybackPosition(positionKey(current), 0);
    if (index < chapters.length - 1) play(index + 1);
  };

  const remember = (audioEl) => {
    savePlaybackPosition(
      positionKey(current),
      audioEl.currentTime,
      audioEl.duration || current.durationSeconds
    );
  };

  return (
    <section
      className={`bg-card/60 backdrop-blur-md border border-card/60 rounded-2xl p-4 ${className}`}
      aria-labelledby="episode-playlist-heading"
    >
      <h2
        id="episode-playlist-heading"
        className="text-sm font-bold text-slate-950 dark:text-white mb-2 flex items-center gap-2"
      >
        <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">
          headphones
        </span>
        {/* Named for what it is, not "Listen & Learn" again: the full section
            below the fold already carries that heading, and a screen reader
            would announce the feature twice with nothing to tell them apart. */}
        Study podcast
        <span className="ml-auto text-xs font-normal text-foreground/60">
          {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}
          {formatTotal(totalSeconds) ? ` · ${formatTotal(totalSeconds)}` : ''}
        </span>
      </h2>

      <p className="text-xs text-foreground/70 mb-2 truncate" title={current.title}>
        <span className="text-foreground/50">Now: </span>
        {current.areaName || current.title}
      </p>

      <audio
        ref={audioRef}
        controls
        preload="none"
        src={resolveMediaUrl(current.audioUrl)}
        onEnded={advance}
        onLoadedMetadata={(e) => {
          // Pick up where this browser left off in this chapter.
          const at = readPlaybackPosition(positionKey(current));
          if (at > 0 && at < (e.currentTarget.duration || Infinity))
            e.currentTarget.currentTime = at;
        }}
        onPause={(e) => remember(e.currentTarget)}
        onTimeUpdate={(e) => remember(e.currentTarget)}
        className="w-full h-9 mb-3"
        aria-label={`Play chapter: ${current.title}`}
      >
        <track kind="captions" />
      </audio>

      <ol className="space-y-1" aria-label="Chapters, in study-guide order">
        {chapters.map((chapter, i) => {
          const active = i === index;
          return (
            <li key={chapter.id}>
              <button
                type="button"
                onClick={() => play(i)}
                aria-current={active ? 'true' : undefined}
                className={`w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 text-xs transition-colors border ${
                  active
                    ? 'border-primary/40 bg-primary/10 text-slate-950 dark:text-white'
                    : 'border-transparent text-foreground/80 hover:bg-card/70 hover:text-foreground'
                }`}
              >
                <span
                  className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    active ? 'bg-primary text-primary-foreground' : 'bg-card/80 text-foreground/70'
                  }`}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 truncate">{chapter.areaName || chapter.title}</span>
                {chapter.weightLabel ? (
                  <span
                    className="shrink-0 text-[10px] text-foreground/50"
                    title="Share of the exam this chapter covers"
                  >
                    {chapter.weightLabel}
                  </span>
                ) : null}
                {formatDuration(chapter.durationSeconds) ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-foreground/50">
                    {formatDuration(chapter.durationSeconds)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
