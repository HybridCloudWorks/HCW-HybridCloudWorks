/**
 * The filter row and the card grid of a certification hub's "Browse
 * Certifications" carousel — the part the Terraform, GCP and GitHub hubs
 * each rendered from their own copy of the same JSX. The page keeps the
 * heading and the pagination, which own the state; this renders one page of
 * cards. `tone` carries the hub's colour classes (see the TONE constant in
 * each page), so the markup here names no colour and each hub's palette
 * stays in that hub.
 */
import React from 'react';
import CertStatusBadge from '@/components/education/CertStatusBadge';

const IDLE_FILTER =
  'bg-card/30 border-card/50 text-foreground/60 hover:text-foreground hover:border-foreground/40';

/** One row of filter pills; `classFor` gives each option its state classes. */
function FilterRow({ options, onSelect, classFor }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onSelect(option)}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${classFor(option)}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function CertCard({ cert, meta, today, tone }) {
  return (
    <article
      className={`group bg-card/40 backdrop-blur-md border border-card/50 border-l-4 ${meta.accent} rounded-2xl p-6 ${tone.cardHover} transition-all duration-300 flex flex-col`}
    >
      <div className="flex items-start justify-between mb-2 gap-1 flex-wrap">
        <span className={`px-2.5 py-1 border text-[10px] font-bold rounded ${meta.badge}`}>
          {cert.level}
        </span>
        <span className="text-xs text-foreground/50 font-mono">{cert.hours}h</span>
      </div>
      <CertStatusBadge cert={cert} today={today} className="self-start mb-2" />
      <div className="text-xs font-mono text-foreground/40 mb-1">{cert.code}</div>
      <h3
        className={`text-sm font-bold text-slate-950 dark:text-white mb-2 line-clamp-3 ${tone.titleHover} transition-colors flex-1`}
      >
        {cert.title}
      </h3>
      <p className="text-xs text-foreground mb-4 line-clamp-2">{cert.description}</p>
      <div className="flex flex-wrap gap-1 mb-4">
        {cert.topics.slice(0, 2).map((topic, i) => (
          <span
            key={i}
            className="px-2 py-0.5 bg-card/50 text-foreground/60 text-[10px] rounded-full"
          >
            {topic}
          </span>
        ))}
      </div>
      <div className="mt-auto flex gap-2">
        <a
          href={cert.learnUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex-1 h-9 bg-card/50 ${tone.linkHover} text-foreground rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1`}
        >
          View Details
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
            open_in_new
          </span>
        </a>
      </div>
    </article>
  );
}

export default function CertificationBrowser({
  filterLevels,
  statusFilters,
  levelFilter,
  statusFilter,
  onLevelFilter,
  onStatusFilter,
  getLevelFilterClass,
  levelMeta,
  certs,
  today,
  tone,
}) {
  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <FilterRow
          options={filterLevels}
          onSelect={onLevelFilter}
          classFor={(level) => getLevelFilterClass(levelFilter, level)}
        />
        <div className="w-px bg-card/50 hidden sm:block" />
        <FilterRow
          options={statusFilters}
          onSelect={onStatusFilter}
          classFor={(s) => (statusFilter === s ? tone.activeFilter : IDLE_FILTER)}
        />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 min-h-55">
        {certs.length === 0 ? (
          <div className="col-span-4 flex items-center justify-center py-16 text-foreground/50">
            No certifications match the selected filters.
          </div>
        ) : (
          certs.map((cert) => (
            <CertCard
              key={cert.id}
              cert={cert}
              meta={levelMeta[cert.level]}
              today={today}
              tone={tone}
            />
          ))
        )}
      </div>
    </>
  );
}
