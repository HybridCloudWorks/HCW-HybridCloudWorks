/**
 * The data-driven body of a provider education page: certification tracks
 * with a level filter, learning paths, and resources — rendered from the
 * `data/<provider>/education.js` files Site-Main extracted (T-409).
 *
 * Site-Main renders these through a 712-line EducationTemplate that also
 * carries the hero, sidebar and official-resource rails the Azure/AWS pages
 * here still keep inline (D2 — a refactor the visitor cannot see). This is
 * the part a visitor CAN see: the Ansible and VMware tracks, paths and
 * resources that were three-card stubs before.
 */
import React, { useMemo, useState } from 'react';

function LevelBadge({ level, levelMeta }) {
  const meta = levelMeta?.[level];
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
        meta?.badge || 'bg-slate-500/20 border-slate-500/40 text-slate-300'
      }`}
    >
      {meta?.label || level}
    </span>
  );
}

export default function EducationTracks({
  certifications = [],
  learningPaths = [],
  resources = [],
  levelMeta = {},
  filterLevels = ['All'],
}) {
  const [level, setLevel] = useState('All');
  const visible = useMemo(
    () => (level === 'All' ? certifications : certifications.filter((c) => c.level === level)),
    [certifications, level]
  );

  return (
    <div className="flex flex-col gap-12">
      <section aria-label="Certification tracks">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-1 h-6 bg-primary rounded-full" aria-hidden="true"></span>
            Certification Tracks
          </h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by level">
            {filterLevels.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLevel(option)}
                aria-pressed={level === option}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  level === option
                    ? 'bg-primary text-black border-primary'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-primary/60'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((cert) => (
            <a
              key={cert.id || cert.code}
              href={cert.learnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`glass glass-hover rounded-xl p-5 flex flex-col gap-3 border-l-4 ${
                levelMeta?.[cert.level]?.accent || 'border-l-slate-500'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black text-primary tracking-widest uppercase">
                  {cert.code}
                </span>
                <LevelBadge level={cert.level} levelMeta={levelMeta} />
              </div>
              <h3 className="text-sm font-bold text-foreground leading-snug">{cert.title}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {cert.description}
              </p>
              {Array.isArray(cert.topics) && cert.topics.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {cert.topics.map((topic) => (
                    <span
                      key={topic}
                      className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-auto flex items-center gap-3 text-[10px] text-slate-500">
                {cert.hours ? <span>{cert.hours} h</span> : null}
                {cert.prepTime ? <span>{cert.prepTime}</span> : null}
                {cert.status && cert.status !== 'active' ? (
                  <span className="uppercase">{cert.status}</span>
                ) : null}
              </div>
            </a>
          ))}
          {visible.length === 0 && (
            <p className="text-sm text-slate-500 col-span-full">No tracks at this level yet.</p>
          )}
        </div>
      </section>

      {learningPaths.length > 0 && (
        <section aria-label="Learning paths">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-6">
            <span className="w-1 h-6 bg-primary rounded-full" aria-hidden="true"></span>
            Learning Paths
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {learningPaths.map((path) => (
              <div key={path.id} className="glass rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black text-primary tracking-widest uppercase">
                    {path.certCode}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {path.level}
                    {path.hours ? ` · ${path.hours} h` : ''}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-foreground">{path.title}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">{path.description}</p>
                {Array.isArray(path.modules) && path.modules.length > 0 && (
                  <ol className="list-decimal list-inside text-xs text-slate-700 dark:text-slate-300 space-y-1">
                    {path.modules.map((m) => (
                      <li key={m.title}>{m.title}</li>
                    ))}
                  </ol>
                )}
                {path.certUrl && (
                  <a
                    href={path.certUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto text-xs font-semibold text-primary hover:underline"
                  >
                    View {path.certCode} details ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {resources.length > 0 && (
        <section aria-label="Resources">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-6">
            <span className="w-1 h-6 bg-primary rounded-full" aria-hidden="true"></span>
            Resources
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {resources.map((resource) => (
              <a
                key={resource.id}
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glass glass-hover rounded-xl p-5 flex gap-3"
              >
                <div className="size-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                  <span
                    className="material-symbols-outlined text-primary text-base"
                    aria-hidden="true"
                  >
                    {resource.icon || 'link'}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                    {resource.type}
                  </div>
                  <h3 className="text-sm font-bold text-foreground leading-snug">
                    {resource.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {resource.description}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
