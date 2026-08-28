import React, { useMemo, useState } from 'react';
import {
  Lightbulb,
  CheckCircle2,
  Link2,
  Image,
  BarChart3,
  FileCode2,
  Video,
  Play,
  X,
  Quote,
  Table2,
  ListOrdered,
  Megaphone,
  Workflow,
} from 'lucide-react';
import { resolveMediaUrl } from '../../lib/functionsBase';
import StatBlock from '../shared/StatBlock';
import Eyebrow from '../shared/Eyebrow';

export const SPACER_STYLE_OPTIONS = [
  { key: 'gradient', label: 'Gradient Bar' },
  { key: 'solid', label: 'Solid Bar' },
  { key: 'dots', label: 'Dotted Rule' },
  { key: 'double', label: 'Double Line' },
  { key: 'glow', label: 'Glow Pulse' },
  { key: 'accent', label: 'Accent Split' },
];

/**
 * Inline Module Components
 * Used in both the blog detail display and editor preview
 * Each module can be left/right aligned and has custom styling
 */

// Module type configuration
export const MODULE_TYPES = {
  fact: {
    label: 'Fact',
    icon: Lightbulb,
    color: 'bg-blue-500/10 border-blue-500/30',
    accentColor: 'text-blue-300',
    badgeColor: 'bg-blue-500/20 text-blue-200',
  },
  recommendation: {
    label: 'Recommendation',
    icon: CheckCircle2,
    color: 'bg-emerald-500/10 border-emerald-500/30',
    accentColor: 'text-emerald-400',
    badgeColor: 'bg-emerald-500/20 text-emerald-300',
  },
  links: {
    label: 'Links',
    icon: Link2,
    color: 'bg-blue-500/10 border-blue-500/30',
    accentColor: 'text-blue-400',
    badgeColor: 'bg-blue-500/20 text-blue-300',
  },
  picture: {
    label: 'Image',
    icon: Image,
    color: 'bg-purple-500/10 border-purple-500/30',
    accentColor: 'text-purple-400',
    badgeColor: 'bg-purple-500/20 text-purple-300',
  },
  spacer: {
    label: 'Spacer',
    icon: BarChart3,
    color: 'bg-slate-500/5 border-slate-500/20',
    accentColor: 'text-slate-400',
    badgeColor: 'bg-slate-500/10 text-slate-300',
  },
  text: {
    label: 'Text Frame',
    icon: BarChart3,
    color: 'bg-sky-500/10 border-sky-500/30',
    accentColor: 'text-sky-300',
    badgeColor: 'bg-sky-500/20 text-sky-200',
  },
  code: {
    label: 'Code',
    icon: FileCode2,
    color: 'bg-indigo-500/10 border-indigo-500/30',
    accentColor: 'text-indigo-300',
    badgeColor: 'bg-indigo-500/20 text-indigo-200',
  },
  video: {
    label: 'Video',
    icon: Video,
    color: 'bg-rose-500/10 border-rose-500/30',
    accentColor: 'text-rose-300',
    badgeColor: 'bg-rose-500/20 text-rose-200',
  },
  design: {
    label: 'Diagram',
    icon: Workflow,
    color: 'bg-teal-500/10 border-teal-500/30',
    accentColor: 'text-teal-300',
    badgeColor: 'bg-teal-500/20 text-teal-200',
  },
  pull_quote: {
    label: 'Pull Quote',
    icon: Quote,
    color: 'bg-violet-500/10 border-violet-500/30',
    accentColor: 'text-violet-300',
    badgeColor: 'bg-violet-500/20 text-violet-200',
  },
  stat_board: {
    label: 'Stat Board',
    icon: BarChart3,
    color: 'bg-cyan-500/10 border-cyan-500/30',
    accentColor: 'text-cyan-300',
    badgeColor: 'bg-cyan-500/20 text-cyan-200',
  },
  comparison: {
    label: 'Comparison',
    icon: Table2,
    color: 'bg-indigo-500/10 border-indigo-500/30',
    accentColor: 'text-indigo-300',
    badgeColor: 'bg-indigo-500/20 text-indigo-200',
  },
  timeline: {
    label: 'Timeline',
    icon: ListOrdered,
    color: 'bg-orange-500/10 border-orange-500/30',
    accentColor: 'text-orange-300',
    badgeColor: 'bg-orange-500/20 text-orange-200',
  },
  callout: {
    label: 'Callout',
    icon: Megaphone,
    color: 'bg-yellow-500/10 border-yellow-500/30',
    accentColor: 'text-yellow-300',
    badgeColor: 'bg-yellow-500/20 text-yellow-200',
  },
};

