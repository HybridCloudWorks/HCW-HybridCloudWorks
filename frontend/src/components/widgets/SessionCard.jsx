/**
 * One speaking engagement on the About page (ADR 0033, Spotlight slice):
 * title and links, the image with its fallback, the description that folds
 * for last year's talks, and the location and date line. Reads a
 * `sessionView` (sessionizeEvents.js).
 */
import React from 'react';
import { resolveMediaUrl } from '../../lib/functionsBase';

const TOGGLE =
  'text-accent-foreground hover:text-slate-900 dark:hover:text-white text-sm mt-1 transition-colors';

/** The primary image failed: try the external copy once, then hide the button. */
function swapToFallback(event, fallback) {
  const failedSrc = event.target.src;
  if (fallback && failedSrc !== fallback) {
    console.warn('[SpeakerEvent] Primary image failed, trying fallback:', failedSrc, '→', fallback);
    event.target.src = fallback;
  } else {
    console.error('[SpeakerEvent] Image failed (no usable fallback):', failedSrc);
    event.target.closest('button').style.display = 'none';
  }
}

function IconLink({ href, title, icon, className }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={title}>
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </a>
  );
}

/** The 80×80 image slot: the stored image (external copy as fallback), or a placeholder glyph. */
function CardImage({ view, onOpen }) {
  if (!view.imageUrl) {
    return (
      <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-2xl select-none">
        image
      </span>
    );
  }
  return (
    <button
      type="button"
      className="w-full h-full p-1 border-0 bg-transparent flex items-center justify-center cursor-pointer"
      onClick={onOpen}
      aria-label={`View image for ${view.name}`}
    >
      <img
        src={resolveMediaUrl(view.imageUrl)}
        alt={view.name}
        loading="lazy"
        decoding="async"
        className="max-w-full max-h-full object-contain hover:opacity-80 transition-opacity"
        onError={(e) => swapToFallback(e, view.imageFallback)}
      />
    </button>
  );
}

/** The description, clamped to four lines until expanded; last year's talks start folded. */
function CardBody({ view, isExpanded, onToggle }) {
  const { description, isPreviousYear } = view;
  const long = typeof description === 'string' && description.length > 200;
  const folded = isPreviousYear && !isExpanded;
  return (
    <div className="grow">
      {!folded && (
        <p
          className={`text-sm text-slate-700 dark:text-slate-400 leading-relaxed ${isExpanded ? '' : 'line-clamp-4'}`}
        >
          {description}
        </p>
      )}
      {long && (
        <button onClick={onToggle} className={TOGGLE}>
          {isExpanded ? 'Show less' : '...'}
        </button>
      )}
      {folded && (
        <button onClick={onToggle} className={TOGGLE}>
          ...
        </button>
      )}
    </div>
  );
}

/** The location (linked to a map when it is a place) and the date. */
function CardFooter({ view }) {
  const { location, locationLink: link, date, dateLabel } = view;
  return (
    <div className="mt-auto pt-3 border-t border-slate-300/70 dark:border-slate-700/50">
      <div className="flex items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-1">
          {location ? (
            <>
              <span className="material-symbols-outlined text-[16px]">location_on</span>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-foreground hover:underline truncate"
                  title={location}
                >
                  {location.includes('°') ? `${location} (GPS)` : location}
                </a>
              ) : (
                <span className="truncate" title={location}>
                  {location}
                </span>
              )}
            </>
          ) : (
            <span>Virtual</span>
          )}
        </div>

        {date && (
          <div className="flex items-center gap-1 whitespace-nowrap">
            <span className="material-symbols-outlined text-[16px]">calendar_month</span>
            <span className="font-[Aptos]" style={{ fontFamily: 'Aptos, Inter, sans-serif' }}>
              {dateLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SessionCard({ view, isExpanded, onToggle, onImage }) {
  return (
    <div className="glass-card p-5 rounded-xl flex flex-col gap-4 h-full">
      <div className="flex gap-4">
        {/* Left: title (two lines at most), then the event and presentation links. */}
        <div className="grow flex flex-col">
          <h4 className="text-slate-900 dark:text-white font-semibold text-lg leading-tight line-clamp-2 mb-1">
            {view.name}
          </h4>
          <div className="flex gap-2">
            {view.eventUrl && (
              <IconLink
                href={view.eventUrl}
                title="Event page"
                icon="language"
                className="text-accent-foreground hover:text-slate-900 dark:hover:text-white transition-colors"
              />
            )}
            {view.presentationUrl && (
              <IconLink
                href={view.presentationUrl}
                title="Presentation"
                icon="play_circle"
                className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
              />
            )}
          </div>
        </div>

        {/* Right: the image, always reserving its 80×80 space. */}
        <div className="flex flex-col items-end">
          <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden flex items-center justify-center bg-slate-100 dark:bg-slate-800/60">
            <CardImage view={view} onOpen={onImage} />
          </div>
        </div>
      </div>

      <CardBody view={view} isExpanded={isExpanded} onToggle={onToggle} />
      <CardFooter view={view} />
    </div>
  );
}
