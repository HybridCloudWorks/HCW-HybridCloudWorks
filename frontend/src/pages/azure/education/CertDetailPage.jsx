import React from 'react';
import { useParams, Link } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { getProviderPath, routes } from '@/lib/routeFactory';
import ListenAndLearn from '@/components/education/ListenAndLearn';
import { DATA_AS_OF, certifications } from '@/data/azure/certifications';
import { deriveStatus, formatIsoDate, useToday } from '@/lib/certStatus';

// ── Presentation ────────────────────────────────────────────────────────────
//
// The certification data itself is the shared catalogue in
// data/azure/certifications.js — the same array the landing page links from.
// Until 2026-09-09 this file carried its own 15-entry copy, so 86 of the
// landing page's links opened "Certification Not Found" (#461 item 2).

const LEVEL_META = {
  Fundamentals: {
    badge: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
    accent: 'from-sky-900/30',
    glow: 'rgba(14,165,233,0.15)',
    label: 'Fundamentals',
  },
  Associate: {
    badge: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    accent: 'from-emerald-900/30',
    glow: 'rgba(16,185,129,0.15)',
    label: 'Associate',
  },
  Expert: {
    badge: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
    accent: 'from-violet-900/30',
    glow: 'rgba(139,92,246,0.15)',
    label: 'Expert',
  },
  Specialty: {
    badge: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
    accent: 'from-amber-900/30',
    glow: 'rgba(245,158,11,0.15)',
    label: 'Specialty',
  },
};

function getNextCertDotClass(level) {
  switch (level) {
    case 'Fundamentals':
      return 'bg-sky-500';
    case 'Associate':
      return 'bg-emerald-500';
    case 'Expert':
      return 'bg-violet-500';
    default:
      return 'bg-amber-500';
  }
}

const formatDate = formatIsoDate;

/**
 * The one line a reader must not miss: retired, retiring, or beta — derived
 * from the dates so it cannot outlive them. Nothing for an active exam.
 */
