/**
 * A certification hub's featured credential beside its sidebar: the
 * recommended starting point with its topics and study time, the list of
 * every certification in the catalogue with a level legend, and the
 * "Getting Started" card. The Terraform, GCP, GitHub and FinOps hubs each
 * rendered this from their own copy of the same JSX; the copy and colours
 * that differed between them arrive as props (see the TONE constant in each
 * page), and the markup lives once, here.
 */
import React from 'react';

/** One line of the "All Certifications" list: level dot, code, title. */
function CatalogueRow({ cert, dot }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-card/50 transition-colors">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground line-clamp-1">{cert.code}</div>
        <div className="text-xs text-foreground/50 line-clamp-1">{cert.title}</div>
      </div>
    </div>
  );
}

export default function FeaturedCertSection({
  featuredCert,
  certifications,
  levelMeta,
  allCerts,
  gettingStarted,
  tone,
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 mb-16">
      {featuredCert && (
        <article
          className={`bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl overflow-hidden ${tone.articleHover} transition-all duration-300`}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="p-8 flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center gap-3 flex-wrap">
                  <span className={`px-3 py-1 ${tone.badge} text-xs font-bold rounded`}>
                    Recommended Starting Point
                  </span>
                  <span
                    className={`px-3 py-1 border text-xs font-bold rounded ${levelMeta[featuredCert.level].badge}`}
                  >
                    {featuredCert.level}
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white mb-1">
                  {featuredCert.title}
                </h2>
                <div className="text-sm font-mono text-foreground/50 mb-3">{featuredCert.code}</div>
                <p className="text-foreground mb-6">{featuredCert.description}</p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">
                  Topics Covered
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-8">
                  {featuredCert.topics.map((topic, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className={`${tone.accentText} material-symbols-outlined text-[16px]`}
                        aria-hidden="true"
                      >
                        check_circle
                      </span>
                      <span className="text-foreground text-sm">{topic}</span>
                    </div>
                  ))}
                </div>
                <a
                  href={featuredCert.learnUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block w-full h-11 px-4 ${tone.button} font-bold rounded-lg transition-colors text-center leading-11`}
                >
                  Start Preparation
                </a>
              </div>
            </div>
            <div className="bg-card/60 p-8 flex flex-col justify-between">
              <div className="space-y-6">
                <div className="text-center">
                  <div className={`text-4xl font-bold ${tone.accentText} mb-2`}>
                    {featuredCert.hours}
                  </div>
                  <div className="text-sm text-foreground">Hours of Study</div>
                </div>
                <div className="border-t border-slate-700 pt-6 text-center">
                  <div className="text-sm text-foreground mb-2">Estimated Preparation</div>
                  <div className="text-2xl font-bold text-slate-950 dark:text-white">
                    {featuredCert.prepTime}
                  </div>
                </div>
              </div>
              <div className="pt-6 border-t border-slate-700">
                <a
                  href={allCerts.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full h-11 px-4 bg-card/50 hover:bg-card/70 text-foreground font-semibold rounded-lg transition-colors text-sm text-center leading-11"
                >
                  {allCerts.label}
                </a>
              </div>
            </div>
          </div>
        </article>
      )}

      {/* Sidebar */}
      <aside className="h-fit sticky top-28 space-y-6">
        <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-slate-950 dark:text-white mb-4 flex items-center gap-2">
            <span
              className={`${tone.accentText} text-[20px] material-symbols-outlined`}
              aria-hidden="true"
            >
              emoji_events
            </span>
            All Certifications
          </h3>
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {certifications.map((cert) => (
              <CatalogueRow key={cert.id} cert={cert} dot={levelMeta[cert.level].dot} />
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-1.5">
            {Object.entries(levelMeta).map(([level, meta]) => (
              <div key={level} className="flex items-center gap-1.5 text-xs text-foreground/60">
                <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                {level}
              </div>
            ))}
          </div>
        </div>

        <div className={`${tone.gettingStartedCard} rounded-2xl p-6`}>
          <h3 className="text-lg font-bold text-slate-950 dark:text-white mb-2 flex items-center gap-2">
            <span
              className={`${tone.accentText} text-[20px] material-symbols-outlined`}
              aria-hidden="true"
            >
              rocket_launch
            </span>
            Getting Started
          </h3>
          <p className="text-sm text-foreground mb-4">{gettingStarted.text}</p>
          <a
            href={gettingStarted.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`block w-full h-11 px-4 ${tone.button} font-bold rounded-lg transition-colors text-sm text-center leading-11`}
          >
            {gettingStarted.label}
          </a>
        </div>
      </aside>
    </section>
  );
}
