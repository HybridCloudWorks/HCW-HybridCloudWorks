import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import CertificationCarouselSection from '@/components/education/CertificationCarouselSection';
import { useCertificationCarousel } from '@/components/education/useCertificationCarousel';
import FeaturedCertSection from '@/components/education/FeaturedCertSection';
import { DATA_AS_OF, DATA_SOURCE, certifications } from '@/data/github/certifications';

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_META = {
  Foundations: {
    badge: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
    accent: 'border-l-sky-500',
    dot: 'bg-sky-500',
    label: 'Foundations',
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

const FILTER_LEVELS = ['All', 'Foundations', 'Associate', 'Professional'];
const STATUS_FILTER = ['All', 'Active'];
const VISIBLE_COUNT = 4;

// The hub's colour classes, handed to the shared education components so
// their markup names no colour. Full class strings, so Tailwind sees them.
const TONE = {
  headingIcon: 'text-slate-300',
  activeDot: 'bg-slate-400',
  activeFilter: 'bg-slate-500/25 border-slate-400 text-slate-300',
  cardHover: 'hover:shadow-[0_0_20px_rgba(148,163,184,0.12)] hover:border-slate-400/40',
  titleHover: 'group-hover:text-slate-300',
  linkHover: 'hover:bg-slate-500/20 hover:text-slate-300',
  accentText: 'text-slate-300',
  articleHover: 'hover:shadow-[0_0_25px_rgba(148,163,184,0.12)] hover:border-slate-400/50',
  badge: 'bg-slate-500/20 border border-slate-500/30 text-slate-300',
  button: 'bg-slate-600 hover:bg-slate-500 text-white',
  gettingStartedCard:
    'bg-gradient-to-br from-slate-700/30 to-slate-900/20 backdrop-blur-md border border-slate-500/30',
};

/** The hub's own link to the issuer's full catalogue, under the featured credential. */
const ALL_CERTS = {
  href: 'https://examregistration.github.com/overview',
  label: 'View All GitHub Certs ↗',
};

/** The "Getting Started" card beside the catalogue: where a newcomer begins. */
const GETTING_STARTED = {
  text: 'New to GitHub certifications? Start with GH-100 (Foundations) to build core Git and GitHub skills before tackling Actions or Advanced Security.',
  href: 'https://examregistration.github.com/overview',
  label: 'Start with GH-100',
};

function getLevelFilterClass(levelFilter, level) {
  if (levelFilter !== level) {
    return 'bg-card/30 border-card/50 text-foreground/60 hover:text-foreground hover:border-foreground/40';
  }
  if (level === 'All') {
    return 'bg-slate-500/30 border-slate-400 text-slate-300';
  }
  return `${LEVEL_META[level]?.badge ?? ''} border-current`;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const learningPaths = [
  {
    id: 0,
    certCode: 'GH-900',
    title: 'GitHub Foundations Path',
    level: 'Beginner',
    hours: 20,
    description:
      'Build Git and GitHub fluency from the ground up — covering repositories, branching strategies, pull requests, and project management.',
    modules: [
      { title: 'Git Fundamentals' },
      { title: 'Repositories & Branching' },
      { title: 'Pull Requests & Code Review' },
      { title: 'GitHub Projects' },
    ],
    certUrl: 'https://examregistration.github.com/overview',
  },
  {
    id: 1,
    certCode: 'GH-200',
    title: 'Actions & CI/CD Path',
    level: 'Intermediate',
    hours: 30,
    description:
      'Automate software workflows with GitHub Actions — from basic pipelines to reusable workflows and security best practices.',
    modules: [
      { title: 'Workflow Syntax' },
      { title: 'Runners & Environments' },
      { title: 'Reusable Workflows' },
      { title: 'Security in Actions' },
    ],
    certUrl: 'https://examregistration.github.com/overview',
  },
  {
    id: 2,
    certCode: 'GH-500',
    title: 'Advanced Security Path',
    level: 'Advanced',
    hours: 40,
    description:
      'Secure your software supply chain with CodeQL code scanning, secret scanning, Dependabot alerts, and SBOM generation.',
    modules: [
      { title: 'Code Scanning with CodeQL' },
      { title: 'Secret Scanning' },
      { title: 'Dependabot Alerts' },
      { title: 'SBOM & Supply Chain' },
    ],
    certUrl: 'https://examregistration.github.com/overview',
  },
];

const resources = [
  {
    id: 'github-skills',
    title: 'GitHub Skills',
    description:
      'Learn how to use GitHub with interactive, hands-on courses built directly in GitHub repositories.',
    type: 'Learning Platform',
    icon: 'school',
    url: 'https://skills.github.com/',
  },
  {
    id: 'github-docs',
    title: 'GitHub Docs',
    description:
      'Official documentation for every GitHub feature — from Actions workflows to Advanced Security configuration.',
    type: 'Documentation',
    icon: 'description',
    url: 'https://docs.github.com/',
  },
  {
    id: 'github-universe',
    title: 'GitHub Universe Videos',
    description:
      'On-demand sessions from GitHub Universe covering AI, security, CI/CD, and developer productivity.',
    type: 'Video',
    icon: 'play_circle',
    url: 'https://githubuniverse.com/',
  },
  {
    id: 'github-learning-lab',
    title: 'GitHub Learning Lab',
    description:
      'Self-paced learning experiences that teach GitHub skills through bot-guided interactive exercises.',
    type: 'Labs',
    icon: 'science',
    url: 'https://skills.github.com/',
  },
  {
    id: 'practice-tests',
    title: 'Practice Tests',
    description:
      'Third-party practice tests for GitHub certifications covering exam objectives across all certification tracks.',
    type: 'Practice Exams',
    icon: 'checklist',
    url: 'https://examregistration.github.com/overview',
  },
  {
    id: 'github-blog',
    title: 'GitHub Blog',
    description:
      'Product announcements, engineering deep dives, and best practices from the GitHub team.',
    type: 'Blog',
    icon: 'article',
    url: 'https://github.blog/',
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GitHubEducationPage() {
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
        <title>GitHub Skills &amp; Certifications | HCW</title>
        <meta
          name="description"
          content="GitHub certification prep, learning paths, and resources — covering Foundations, Actions, Copilot, Advanced Security, and Administration."
        />
        <meta property="og:title" content="GitHub Skills & Certifications" />
        <meta
          property="og:description"
          content="Structured learning paths, certification prep, and curated resources for GitHub certifications."
        />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mb-12 relative">
          <div className="absolute -top-10 -left-10 w-96 h-96 bg-slate-500/5 blur-3xl rounded-full pointer-events-none" />
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 relative z-10">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-slate-700 via-slate-900 to-slate-700 dark:from-slate-300 dark:via-white dark:to-slate-300">
              GitHub Skills &amp; Certifications
            </span>
          </h1>
          <p className="text-base sm:text-lg text-foreground max-w-3xl relative z-10">
            Validate your GitHub expertise with official certifications covering foundations, CI/CD
            automation, GitHub Copilot, advanced security, and enterprise administration.
          </p>
          <div className="flex flex-wrap gap-2 mt-4 relative z-10">
            {['Foundations', 'Associate', 'Professional'].map((level) => (
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
              href="https://skills.github.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-gradient-to-br from-slate-800/60 to-card/40 backdrop-blur-md border border-slate-500/30 rounded-2xl p-6 hover:shadow-[0_0_30px_rgba(148,163,184,0.15)] hover:border-slate-400/60 transition-all duration-300 flex items-start gap-5"
            >
              <div className="w-14 h-14 shrink-0 bg-slate-500/20 rounded-xl flex items-center justify-center">
                <span
                  className="text-slate-300 text-[28px] material-symbols-outlined"
                  aria-hidden="true"
                >
                  workspace_premium
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-950 dark:text-white group-hover:text-slate-300 transition-colors">
                    GitHub Skills
                  </h2>
                  <span className="px-2 py-0.5 bg-slate-500/20 border border-slate-500/30 text-slate-300 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0">
                    Free
                  </span>
                </div>
                <p className="text-sm text-foreground mb-3">
                  Learn GitHub hands-on through interactive, project-based courses that run directly
                  inside GitHub repositories — no setup required.
                </p>
                <div className="flex items-center gap-1.5 text-slate-300 text-sm font-semibold">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    open_in_new
                  </span>
                  skills.github.com
                </div>
              </div>
            </a>

            <a
              href="https://examregistration.github.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-gradient-to-br from-slate-800/60 to-card/40 backdrop-blur-md border border-slate-500/30 rounded-2xl p-6 hover:shadow-[0_0_30px_rgba(148,163,184,0.15)] hover:border-slate-400/60 transition-all duration-300 flex items-start gap-5"
            >
              <div className="w-14 h-14 shrink-0 bg-slate-500/20 rounded-xl flex items-center justify-center">
                <span
                  className="text-slate-300 text-[28px] material-symbols-outlined"
                  aria-hidden="true"
                >
                  construction
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-950 dark:text-white group-hover:text-slate-300 transition-colors">
                    GitHub Certification Portal
                  </h2>
                  <span className="px-2 py-0.5 bg-slate-500/20 border border-slate-500/30 text-slate-300 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0">
                    Register
                  </span>
                </div>
                <p className="text-sm text-foreground mb-3">
                  Register for GitHub certification exams, view available certifications, and access
                  your exam history and digital badges after passing.
                </p>
                <div className="flex items-center gap-1.5 text-slate-300 text-sm font-semibold">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    open_in_new
                  </span>
                  examregistration.github.com
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
                className="text-slate-300 text-[24px] material-symbols-outlined"
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
                className="appearance-none bg-card/40 backdrop-blur-md border border-card/50 text-foreground text-sm rounded-xl px-4 pr-10 h-10 hover:border-slate-400/50 focus:outline-none focus:border-slate-400 transition-colors cursor-pointer"
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
            <article className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-8 hover:shadow-[0_0_25px_rgba(148,163,184,0.12)] hover:border-slate-400/50 transition-all duration-300">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-slate-500/20 border border-slate-500/30 text-slate-300 text-xs font-bold rounded font-mono">
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
                  <div className="text-2xl font-bold text-slate-300">{selectedPath.hours}</div>
                </div>
                <div className="bg-card/60 rounded-lg p-4">
                  <div className="text-sm text-foreground mb-1">Modules</div>
                  <div className="text-2xl font-bold text-slate-400">
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
                    <span className="w-6 h-6 rounded-full bg-slate-500/20 text-slate-300 text-xs font-bold flex items-center justify-center shrink-0">
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
                  className="flex-1 h-11 px-4 bg-slate-600 hover:bg-slate-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    open_in_new
                  </span>
                  View {selectedPath.certCode} on GitHub
                </a>
              </div>
            </article>
          )}
        </section>

        {/* ── Learning Resources ───────────────────────────────────────── */}
        <section className="mb-16">
          <h3 className="text-2xl font-bold text-slate-950 dark:text-white mb-6 flex items-center gap-2">
            <span
              className="text-slate-300 text-[24px] material-symbols-outlined"
              aria-hidden="true"
            >
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
                className="group bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6 flex flex-col hover:shadow-[0_0_25px_rgba(148,163,184,0.12)] hover:border-slate-400/50 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <span
                    className="material-symbols-outlined text-slate-300 text-[24px]"
                    aria-hidden="true"
                  >
                    {resource.icon}
                  </span>
                </div>
                <div className="text-xs font-bold text-slate-400/70 uppercase tracking-wider mb-1">
                  {resource.type}
                </div>
                <h4 className="font-bold text-slate-950 dark:text-white mb-2 group-hover:text-slate-300 transition-colors">
                  {resource.title}
                </h4>
                <p className="text-xs text-foreground flex-1">{resource.description}</p>
                <div className="mt-4 flex items-center gap-1 text-slate-300 text-xs font-semibold">
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