function StatusNotice({ status, cert, replacement }) {
  if (status === 'active') return null;
  const styles = {
    retired: 'bg-slate-500/15 border-slate-500/40 text-slate-200',
    expiring: 'bg-rose-500/15 border-rose-500/40 text-rose-200',
    beta: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  };
  const icons = { retired: 'block', expiring: 'schedule', beta: 'science' };
  let text;
  if (status === 'retired') {
    text = cert.expiryDate
      ? `Retired by Microsoft on ${formatDate(cert.expiryDate)}. It can no longer be scheduled.`
      : 'Withdrawn by Microsoft. It can no longer be scheduled.';
  } else if (status === 'expiring') {
    text = `Retires on ${formatDate(cert.expiryDate)}. Schedule it before then or plan for the replacement.`;
  } else {
    text = cert.betaEndDate
      ? `Beta exam — the beta period ends ${formatDate(cert.betaEndDate)}.`
      : 'Beta exam — scores are released after the beta period closes.';
  }
  return (
    <div
      role="status"
      data-testid="cert-status-notice"
      data-status={status}
      className={`mb-6 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm ${styles[status]}`}
    >
      <span className="material-symbols-outlined text-[18px]">{icons[status]}</span>
      <span className="font-semibold capitalize">{status}.</span>
      <span>{text}</span>
      {replacement && (
        <Link
          to={getProviderPath('azure', `education/${replacement.slug}`)}
          className="font-semibold underline underline-offset-2 hover:text-white"
        >
          Replaced by {replacement.code}: {replacement.title.replace(/Microsoft\s+/i, '')}
        </Link>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CertDetailPage() {
  const { certSlug } = useParams();
  const cert = certifications.find((c) => c.slug === certSlug);
  // DATA_AS_OF on the pre-rendered and hydrating render, the real date after
  // mount — before the early return, since hooks must run in the same order.
  const today = useToday(DATA_AS_OF);

  if (!cert) {
    return (
      <main className="grow pt-28 pb-20 px-4 md:px-8 max-w-360 mx-auto w-full">
        <div className="text-center py-20">
          <span className="text-primary text-[64px] material-symbols-outlined mb-4 block">
            search_off
          </span>
          <h1 className="text-3xl font-bold text-white mb-4">Certification Not Found</h1>
          <p className="text-foreground mb-8">
            The certification <code className="font-mono text-primary">{certSlug}</code> was not
            found.
          </p>
          <Link
            to={routes.education('azure')}
            className="px-6 h-11 bg-primary hover:bg-blue-800 text-white font-bold rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Azure Education
          </Link>
        </div>
      </main>
    );
  }

  const meta = LEVEL_META[cert.level];
  const status = deriveStatus(cert, today);
  const replacement = cert.replacedBy
    ? certifications.find((c) => c.slug === cert.replacedBy) || null
    : null;
  const nextCerts = certifications.filter((c) => cert.nextCerts?.includes(c.slug));

  return (
    <>
      <Helmet>
        {/* One string child: react-helmet-async drops a title made of several
            JSX children, which is why every pre-rendered detail page had an
            empty <title> the first time these routes were built. */}
        <title>{`${cert.code}: ${cert.title} | Azure Education | HCW`}</title>
        <meta name="description" content={cert.description} />
        <meta property="og:title" content={`${cert.code}: ${cert.title}`} />
        <meta property="og:description" content={cert.longDescription} />
      </Helmet>

      <main className="grow pt-28 pb-20 px-4 md:px-8 max-w-360 mx-auto w-full">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-foreground/60 mb-8">
          <Link to={routes.education('azure')} className="hover:text-primary transition-colors">
            Azure Education
          </Link>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-foreground">{cert.code}</span>
        </nav>

        {/* Hero */}
        <section
          className={`mb-10 bg-linear-to-br ${meta.accent} to-card/20 backdrop-blur-md border border-card/40 rounded-2xl p-8 relative overflow-hidden`}
        >
          <div
            className="absolute -top-10 -right-10 w-64 h-64 rounded-full blur-3xl pointer-events-none"
            style={{ background: `radial-gradient(circle, ${meta.glow} 0%, transparent 70%)` }}
          />
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className={`px-3 py-1 border text-xs font-bold rounded ${meta.badge}`}>
                {cert.level}
              </span>
              <span className="text-sm font-mono text-foreground/60">{cert.code}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">{cert.title}</h1>
            <StatusNotice status={status} cert={cert} replacement={replacement} />
            <p className="text-foreground text-lg max-w-3xl mb-6">{cert.longDescription}</p>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <div className="text-foreground/60 mb-0.5">Study Hours</div>
                <div className="text-2xl font-bold text-primary">{cert.hours}h</div>
              </div>
              <div>
                <div className="text-foreground/60 mb-0.5">Prep Time</div>
                <div className="text-2xl font-bold text-white">{cert.prepTime}</div>
              </div>
              {cert.successRate && (
                <div>
                  <div className="text-foreground/60 mb-0.5">Avg. Pass Rate</div>
                  <div className="text-2xl font-bold text-cyan-400">{cert.successRate}</div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          <div className="space-y-8">
            {/* Listen & Learn — renders nothing until an episode is approved. */}
            <ListenAndLearn
              platform="azure"
              examCode={cert.code}
              studyGuideUrl={cert.studyGuideUrl}
            />

            {/* Topics */}
            <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-primary material-symbols-outlined text-[20px]">category</span>
                Topics Covered
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {cert.topics.map((topic, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-card/50 rounded-xl px-3 py-2.5"
                  >
                    <span className="text-primary material-symbols-outlined text-[16px]">
                      check_circle
                    </span>
                    <span className="text-foreground text-sm">{topic}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Microsoft Learn Modules — only when the catalogue lists any; an
                empty section under a heading reads as broken. */}
            {cert.modules?.length > 0 && (
              <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <span className="text-primary material-symbols-outlined text-[20px]">
                    menu_book
                  </span>
                  Microsoft Learn Modules
                </h2>
                <div className="space-y-3">
                  {cert.modules.map((mod, i) => (
                    <a
                      key={i}
                      href={mod.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 group bg-card/40 hover:bg-card/60 border border-card/30 hover:border-primary/30 rounded-xl px-4 py-3 transition-all"
                    >
                      <span className="shrink-0 w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <span className="text-sm text-foreground group-hover:text-primary transition-colors flex-1">
                        {mod.title}
                      </span>
                      <span className="material-symbols-outlined text-[14px] text-foreground/40 group-hover:text-primary transition-colors shrink-0">
                        open_in_new
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Applied Skills */}
            {cert.appliedSkills?.length > 0 && (
              <section className="bg-card/40 backdrop-blur-md border border-cyan-500/20 rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                  <span className="text-cyan-400 material-symbols-outlined text-[20px]">
                    construction
                  </span>
                  Associated Applied Skills
                </h2>
                <p className="text-sm text-foreground/70 mb-4">
                  Scenario-based assessments that complement this certification with hands-on proof.
                </p>
                <div className="space-y-3">
                  {cert.appliedSkills.map((skill, i) => (
                    <a
                      key={i}
                      href={skill.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 group bg-card/40 hover:bg-cyan-900/20 border border-card/30 hover:border-cyan-500/30 rounded-xl px-4 py-3 transition-all"
                    >
                      <span className="text-cyan-400 material-symbols-outlined text-[18px] shrink-0 mt-0.5">
                        verified
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-mono text-foreground/50 mb-0.5">
                          {skill.code}
                        </div>
                        <div className="text-sm font-semibold text-foreground group-hover:text-cyan-300 transition-colors">
                          {skill.title}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-[14px] text-foreground/40 group-hover:text-cyan-300 transition-colors shrink-0 mt-1">
                        open_in_new
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* What's Next */}
            {nextCerts.length > 0 && (
              <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <span className="text-primary material-symbols-outlined text-[20px]">
                    trending_up
                  </span>
                  What to Study Next
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {nextCerts.map((next) => (
                    <Link
                      key={next.slug}
                      to={getProviderPath('azure', `education/${next.slug}`)}
                      className="group flex items-center gap-3 bg-card/40 hover:bg-card/60 border border-card/30 hover:border-primary/30 rounded-xl px-4 py-3 transition-all"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${getNextCertDotClass(next.level)}`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-foreground/50">{next.code}</div>
                        <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                          {next.title.replace(/Microsoft\s+/i, '')}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-[16px] text-foreground/40 group-hover:text-primary transition-colors ml-auto shrink-0">
                        arrow_forward
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-6 h-fit sticky top-28">
            {/* CTA */}
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6 space-y-3">
              <a
                href={cert.learnUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full h-11 bg-primary hover:bg-blue-800 text-white font-bold rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                View on Microsoft Learn
              </a>
              {cert.studyGuideUrl && (
                <a
                  href={cert.studyGuideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full h-11 bg-card/50 hover:bg-card/70 text-foreground font-semibold rounded-lg transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">description</span>
                  Official Study Guide
                </a>
              )}
              {cert.practiceUrl && (
                <a
                  href={cert.practiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full h-11 bg-card/50 hover:bg-card/70 text-foreground font-semibold rounded-lg transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">quiz</span>
                  Free Practice Assessment
                </a>
              )}
            </div>

            {/* Prerequisites */}
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-primary material-symbols-outlined text-[18px]">info</span>
                Prerequisites
              </h3>
              <p className="text-sm text-foreground">{cert.prerequisites}</p>
            </div>

            {/* Quick Stats */}
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white">Quick Stats</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground/60">Exam Code</span>
                  <span className="font-mono font-bold text-primary">{cert.code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/60">Level</span>
                  <span
                    className={`px-2 py-0.5 border text-[10px] font-bold rounded ${meta.badge}`}
                  >
                    {cert.level}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/60">Study Hours</span>
                  <span className="font-bold text-white">{cert.hours}h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/60">Prep Time</span>
                  <span className="font-bold text-white">{cert.prepTime}</span>
                </div>
                {cert.successRate && (
                  <div className="flex justify-between">
                    <span className="text-foreground/60">Avg. Pass Rate</span>
                    <span className="font-bold text-cyan-400">{cert.successRate}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-foreground/60">MS Learn Modules</span>
                  <span className="font-bold text-white">{cert.modules?.length ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/60">Catalogue checked</span>
                  <time dateTime={DATA_AS_OF} className="font-bold text-white">
                    {formatDate(DATA_AS_OF)}
                  </time>
                </div>
              </div>
            </div>

            <Link
              to={routes.education('azure')}
              className="flex items-center gap-2 text-sm text-foreground/60 hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Azure Education
            </Link>
          </aside>
        </div>
      </main>
    </>
  );
}
