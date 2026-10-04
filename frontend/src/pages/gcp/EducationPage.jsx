import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import CertificationCarouselSection from '@/components/education/CertificationCarouselSection';
import { useCertificationCarousel } from '@/components/education/useCertificationCarousel';
import FeaturedCertSection from '@/components/education/FeaturedCertSection';
import { DATA_AS_OF, DATA_SOURCE, certifications } from '@/data/gcp/certifications';

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_META = {
  Foundational: {
    badge: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
    accent: 'border-l-sky-500',
    dot: 'bg-sky-500',
    label: 'Foundational',
  },
  Associate: {
    badge: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    accent: 'border-l-emerald-500',
    dot: 'bg-emerald-500',
    label: 'Associate',
  },
  Professional: {
    badge: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
    accent: 'border-l-violet-500',
    dot: 'bg-violet-500',
    label: 'Professional',
  },
};

const FILTER_LEVELS = ['All', 'Foundational', 'Associate', 'Professional'];
const STATUS_FILTER = ['All', 'Active'];
const VISIBLE_COUNT = 4;

// The hub's colour classes, handed to the shared education components so
// their markup names no colour. Full class strings, so Tailwind sees them.
const TONE = {
  headingIcon: 'text-primary',
  activeDot: 'bg-primary',
  activeFilter: 'bg-primary/30 border-primary text-primary',
  cardHover: 'hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] hover:border-primary/40',
  titleHover: 'group-hover:text-primary',
  linkHover: 'hover:bg-primary/20 hover:text-primary',
  accentText: 'text-primary',
  articleHover: 'hover:shadow-[0_0_25px_rgba(59,130,246,0.15)] hover:border-primary/50',
  badge: 'bg-primary/20 border border-primary/30 text-primary',
  button: 'bg-primary hover:opacity-90 text-primary-foreground',
  gettingStartedCard:
    'bg-linear-to-br from-primary/20 to-blue-900/20 backdrop-blur-md border border-primary/30',
};

/** The hub's own link to the issuer's full catalogue, under the featured credential. */
const ALL_CERTS = { href: 'https://cloud.google.com/certification', label: 'View All GCP Certs ↗' };

/** The "Getting Started" card beside the catalogue: where a newcomer begins. */
const GETTING_STARTED = {
  text: 'New to Google Cloud? CDL (Cloud Digital Leader) and ACE (Associate Cloud Engineer) are the best entry points before Professional certifications.',
  href: 'https://cloud.google.com/certification/cloud-digital-leader',
  label: 'Start with CDL',
};

