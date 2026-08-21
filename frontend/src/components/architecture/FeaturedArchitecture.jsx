/**
 * The featured panel that used to sit at the top of every bespoke architecture
 * gallery — hand-written three times, with the AWS and Azure copies hardcoding
 * one blueprint's copy directly in JSX so the panel could never reflect what was
 * actually published.
 *
 * Here it is data-driven: the page passes whichever design is featured, falling
 * back to the provider's editorial entry. Composed rather than absorbed into
 * ContentListingTemplate, since GCP and VMware have no featured design to show.
 */
import React from 'react';
import { colorClasses } from '@/lib/colorClasses';

const METRIC_LABELS = { rpo: 'RPO', rto: 'RTO', level: 'Level', waf: 'WAF', cost: 'Cost' };

function metricValue(key, value) {
  if (value === undefined || value === null || value === '') return null;
  return key === 'waf' ? `${value}%` : String(value);
}

export default function FeaturedArchitecture({
  design,
  eyebrow = null,
  badges = [],
  actionLabel = 'Explore Blueprint',
  // Same set as the cards — see ContentListingTemplate. `level` is not a tile
  // here because the eyebrow above already states it.
  metrics = ['waf', 'rpo', 'rto'],
  onOpen = null,
}) {
  if (!design) return null;

  const tiles = metrics
    .map((key) => [key, METRIC_LABELS[key] || key, metricValue(key, design[key])])
    .filter(([, , value]) => value !== null);

  const eyebrowText =
    eyebrow ||
    [design.category, design.level && `LEVEL ${design.level}`].filter(Boolean).join(' • ') ||
    'FEATURED DESIGN';

  return (
    <div className="glass-panel rounded-2xl overflow-hidden relative group">
      <div className="absolute top-0 right-0 p-4 z-20">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-black text-xs font-bold uppercase tracking-wide shadow-lg shadow-primary/20">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            star
          </span>
          Featured Design
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-0">
        <div className="p-8 md:p-10 flex flex-col justify-center relative z-10">
          <div className="flex items-center gap-2 mb-4 text-primary font-mono text-xs uppercase">
            {design.icon && (
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                {design.icon}
              </span>
            )}
            {eyebrowText}
          </div>
          <h2 className="text-3xl font-bold text-white mb-4 leading-tight">{design.title}</h2>
          <p className="text-slate-300 text-sm leading-relaxed mb-6">{design.description}</p>

          {badges.length > 0 && (
            <div className="flex flex-wrap gap-4 mb-8">
              {badges.map((badge) => (
                <div
                  key={badge.label}
                  className="flex items-center gap-2 text-xs text-slate-400 bg-black/20 px-3 py-1.5 rounded-lg border border-white/5"
                >
                  <span
                    className={`material-symbols-outlined text-[16px] ${colorClasses(badge.tone).text}`}
                    aria-hidden="true"
                  >
                    {badge.icon}
                  </span>
                  {badge.label}
                </div>
              ))}
            </div>
          )}

          {tiles.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-8">
              {tiles.map(([key, label, value]) => (
                <div key={key} className="bg-slate-900/50 rounded-lg p-3">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">{label}</span>
                  <p className="text-xl font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          )}

          {design.slug && onOpen && (
            <button
              type="button"
              className="bg-primary hover:bg-primary/90 text-black font-bold px-6 h-11 rounded-lg transition-all shadow-lg shadow-primary/20 flex items-center gap-2 w-fit"
              onClick={() => onOpen(design)}
            >
              {actionLabel}
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                arrow_forward
              </span>
            </button>
          )}
        </div>
        <div className="bg-gradient-to-br from-[hsl(var(--hcw-bg-secondary))] to-[hsl(var(--background))] relative overflow-hidden flex items-center justify-center p-8 border-l border-white/5">
          <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl"></div>
          <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border-dark shadow-2xl transform rotate-1 transition-transform group-hover:rotate-0 duration-500">
            <div className="w-full h-full flex items-center justify-center bg-[hsl(var(--background))]">
              <span
                className="material-symbols-outlined text-slate-600 text-[64px]"
                aria-hidden="true"
              >
                {design.icon || 'architecture'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