function getYouTubeEmbedUrl(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    let videoId = '';

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') || '';
      } else if (url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/')[2] || '';
      } else if (url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/')[2] || '';
      }
    } else if (host === 'youtu.be') {
      videoId = url.pathname.replace('/', '');
    }

    if (!videoId) return '';
    return `https://www.youtube.com/embed/${videoId}`;
  } catch {
    return '';
  }
}

function getModuleLayoutClass(align = 'left', paired = false) {
  if (paired) {
    return 'w-full max-w-none';
  }

  if (align === 'right') {
    return 'ml-auto max-w-[28rem]';
  }

  if (align === 'all') {
    return 'w-full';
  }

  return 'mr-auto max-w-[28rem]';
}

function getPictureFrameClass(align = 'left', paired = false) {
  if (paired) {
    return 'w-full max-w-none';
  }

  if (align === 'all') {
    return 'w-full';
  }

  return 'w-full max-w-[28rem]';
}

/**
 * FactModule - Highlights important facts/insights
 */
export function FactModule({ content, align = 'left', onEdit = null, onDelete = null }) {
  return (
    <div className="my-4 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align)}>
        <div
          className={`border rounded-lg p-4 ${MODULE_TYPES.fact.color} border-l-4 border-l-blue-500 space-y-2`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Lightbulb className={`h-4 w-4 ${MODULE_TYPES.fact.accentColor}`} />
              <span className={`font-bold text-sm ${MODULE_TYPES.fact.accentColor}`}>FACT</span>
            </div>
            {(onEdit || onDelete) && (
              <div className="flex gap-1">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="text-xs text-slate-400 hover:text-primary p-1"
                  >
                    ✎
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-xs text-slate-400 hover:text-red-400 p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{content}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * RecommendationModule - Highlights recommendations/best practices
 */
export function RecommendationModule({ content, align = 'left', onEdit = null, onDelete = null }) {
  return (
    <div className="my-4 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align)}>
        <div
          className={`border rounded-lg p-4 ${MODULE_TYPES.recommendation.color} border-l-4 border-l-emerald-500 space-y-2`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`h-4 w-4 ${MODULE_TYPES.recommendation.accentColor}`} />
              <span className={`font-bold text-sm ${MODULE_TYPES.recommendation.accentColor}`}>
                RECOMMENDATION
              </span>
            </div>
            {(onEdit || onDelete) && (
              <div className="flex gap-1">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="text-xs text-slate-400 hover:text-primary p-1"
                  >
                    ✎
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-xs text-slate-400 hover:text-red-400 p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{content}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * LinksModule - Grouped related links
 */
export function LinksModule({ links = [], align = 'left', onEdit = null, onDelete = null }) {
  const linksList = Array.isArray(links) ? links : [];
  return (
    <div className="my-4 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align)}>
        <div
          className={`border rounded-lg p-4 ${MODULE_TYPES.links.color} border-l-4 border-l-blue-500 space-y-2`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Link2 className={`h-4 w-4 ${MODULE_TYPES.links.accentColor}`} />
              <span className={`font-bold text-sm ${MODULE_TYPES.links.accentColor}`}>LINKS</span>
            </div>
            {(onEdit || onDelete) && (
              <div className="flex gap-1">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="text-xs text-slate-400 hover:text-primary p-1"
                  >
                    ✎
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-xs text-slate-400 hover:text-red-400 p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          <ul className="space-y-1">
            {linksList.map((link, i) => (
              <li key={i} className="text-sm">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  {link.title || link.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * PictureModule - Embedded image with caption
 */
export function PictureModule({
  imageUrl,
  caption = '',
  align = 'left',
  paired = false,
  onEdit = null,
  onDelete = null,
}) {
  return (
    <div className="my-4 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align, paired)}>
        <div
          className={`overflow-hidden rounded-lg border ${MODULE_TYPES.picture.color} ${getPictureFrameClass(align, paired)}`}
        >
          {imageUrl && (
            <div className="flex justify-center bg-black/10">
              <img
                src={resolveMediaUrl(imageUrl)}
                alt={caption || 'Module image'}
                className="block h-auto w-full object-contain"
              />
            </div>
          )}
          <div className="space-y-2 p-4">
            {caption && <p className="text-sm italic text-slate-300">{caption}</p>}
            {(onEdit || onDelete) && (
              <div className="flex gap-1">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="text-xs text-slate-400 hover:text-primary p-1"
                  >
                    ✎
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-xs text-slate-400 hover:text-red-400 p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SpacerModule - Visual spacer/divider
 */
export function SpacerModule({ style = 'gradient', height = 'h-1' }) {
  const spacerStyles = {
    gradient: 'bg-gradient-to-r from-slate-600 via-slate-500 to-slate-600/0',
    solid: 'bg-slate-600',
    dots: 'border-t-2 border-dotted border-slate-600',
    double: 'border-y border-slate-500 h-2 bg-transparent rounded-none',
    glow: 'bg-gradient-to-r from-primary/0 via-primary/60 to-primary/0 shadow-[0_0_18px_rgba(var(--primary-rgb),0.45)]',
    accent: 'bg-gradient-to-r from-primary via-primary/30 to-transparent',
  };

  return (
    <div className="w-full my-8">
      <div className={`${spacerStyles[style] || spacerStyles.gradient} ${height} rounded-full`} />
    </div>
  );
}

export function TextFrameModule({
  content,
  align = 'left',
  paired = false,
  onEdit = null,
  onDelete = null,
}) {
  return (
    <div className="my-4 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align, paired)}>
        <div
          className={`relative border rounded-lg p-4 ${MODULE_TYPES.text.color} border-l-4 border-l-sky-500`}
        >
          {(onEdit || onDelete) && (
            <div className="absolute right-2 top-2 flex gap-1">
              {onEdit && (
                <button onClick={onEdit} className="text-xs text-slate-400 hover:text-primary p-1">
                  ✎
                </button>
              )}
              {onDelete && (
                <button
                  onClick={onDelete}
                  className="text-xs text-slate-400 hover:text-red-400 p-1"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}

export function CodeModule({
  content,
  align = 'left',
  paired = false,
  onEdit = null,
  onDelete = null,
}) {
  return (
    <div className="my-4 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align, paired)}>
        <div
          className={`relative border rounded-lg p-4 ${MODULE_TYPES.code.color} border-l-4 border-l-indigo-500`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileCode2 className={`h-4 w-4 ${MODULE_TYPES.code.accentColor}`} />
              <span className={`font-bold text-sm ${MODULE_TYPES.code.accentColor}`}>CODE</span>
            </div>
            {(onEdit || onDelete) && (
              <div className="flex gap-1">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="text-xs text-slate-400 hover:text-primary p-1"
                  >
                    ✎
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-xs text-slate-400 hover:text-red-400 p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          <pre className="overflow-x-auto rounded-md border border-indigo-500/30 bg-black/30 p-3 text-xs leading-relaxed text-slate-200">
            <code>{content || ''}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

export function VideoModule({
  videoUrl,
  caption = '',
  align = 'left',
  paired = false,
  onEdit = null,
  onDelete = null,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const embedBaseUrl = useMemo(() => getYouTubeEmbedUrl(videoUrl), [videoUrl]);
  const embedUrl = embedBaseUrl ? `${embedBaseUrl}?autoplay=1&rel=0&modestbranding=1` : '';

  return (
    <div className="my-4 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align, paired)}>
        <div
          className={`relative overflow-hidden rounded-lg border ${MODULE_TYPES.video.color} ${getPictureFrameClass(align, paired)}`}
        >
          <div className={isExpanded ? 'mx-auto w-[50vw] min-w-[320px] max-w-full' : 'w-full'}>
            <div className="relative aspect-video w-full bg-black/40">
              {isPlaying && embedUrl ? (
                <iframe
                  src={embedUrl}
                  title={caption || 'Embedded YouTube video'}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  onDoubleClick={() => setIsExpanded((prev) => !prev)}
                />
              ) : (
                <button
                  type="button"
                  className="relative h-full w-full cursor-pointer"
                  onClick={() => setIsPlaying(true)}
                  onDoubleClick={() => {
                    setIsPlaying(true);
                    setIsExpanded((prev) => !prev);
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-900/80 via-slate-800/70 to-slate-900/85" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="inline-flex items-center gap-2 rounded-full border border-rose-300/40 bg-black/50 px-4 py-2 text-rose-100">
                      <Play className="h-4 w-4 fill-current" />
                      Click to play
                    </span>
                  </div>
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 p-4">
            {caption && <p className="text-sm italic text-slate-300">{caption}</p>}
            {!embedBaseUrl && (
              <p className="text-xs text-rose-200">
                Invalid YouTube URL. Use `youtube.com/watch?v=...` or `youtu.be/...`.
              </p>
            )}
            <p className="text-[11px] text-slate-400">
              Double-click video to toggle 50% screen mode.
            </p>
            {(onEdit || onDelete) && (
              <div className="flex gap-1">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="text-xs text-slate-400 hover:text-primary p-1"
                  >
                    ✎
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-xs text-slate-400 hover:text-red-400 p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Editor-only edit/delete affordance shared by the rich modules below. */
function ModuleActions({ onEdit = null, onDelete = null, className = '' }) {
  if (!onEdit && !onDelete) return null;
  return (
    <div className={`flex gap-1 ${className}`}>
      {onEdit && (
        <button
          type="button"
          aria-label="Edit module"
          onClick={onEdit}
          className="text-xs text-slate-400 hover:text-primary p-1"
        >
          ✎
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label="Delete module"
          onClick={onDelete}
          className="text-xs text-slate-400 hover:text-red-400 p-1"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/**
 * PullQuoteModule - Editorial pull quote in the Bookerly serif with a
 * provider-accent rule. Light/dark aware, unlike the legacy dark-only frames.
 */
export function PullQuoteModule({
  text,
  attribution = '',
  align = 'left',
  paired = false,
  onEdit = null,
  onDelete = null,
}) {
  return (
    <div className="my-6 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align, paired)}>
        <figure className="relative pl-5">
          <span
            aria-hidden="true"
            className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-gradient-to-b from-primary to-transparent"
          />
          <ModuleActions onEdit={onEdit} onDelete={onDelete} className="absolute right-0 top-0" />
          <blockquote
            className="text-xl md:text-2xl leading-snug text-slate-900 dark:text-white"
            style={{ fontFamily: 'var(--font-bookerly)' }}
          >
            {'“'}
            {text}
            {'”'}
          </blockquote>
          {attribution && (
            <figcaption className="eyebrow-label mt-3 text-slate-600 dark:text-slate-400">
              {attribution}
            </figcaption>
          )}
        </figure>
      </div>
    </div>
  );
}

/**
 * StatBoardModule - Row of StatBlock glass tiles (2-4). Always full width.
 */
export function StatBoardModule({ stats = [], onEdit = null, onDelete = null }) {
  const statList = (Array.isArray(stats) ? stats : []).filter(Boolean);
  const gridCols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' };
  return (
    <div className="my-6 w-full transition-all duration-200">
      <ModuleActions onEdit={onEdit} onDelete={onDelete} className="justify-end" />
      <div className={`grid grid-cols-1 gap-3 ${gridCols[statList.length] || 'sm:grid-cols-2'}`}>
        {statList.map((stat, i) => (
          <StatBlock
            key={i}
            value={stat.value}
            label={stat.sublabel ? `${stat.label} · ${stat.sublabel}` : stat.label}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * ComparisonModule - Glass-framed comparison table. Always full width.
 */
export function ComparisonModule({ columns = [], rows = [], onEdit = null, onDelete = null }) {
  const columnList = Array.isArray(columns) ? columns : [];
  const rowList = Array.isArray(rows) ? rows : [];
  return (
    <div className="my-6 w-full transition-all duration-200">
      <ModuleActions onEdit={onEdit} onDelete={onDelete} className="justify-end" />
      <div className="glass rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10">
              {columnList.map((column, i) => (
                <th
                  key={i}
                  className="eyebrow-label px-4 py-3 text-left text-slate-600 dark:text-slate-400"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowList.map((row, rIdx) => (
              <tr
                key={rIdx}
                className="border-b border-slate-100 last:border-0 dark:border-white/5"
              >
                {(Array.isArray(row) ? row : []).map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    className={`px-4 py-3 align-top ${
                      cIdx === 0
                        ? 'font-medium text-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * TimelineModule - Vertical step list with NumberedSection-style zero-padded
 * markers. Always full width.
 */
export function TimelineModule({ steps = [], onEdit = null, onDelete = null }) {
  const stepList = (Array.isArray(steps) ? steps : []).filter(Boolean);
  return (
    <div className="my-6 w-full transition-all duration-200">
      <ModuleActions onEdit={onEdit} onDelete={onDelete} className="justify-end" />
      <ol className="space-y-0">
        {stepList.map((step, i) => (
          <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
            {i < stepList.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[1.05rem] top-8 bottom-0 w-px bg-slate-200 dark:bg-white/10"
              />
            )}
            <span className="section-number shrink-0 text-2xl text-primary dark:text-(--slate-blue)">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-medium text-slate-900 dark:text-white">{step.title}</p>
              {step.body && (
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {step.body}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * CalloutModule - Eyebrow-labelled glass frame for asides worth a border.
 */
export function CalloutModule({
  eyebrow = '',
  title,
  body,
  align = 'left',
  paired = false,
  onEdit = null,
  onDelete = null,
}) {
  return (
    <div className="my-6 w-full transition-all duration-200">
      <div className={getModuleLayoutClass(align, paired)}>
        <div className="glass relative rounded-xl border-l-4 border-l-primary p-5">
          <ModuleActions onEdit={onEdit} onDelete={onDelete} className="absolute right-2 top-2" />
          <Eyebrow>{eyebrow || 'Note'}</Eyebrow>
          <p className="mt-2 font-medium text-slate-900 dark:text-white">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * DesignModule - Mermaid diagram source. Renders the source in a labelled
 * mono frame; client-side mermaid rendering is backlog. This exists so a
 * design module renders *something* instead of null (the old behavior
 * silently destroyed the diagram on round-trip).
 */
export function DesignModule({ content, onEdit = null, onDelete = null }) {
  return (
    <div className="my-6 w-full transition-all duration-200">
      <div className="glass relative rounded-xl p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" />
            <span className="eyebrow-label text-slate-600 dark:text-slate-400">
              Diagram (Mermaid)
            </span>
          </div>
          <ModuleActions onEdit={onEdit} onDelete={onDelete} />
        </div>
        <pre className="overflow-x-auto rounded-md bg-slate-100 p-3 text-xs leading-relaxed text-slate-800 dark:bg-black/30 dark:text-slate-200">
          <code>{content || ''}</code>
        </pre>
      </div>
    </div>
  );
}

/**
 * ModuleContainer - Display module with inline text wrapping
 * Used to render a single module from parsed data
 */
export function ModuleContainer({
  type,
  data,
  align = 'left',
  paired = false,
  onEdit = null,
  onDelete = null,
  ...inlineData
}) {
  const moduleData = data || inlineData || {};

  switch (type) {
    case 'fact':
      return (
        <FactModule
          content={moduleData.content}
          align={align}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    case 'recommendation':
      return (
        <RecommendationModule
          content={moduleData.content}
          align={align}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    case 'links':
      return (
        <LinksModule links={moduleData.links} align={align} onEdit={onEdit} onDelete={onDelete} />
      );
    case 'picture':
      return (
        <PictureModule
          imageUrl={moduleData.imageUrl}
          caption={moduleData.caption}
          align={align}
          paired={paired}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    case 'spacer':
      return <SpacerModule style={moduleData.style} height={moduleData.height} />;
    case 'video':
      return (
        <VideoModule
          videoUrl={moduleData.videoUrl}
          caption={moduleData.caption}
          align={align}
          paired={paired}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    case 'text':
      return (
        <TextFrameModule
          content={moduleData.content}
          align={align}
          paired={paired}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    case 'code':
      return (
        <CodeModule
          content={moduleData.content}
          align={align}
          paired={paired}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    default:
      return renderRichModule({ type, moduleData, align, paired, onEdit, onDelete });
  }
}

/** The Phase 4 rich types, split out of ModuleContainer's switch. */
function renderRichModule({ type, moduleData, align, paired, onEdit, onDelete }) {
  switch (type) {
    case 'design':
      return <DesignModule content={moduleData.content} onEdit={onEdit} onDelete={onDelete} />;
    case 'pull_quote':
      return (
        <PullQuoteModule
          text={moduleData.text}
          attribution={moduleData.attribution}
          align={align}
          paired={paired}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    case 'stat_board':
      return <StatBoardModule stats={moduleData.stats} onEdit={onEdit} onDelete={onDelete} />;
    case 'comparison':
      return (
        <ComparisonModule
          columns={moduleData.columns}
          rows={moduleData.rows}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    case 'timeline':
      return <TimelineModule steps={moduleData.steps} onEdit={onEdit} onDelete={onDelete} />;
    case 'callout':
      return (
        <CalloutModule
          eyebrow={moduleData.eyebrow}
          title={moduleData.title}
          body={moduleData.body}
          align={align}
          paired={paired}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    default:
      return null;
  }
}
