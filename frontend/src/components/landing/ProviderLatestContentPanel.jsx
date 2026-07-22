import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { routes } from '@/lib/routeFactory';
import { useProviderLandingContent } from '@/hooks/useProviderLandingContent';

const SECTION_LINKS = [{ label: 'Blogs', routeKey: 'blog' }];

export default function ProviderLatestContentPanel({
  provider,
  accentClassName = 'text-primary',
  badgeClassName = 'bg-primary/20 text-primary',
  tagClassName = 'bg-primary/10 text-primary',
  className = '',
  title = 'Latest Published Content',
}) {
  const { items, loading } = useProviderLandingContent(provider);
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActiveIndex = items.length > 0 ? activeIndex % items.length : 0;

  useEffect(() => {
    if (items.length <= 1) return undefined;
    const timer = setInterval(() => {
      setActiveIndex((index) => (index + 1) % items.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [items.length]);

  const currentItem = useMemo(() => items[safeActiveIndex] || null, [items, safeActiveIndex]);

  return (
    <div className={`glass-card rounded-xl p-6 flex flex-col gap-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`material-symbols-outlined ${accentClassName}`}>article</span>
          <h3 className="text-lg sm:text-xl font-bold text-foreground">{title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SECTION_LINKS.map((item) => {
            const to = routes[item.routeKey](provider);
            return (
              <Link
                key={item.label}
                to={to}
                className={`inline-flex items-center gap-1 text-sm font-semibold hover:underline ${accentClassName}`}
              >
                {item.label}
                <span className="material-symbols-outlined text-xs">open_in_new</span>
              </Link>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-glass-border bg-white/70 dark:bg-surface-dark/40">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {!loading && !currentItem && (
        <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-glass-border bg-white/70 px-6 text-center text-sm text-slate-500 dark:bg-surface-dark/40 dark:text-slate-400">
          No live provider content found yet.
        </div>
      )}

      {!loading && currentItem && (
        <a
          href={currentItem.publicUrl}
          className="flex-1 flex flex-col gap-3 rounded-lg border border-glass-border bg-white/70 p-4 transition-colors hover:border-primary/40 dark:bg-surface-dark/40"
        >
          <div className="flex items-center justify-between gap-3">
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide ${badgeClassName}`}
            >
              {currentItem.contentTypeLabel}
            </span>
            <span className="text-[10px] text-slate-500">{currentItem.dateLabel}</span>
          </div>
          <h4 className="text-base font-bold leading-snug text-foreground">{currentItem.title}</h4>
          <p className="flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {currentItem.summary || 'Published from the HCW ContentForge workflow.'}
          </p>
          <div className="flex items-center justify-between gap-3 border-t border-glass-border pt-2">
            <div className="flex gap-1 flex-wrap">
              {currentItem.tags.length > 0 ? (
                currentItem.tags.map((tag) => (
                  <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded ${tagClassName}`}>
                    {tag}
                  </span>
                ))
              ) : (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${tagClassName}`}>
                  {currentItem.contentTypeLabel}
                </span>
              )}
            </div>
            <span className={`text-xs font-semibold ${accentClassName}`}>Open page</span>
          </div>
        </a>
      )}

      {items.length > 1 && (
        <div
          className="flex items-center justify-center gap-2"
          role="tablist"
          aria-label="Live content carousel"
        >
          {items.slice(0, 8).map((item, index) => (
            <button
              key={item.publicUrl}
              type="button"
              role="tab"
              aria-selected={index === safeActiveIndex}
              aria-label={`Show content item ${index + 1}`}
              onClick={() => setActiveIndex(index)}
              className={`h-1.5 rounded-full transition-all ${
                index === safeActiveIndex
                  ? 'w-5 bg-primary'
                  : 'w-1.5 bg-slate-400 dark:bg-slate-600'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