function getLevelFilterClass(levelFilter, level) {
  if (levelFilter !== level) {
    return 'bg-card/30 border-card/50 text-foreground/60 hover:text-foreground hover:border-foreground/40';
  }
  if (level === 'All') {
    return 'bg-primary/30 border-primary text-primary';
  }
  return `${LEVEL_META[level]?.badge ?? ''} border-current`;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const learningPaths = [
  {
    id: 0,
    certCode: 'CDL',
    title: 'Cloud Foundations Path',
    level: 'Beginner',
    hours: 20,
    description:
      'Start your Google Cloud journey with core cloud concepts, GCP products, identity, and cost management.',
    modules: [
      { title: 'Core Cloud Concepts' },
      { title: 'GCP Products Overview' },
      { title: 'Identity & IAM' },
      { title: 'Billing & Cost Management' },
    ],
    certUrl: 'https://cloud.google.com/certification/cloud-digital-leader',
  },
  {
    id: 1,
    certCode: 'PCA',
    title: 'Cloud Architect Path',
    level: 'Advanced',
    hours: 60,
    description:
      'Design enterprise-grade architectures on Google Cloud with a focus on reliability, security, and scale.',
    modules: [
      { title: 'Compute & Containers' },
      { title: 'Storage & Databases' },
      { title: 'Networking' },
      { title: 'Security & Compliance' },
      { title: 'Cost Optimization' },
    ],
    certUrl: 'https://cloud.google.com/certification/cloud-architect',
  },
  {
    id: 2,
    certCode: 'PDE',
    title: 'Data & AI Path',
    level: 'Advanced',
    hours: 55,
    description:
      'Build data pipelines and ML systems using BigQuery, Dataflow, Pub/Sub, and Vertex AI on Google Cloud.',
    modules: [
      { title: 'BigQuery & Analytics' },
      { title: 'Dataflow & Pub/Sub' },
      { title: 'Vertex AI' },
      { title: 'MLOps & Pipelines' },
    ],
    certUrl: 'https://cloud.google.com/certification/data-engineer',
  },
];

const resources = [
  {
    id: 'skills-boost',
    title: 'Google Cloud Skills Boost',
    description:
      'Official learning platform with hands-on labs, courses, and skill badges covering all Google Cloud services.',
    type: 'Learning Platform',
    icon: 'school',
    url: 'https://cloudskillsboost.google/',
  },
  {
    id: 'gcp-docs',
    title: 'GCP Documentation',
    description:
      'Comprehensive reference documentation, quickstarts, and tutorials for every Google Cloud product.',
    type: 'Documentation',
    icon: 'description',
    url: 'https://cloud.google.com/docs',
  },
  {
    id: 'cloud-onboard',
    title: 'Cloud OnBoard',
    description:
      'Free Google Cloud onboarding events and workshops for developers and architects — live and on-demand.',
    type: 'Events',
    icon: 'event',
    url: 'https://cloudonair.withgoogle.com/',
  },
  {
    id: 'practice-exams',
    title: 'Practice Exams',
    description:
      'Official Google Cloud practice exams to gauge exam readiness across certification tracks.',
    type: 'Practice Exams',
    icon: 'checklist',
    url: 'https://cloud.google.com/certification/practice-exam',
  },
  {
    id: 'coursera',
    title: 'Coursera GCP Courses',
    description:
      'Instructor-led Google Cloud courses on Coursera covering architecture, data, security, and ML.',
    type: 'Courses',
    icon: 'play_circle',
    url: 'https://www.coursera.org/googlecloud',
  },
  {
    id: 'next-videos',
    title: 'Google Cloud Next Videos',
    description:
      'On-demand sessions from Google Cloud Next with deep dives on every product and architecture pattern.',
    type: 'Video',
    icon: 'smart_display',
    url: 'https://cloudonair.withgoogle.com/events/next',
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GCPEducationPage() {
  const [selectedPathId, setSelectedPathId] = useState(0);
  const carousel = useCertificationCarousel(certifications, {
    visibleCount: VISIBLE_COUNT,
    asOf: DATA_AS_OF,
  });

  const featuredCert = certifications.find((c) => c.featured);

  const selectedPath = learningPaths[selectedPathId];

  return (
    <>
      <Helmet>
        <title>Google Cloud Education &amp; Certifications | HCW</title>
        <meta
          name="description"
          content="Google Cloud certification prep, learning paths, and resources — from Cloud Digital Leader to Professional certifications."
        />
        <meta property="og:title" content="Google Cloud Education & Certifications" />
        <meta
          property="og:description"
          content="Structured learning paths, certification prep, and curated resources for Google Cloud certifications."
        />
      </Helmet>

      <main className="grow pt-28 pb-20 px-4 md:px-8 max-w-360 mx-auto w-full">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mb-12 relative">
          <div className="absolute -top-10 -left-10 w-96 h-96 bg-blue-500/5 blur-3xl rounded-full pointer-events-none" />
          <div className="absolute -top-5 right-0 w-72 h-72 bg-cyan-500/5 blur-3xl rounded-full pointer-events-none" />
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 relative z-10">
            <span className="bg-clip-text text-transparent bg-linear-to-r from-gcp-primary via-slate-900 to-gcp-primary dark:via-white">
              Google Cloud Education &amp; Certifications
            </span>
          </h1>
          <p className="text-base sm:text-lg text-foreground max-w-3xl relative z-10">
            Master Google Cloud Platform with structured learning paths and official certifications
            — from Cloud Digital Leader through Professional-level specializations.
          </p>
          <div className="flex flex-wrap gap-2 mt-4 relative z-10">
            {['Foundational', 'Associate', 'Professional'].map((level) => (
              <span
                key={level}
                className={`px-3 py-1 border text-xs font-bold rounded-full ${LEVEL_META[level].badge}`}
              >
                {level}
              </span>
            ))}
          </div>
        </section>

        {/* ── Official Resources Banner ─────────────────────────────────── */}
        <section className="mb-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <a
              href="https://cloudskillsboost.google/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-linear-to-br from-blue-900/40 to-card/40 backdrop-blur-md border border-blue-500/30 rounded-2xl p-6 hover:shadow-[0_0_30px_rgba(59,130,246,0.2)] hover:border-blue-400/60 transition-all duration-300 flex items-start gap-5"
            >
              <div className="w-14 h-14 shrink-0 bg-blue-500/20 rounded-xl flex items-center justify-center">
                <span
                  className="text-blue-400 text-[28px] material-symbols-outlined"
                  aria-hidden="true"
                >
                  workspace_premium
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-950 dark:text-white group-hover:text-blue-300 transition-colors">
                    Google Cloud Skills Boost
                  </h2>
                  <span className="px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0">
                    Official
                  </span>
                </div>
                <p className="text-sm text-foreground mb-3">
                  Hands-on labs, skill badges, and learning paths from Google Cloud — the official
                  platform for building verified cloud skills at any level.
                </p>
                <div className="flex items-center gap-1.5 text-blue-400 text-sm font-semibold">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    open_in_new
                  </span>
                  cloudskillsboost.google
                </div>
              </div>
            </a>

            <a
              href="https://cloud.google.com/certification"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-linear-to-br from-cyan-900/40 to-card/40 backdrop-blur-md border border-cyan-500/30 rounded-2xl p-6 hover:shadow-[0_0_30px_rgba(6,182,212,0.2)] hover:border-cyan-400/60 transition-all duration-300 flex items-start gap-5"
            >
              <div className="w-14 h-14 shrink-0 bg-cyan-500/20 rounded-xl flex items-center justify-center">
                <span
                  className="text-cyan-400 text-[28px] material-symbols-outlined"
                  aria-hidden="true"
                >
                  construction
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-950 dark:text-white group-hover:text-cyan-300 transition-colors">
                    GCP Certification Portal
                  </h2>
                  <span className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0">
                    Exams & Badges
                  </span>
                </div>
                <p className="text-sm text-foreground mb-3">
                  Browse all Google Cloud certifications, find exam guides, register for exams, and
                  access your certification transcript and digital badges.
                </p>
                <div className="flex items-center gap-1.5 text-cyan-400 text-sm font-semibold">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    open_in_new
                  </span>
                  cloud.google.com/certification
                </div>
              </div>
            </a>
          </div>
        </section>

        {/* ── Browse Certifications Carousel ───────────────────────────── */}
        <CertificationCarouselSection
          asOf={DATA_AS_OF}
          source={DATA_SOURCE}
          filterLevels={FILTER_LEVELS}
          statusFilters={STATUS_FILTER}
          levelMeta={LEVEL_META}
          getLevelFilterClass={getLevelFilterClass}
          tone={TONE}
          carousel={carousel}
        />

        {/* ── Featured Cert + Sidebar ──────────────────────────────────── */}
        <FeaturedCertSection
          featuredCert={featuredCert}
          certifications={certifications}
          levelMeta={LEVEL_META}
          allCerts={ALL_CERTS}
          gettingStarted={GETTING_STARTED}
          tone={TONE}
        />

        {/* ── Learning Paths ───────────────────────────────────────────── */}
        <section className="mb-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h3 className="text-2xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span
                className="text-primary text-[24px] material-symbols-outlined"
                aria-hidden="true"
              >
                bookmark
              </span>
              Learning Paths
            </h3>
            <div className="relative">
              <select
                value={selectedPathId}
                onChange={(e) => setSelectedPathId(Number(e.target.value))}
                className="appearance-none bg-card/40 backdrop-blur-md border border-card/50 text-foreground text-sm rounded-xl px-4 pr-10 h-10 hover:border-primary/50 focus:outline-none focus:border-primary transition-colors cursor-pointer"
              >
                {learningPaths.map((p, i) => (
                  <option key={i} value={i} className="bg-slate-900">
                    {p.certCode} — {p.title}
                  </option>
                ))}
              </select>
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-foreground pointer-events-none"
                aria-hidden="true"
              >
                expand_more
              </span>
            </div>
          </div>

          {selectedPath && (
            <article className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-8 hover:shadow-[0_0_25px_rgba(59,130,246,0.15)] hover:border-primary/50 transition-all duration-300">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded font-mono">
                  {selectedPath.certCode}
                </span>
                <span className="px-3 py-1 bg-card/50 text-foreground text-xs font-bold rounded">
                  {selectedPath.level}
                </span>
                <span className="text-sm text-foreground/60">{selectedPath.hours} hours</span>
              </div>
              <h2 className="text-3xl font-bold text-slate-950 dark:text-white mb-2">
                {selectedPath.title}
              </h2>
              <p className="text-foreground mb-6 text-lg">{selectedPath.description}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                <div className="bg-card/60 rounded-lg p-4">
                  <div className="text-sm text-foreground mb-1">Total Hours</div>
                  <div className="text-2xl font-bold text-primary">{selectedPath.hours}</div>
                </div>
                <div className="bg-card/60 rounded-lg p-4">
                  <div className="text-sm text-foreground mb-1">Modules</div>
                  <div className="text-2xl font-bold text-cyan-400">
                    {selectedPath.modules.length}
                  </div>
                </div>
              </div>

              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
                Modules
              </h3>
              <div className="space-y-2">
                {selectedPath.modules.map((mod, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 bg-card/30 rounded-lg border border-card/40"
                  >
                    <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground">{mod.title}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a
                  href={selectedPath.certUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-11 px-4 bg-primary hover:opacity-90 text-primary-foreground font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    open_in_new
                  </span>
                  View {selectedPath.certCode} on Google Cloud
                </a>
              </div>
            </article>
          )}
        </section>

        {/* ── Learning Resources ───────────────────────────────────────── */}
        <section className="mb-16">
          <h3 className="text-2xl font-bold text-slate-950 dark:text-white mb-6 flex items-center gap-2">
            <span className="text-primary text-[24px] material-symbols-outlined" aria-hidden="true">
              library_books
            </span>
            Learning Resources
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {resources.map((resource) => (
              <a
                key={resource.id}
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6 flex flex-col hover:shadow-[0_0_25px_rgba(59,130,246,0.15)] hover:border-primary/50 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <span
                    className="material-symbols-outlined text-primary text-[24px]"
                    aria-hidden="true"
                  >
                    {resource.icon}
                  </span>
                </div>
                <div className="text-xs font-bold text-primary/70 uppercase tracking-wider mb-1">
                  {resource.type}
                </div>
                <h4 className="font-bold text-slate-950 dark:text-white mb-2 group-hover:text-primary transition-colors">
                  {resource.title}
                </h4>
                <p className="text-xs text-foreground flex-1">{resource.description}</p>
                <div className="mt-4 flex items-center gap-1 text-primary text-xs font-semibold">
                  Explore{' '}
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    open_in_new
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
