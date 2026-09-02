import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_META = {
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

const FILTER_LEVELS = ['All', 'Associate', 'Professional'];
const STATUS_FILTER = ['All', 'Active'];
const VISIBLE_COUNT = 4;

function getLevelFilterClass(levelFilter, level) {
  if (levelFilter !== level) {
    return 'bg-card/30 border-card/50 text-foreground/60 hover:text-foreground hover:border-foreground/40';
  }
  if (level === 'All') {
    return 'bg-purple-500/30 border-purple-400 text-purple-300';
  }
  return `${LEVEL_META[level]?.badge ?? ''} border-current`;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const certifications = [
  {
    id: 'ta-003',
    slug: 'ta-003',
    code: 'TA-003',
    title: 'HashiCorp Certified: Terraform Associate (003)',
    level: 'Associate',
    status: 'active',
    description: 'Validate knowledge of infrastructure as code concepts and Terraform using HCL, state, providers, modules, variables, and workspaces.',
    topics: ['HCL', 'State', 'Providers', 'Modules', 'Variables', 'Workspaces'],
    hours: 25,
    prepTime: '~6 weeks',
    featured: true,
    learnUrl: 'https://developer.hashicorp.com/certifications/infrastructure-automation',
  },
  {
    id: 'tv-003',
    slug: 'tv-003',
    code: 'TV-003',
    title: 'HashiCorp Certified: Vault Associate (003)',
    level: 'Associate',
    status: 'active',
    description: 'Demonstrate knowledge of HashiCorp Vault for secrets management, auth methods, policies, and dynamic secret generation.',
    topics: ['Secrets Management', 'Auth Methods', 'Policies', 'Dynamic Secrets'],
    hours: 25,
    prepTime: '~6 weeks',
    featured: false,
    learnUrl: 'https://developer.hashicorp.com/certifications/security-automation',
  },
  {
    id: 'tc-002',
    slug: 'tc-002',
    code: 'TC-002',
    title: 'HashiCorp Certified: Consul Associate (002)',
    level: 'Associate',
    status: 'active',
    description: 'Validate knowledge of HashiCorp Consul for service mesh, KV store, health checks, and ACL-based access control.',
    topics: ['Service Mesh', 'KV Store', 'Health Checks', 'ACLs'],
    hours: 20,
    prepTime: '~5 weeks',
    featured: false,
    learnUrl: 'https://developer.hashicorp.com/certifications/networking-automation',
  },
];

const learningPaths = [
  {
    id: 0,
    certCode: 'TA-003',
    title: 'Terraform Associate Path',
    level: 'Intermediate',
    hours: 25,
    description: 'Master Terraform fundamentals from HCL syntax through state management, modules, workspaces, and integrating Terraform into CI/CD pipelines.',
    modules: [
      { title: 'HCL Syntax & Basics' },
      { title: 'Providers & Resources' },
      { title: 'State Management' },
      { title: 'Modules & Workspaces' },
      { title: 'CI/CD with Terraform' },
    ],
    certUrl: 'https://developer.hashicorp.com/certifications/infrastructure-automation',
  },
  {
    id: 1,
    certCode: 'TA-003',
    title: 'Multi-Cloud IaC Path',
    level: 'Advanced',
    hours: 40,
    description: 'Use Terraform to manage infrastructure across AWS, Azure, and Google Cloud with remote state backends and Atlantis for GitOps workflows.',
    modules: [
      { title: 'AWS Provider' },
      { title: 'AzureRM Provider' },
      { title: 'Google Provider' },
      { title: 'Remote State & Atlantis' },
    ],
    certUrl: 'https://developer.hashicorp.com/certifications/infrastructure-automation',
  },
  {
    id: 2,
    certCode: 'HCP-TF',
    title: 'HCP Terraform Enterprise Path',
    level: 'Advanced',
    hours: 35,
    description: 'Operate Terraform at enterprise scale using HCP Terraform — covering VCS-driven workflows, Sentinel policy as code, drift detection, and run triggers.',
    modules: [
      { title: 'Team Workflows & VCS' },
      { title: 'Policy as Code (Sentinel)' },
      { title: 'Drift Detection' },
      { title: 'Run Triggers & Audit' },
    ],
    certUrl: 'https://developer.hashicorp.com/terraform/cloud-docs',
  },
];

const resources = [
  {
    id: 'hashicorp-developer',
    title: 'HashiCorp Developer Docs',
    description: 'Official documentation for Terraform, Vault, Consul, Nomad, and all HashiCorp tools — tutorials, reference guides, and API docs.',
    type: 'Documentation',
    icon: 'description',
    url: 'https://developer.hashicorp.com/',
  },
  {
    id: 'hc-tutorials',
    title: 'HashiCorp Tutorials',
    description: 'Hands-on step-by-step tutorials for every HashiCorp product hosted on HashiCorp Developer — formerly HashiCorp Learn.',
    type: 'Tutorials',
    icon: 'school',
    url: 'https://developer.hashicorp.com/tutorials',
  },
  {
    id: 'terraform-registry',
    title: 'Terraform Registry',
    description: 'Browse 10,000+ providers and modules from HashiCorp and the community for every major cloud platform and service.',
    type: 'Registry',
    icon: 'inventory',
    url: 'https://registry.terraform.io/',
  },
  {
    id: 'hcp-terraform',
    title: 'HCP Terraform Free Tier',
    description: 'HashiCorp Cloud Platform Terraform — remote state, team collaboration, and Sentinel policy as code, free for up to 500 resources.',
    type: 'Platform',
    icon: 'cloud',
    url: 'https://app.terraform.io/',
  },
  {
    id: 'infracost',
    title: 'Infracost',
    description: 'Estimate infrastructure costs from Terraform plans before deploying — integrates with CI/CD pipelines and GitHub PRs.',
    type: 'Tool',
    icon: 'attach_money',
    url: 'https://www.infracost.io/',
  },
  {
    id: 'tflint',
    title: 'TFLint',
    description: 'A Terraform linter focused on detecting errors and enforcing best practices — supports AWS, Azure, and GCP provider rules.',
    type: 'Tool',
    icon: 'bug_report',
    url: 'https://github.com/terraform-linters/tflint',
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TerraformEducationPage() {
  const [levelFilter, setLevelFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [carouselPage, setCarouselPage] = useState(0);
  const [selectedPathId, setSelectedPathId] = useState(0);

  const featuredCert = certifications.find((c) => c.featured);

  const filteredCerts = certifications.filter((c) => {
    const levelOk = levelFilter === 'All' || c.level === levelFilter;
    const statusOk = statusFilter === 'All' || c.status === statusFilter.toLowerCase();
    return levelOk && statusOk;
  });

  const totalPages = Math.ceil(filteredCerts.length / VISIBLE_COUNT);
  const visibleCerts = filteredCerts.slice(
    carouselPage * VISIBLE_COUNT,
    carouselPage * VISIBLE_COUNT + VISIBLE_COUNT
  );

  const selectedPath = learningPaths[selectedPathId];

  const handleLevelFilter = (l) => {
    setLevelFilter(l);
    setCarouselPage(0);
  };
  const handleStatusFilter = (s) => {
    setStatusFilter(s);
    setCarouselPage(0);
  };

  return (
    <>
      <Helmet>
        <title>Terraform &amp; HashiCorp Certifications | HCW</title>
        <meta
          name="description"
          content="HashiCorp Terraform, Vault, and Consul certification prep, learning paths, and IaC resources."
        />
        <meta property="og:title" content="Terraform & HashiCorp Certifications" />
        <meta
          property="og:description"
          content="Structured learning paths, certification prep, and curated resources for HashiCorp certifications."
        />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mb-12 relative">
          <div className="absolute -top-10 -left-10 w-96 h-96 bg-purple-500/5 blur-3xl rounded-full pointer-events-none" />
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 relative z-10">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-terraform-primary via-slate-900 to-terraform-primary dark:via-white">
              Terraform &amp; HashiCorp Certifications
            </span>
          </h1>
          <p className="text-base sm:text-lg text-foreground max-w-3xl relative z-10">
            Master infrastructure as code and secrets management with HashiCorp certifications
            covering Terraform, Vault, and Consul.
          </p>
          <div className="flex flex-wrap gap-2 mt-4 relative z-10">
            {['Associate', 'Professional'].map((level) => (
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
              href="https://developer.hashicorp.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-gradient-to-br from-purple-900/40 to-card/40 backdrop-blur-md border border-purple-500/30 rounded-2xl p-6 hover:shadow-[0_0_30px_rgba(168,85,247,0.2)] hover:border-purple-400/60 transition-all duration-300 flex items-start gap-5"
            >
              <div className="w-14 h-14 shrink-0 bg-purple-500/20 rounded-xl flex items-center justify-center">
                <span className="text-purple-400 text-[28px] material-symbols-outlined">
                  workspace_premium
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-lg font-bold text-white group-hover:text-purple-300 transition-colors">
                    HashiCorp Developer
                  </h2>
                  <span className="px-2 py-0.5 bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0">
                    Official
                  </span>
                </div>
                <p className="text-sm text-foreground mb-3">
                  The official HashiCorp developer portal — tutorials, documentation, and
                  certification prep for Terraform, Vault, Consul, and all HashiCorp tools.
                </p>
                <div className="flex items-center gap-1.5 text-purple-400 text-sm font-semibold">
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  developer.hashicorp.com
                </div>
              </div>
            </a>

            <a
              href="https://www.hashicorp.com/certification"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-gradient-to-br from-violet-900/40 to-card/40 backdrop-blur-md border border-violet-500/30 rounded-2xl p-6 hover:shadow-[0_0_30px_rgba(139,92,246,0.2)] hover:border-violet-400/60 transition-all duration-300 flex items-start gap-5"
            >
              <div className="w-14 h-14 shrink-0 bg-violet-500/20 rounded-xl flex items-center justify-center">
                <span className="text-violet-400 text-[28px] material-symbols-outlined">
                  construction
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-lg font-bold text-white group-hover:text-violet-300 transition-colors">
                    HashiCorp Certification
                  </h2>
                  <span className="px-2 py-0.5 bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0">
                    Exams & Badges
                  </span>
                </div>
                <p className="text-sm text-foreground mb-3">
                  View all HashiCorp certifications, register for exams, review exam objectives,
                  and access study guides for Terraform, Vault, and Consul.
                </p>
                <div className="flex items-center gap-1.5 text-violet-400 text-sm font-semibold">
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  hashicorp.com/certification
                </div>
              </div>
            </a>
          </div>
        </section>

        {/* ── Browse Certifications Carousel ───────────────────────────── */}
        <section className="mb-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h3 className="text-2xl font-bold text-white flex items-center gap-2">
              <span className="text-purple-400 text-[24px] material-symbols-outlined">school</span>
              Browse Certifications
            </h3>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="flex flex-wrap gap-2">
              {FILTER_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => handleLevelFilter(level)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${getLevelFilterClass(levelFilter, level)}`}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="w-px bg-card/50 hidden sm:block" />
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTER.map((s) => (
                <button
                  key={s}
                  onClick={() => handleStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${
                    statusFilter === s
                      ? 'bg-purple-500/25 border-purple-400 text-purple-300'
                      : 'bg-card/30 border-card/50 text-foreground/60 hover:text-foreground hover:border-foreground/40'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 min-h-[220px]">
            {visibleCerts.length === 0 ? (
              <div className="col-span-4 flex items-center justify-center py-16 text-foreground/50">
                No certifications match the selected filters.
              </div>
            ) : (
              visibleCerts.map((cert) => {
                const meta = LEVEL_META[cert.level];
                return (
                  <article
                    key={cert.id}
                    className={`group bg-card/40 backdrop-blur-md border border-card/50 border-l-4 ${meta.accent} rounded-2xl p-6 hover:shadow-[0_0_20px_rgba(168,85,247,0.15)] hover:border-purple-400/40 transition-all duration-300 flex flex-col`}
                  >
                    <div className="flex items-start justify-between mb-2 gap-1 flex-wrap">
                      <span className={`px-2.5 py-1 border text-[10px] font-bold rounded ${meta.badge}`}>
                        {cert.level}
                      </span>
                      <span className="text-xs text-foreground/50 font-mono">{cert.hours}h</span>
                    </div>
                    <div className="text-xs font-mono text-foreground/40 mb-1">{cert.code}</div>
                    <h3 className="text-sm font-bold text-white mb-2 line-clamp-3 group-hover:text-purple-300 transition-colors flex-1">
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
                        className="flex-1 h-9 bg-card/50 hover:bg-purple-500/20 hover:text-purple-300 text-foreground rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1"
                      >
                        View Details
                        <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                      </a>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setCarouselPage((p) => Math.max(0, p - 1))}
                disabled={carouselPage === 0}
                className="h-9 w-9 bg-card/40 hover:bg-card/60 disabled:opacity-30 border border-card/50 rounded-lg flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCarouselPage(i)}
                  className={`h-2.5 rounded-full transition-all ${i === carouselPage ? 'bg-purple-400 w-5' : 'w-2.5 bg-card/60 hover:bg-card/80'}`}
                />
              ))}
              <button
                onClick={() => setCarouselPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={carouselPage === totalPages - 1}
                className="h-9 w-9 bg-card/40 hover:bg-card/60 disabled:opacity-30 border border-card/50 rounded-lg flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
              <span className="text-xs text-foreground/50 ml-2">
                {carouselPage * VISIBLE_COUNT + 1}–
                {Math.min((carouselPage + 1) * VISIBLE_COUNT, filteredCerts.length)} of{' '}
                {filteredCerts.length}
              </span>
            </div>
          )}
        </section>

        {/* ── Featured Cert + Sidebar ──────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 mb-16">
          {featuredCert && (
            <article className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl overflow-hidden hover:shadow-[0_0_25px_rgba(168,85,247,0.15)] hover:border-purple-400/50 transition-all duration-300">
              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div className="p-8 flex flex-col justify-between">
                  <div>
                    <div className="mb-4 flex items-center gap-3 flex-wrap">
                      <span className="px-3 py-1 bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold rounded">
                        Recommended Starting Point
                      </span>
                      <span className={`px-3 py-1 border text-xs font-bold rounded ${LEVEL_META[featuredCert.level].badge}`}>
                        {featuredCert.level}
                      </span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1">
                      {featuredCert.title}
                    </h2>
                    <div className="text-sm font-mono text-foreground/50 mb-3">
                      {featuredCert.code}
                    </div>
                    <p className="text-foreground mb-6">{featuredCert.description}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">
                      Topics Covered
                    </h3>
                    <div className="grid grid-cols-2 gap-3 mb-8">
                      {featuredCert.topics.map((topic, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-purple-400 material-symbols-outlined text-[16px]">
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
                      className="block w-full h-11 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-colors text-center leading-[44px]"
                    >
                      Start Preparation
                    </a>
                  </div>
                </div>
                <div className="bg-card/60 p-8 flex flex-col justify-between">
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="text-4xl font-bold text-purple-400 mb-2">
                        {featuredCert.hours}
                      </div>
                      <div className="text-sm text-foreground">Hours of Study</div>
                    </div>
                    <div className="border-t border-slate-700 pt-6 text-center">
                      <div className="text-sm text-foreground mb-2">Estimated Preparation</div>
                      <div className="text-2xl font-bold text-white">{featuredCert.prepTime}</div>
                    </div>
                  </div>
                  <div className="pt-6 border-t border-slate-700">
                    <a
                      href="https://www.hashicorp.com/certification"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full h-11 px-4 bg-card/50 hover:bg-card/70 text-foreground font-semibold rounded-lg transition-colors text-sm text-center leading-[44px]"
                    >
                      View All HashiCorp Certs ↗
                    </a>
                  </div>
                </div>
              </div>
            </article>
          )}

          {/* Sidebar */}
          <aside className="h-fit sticky top-28 space-y-6">
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-purple-400 text-[20px] material-symbols-outlined">
                  emoji_events
                </span>
                All Certifications
              </h3>
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {certifications.map((cert) => (
                  <div
                    key={cert.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-card/50 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${LEVEL_META[cert.level].dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground line-clamp-1">
                        {cert.code}
                      </div>
                      <div className="text-xs text-foreground/50 line-clamp-1">{cert.title}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-1.5">
                {Object.entries(LEVEL_META).map(([level, meta]) => (
                  <div key={level} className="flex items-center gap-1.5 text-xs text-foreground/60">
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    {level}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-500/20 to-violet-900/20 backdrop-blur-md border border-purple-500/30 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <span className="text-purple-400 text-[20px] material-symbols-outlined">
                  rocket_launch
                </span>
                Getting Started
              </h3>
              <p className="text-sm text-foreground mb-4">
                New to HashiCorp? TA-003 (Terraform Associate) is the most widely adopted IaC
                certification and the ideal first HashiCorp exam.
              </p>
              <a
                href="https://developer.hashicorp.com/certifications/infrastructure-automation"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full h-11 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-colors text-sm text-center leading-[44px]"
              >
                Start with TA-003
              </a>
            </div>
          </aside>
        </section>

        {/* ── Learning Paths ───────────────────────────────────────────── */}
        <section className="mb-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h3 className="text-2xl font-bold text-white flex items-center gap-2">
              <span className="text-purple-400 text-[24px] material-symbols-outlined">bookmark</span>
              Learning Paths
            </h3>
            <div className="relative">
              <select
                value={selectedPathId}
                onChange={(e) => setSelectedPathId(Number(e.target.value))}
                className="appearance-none bg-card/40 backdrop-blur-md border border-card/50 text-foreground text-sm rounded-xl px-4 pr-10 h-10 hover:border-purple-400/50 focus:outline-none focus:border-purple-400 transition-colors cursor-pointer"
              >
                {learningPaths.map((p, i) => (
                  <option key={i} value={i} className="bg-slate-900">
                    {p.certCode} — {p.title}
                  </option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-foreground pointer-events-none">
                expand_more
              </span>
            </div>
          </div>

          {selectedPath && (
            <article className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-8 hover:shadow-[0_0_25px_rgba(168,85,247,0.15)] hover:border-purple-400/50 transition-all duration-300">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold rounded font-mono">
                  {selectedPath.certCode}
                </span>
                <span className="px-3 py-1 bg-card/50 text-foreground text-xs font-bold rounded">
                  {selectedPath.level}
                </span>
                <span className="text-sm text-foreground/60">{selectedPath.hours} hours</span>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">{selectedPath.title}</h2>
              <p className="text-foreground mb-6 text-lg">{selectedPath.description}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                <div className="bg-card/60 rounded-lg p-4">
                  <div className="text-sm text-foreground mb-1">Total Hours</div>
                  <div className="text-2xl font-bold text-purple-400">{selectedPath.hours}</div>
                </div>
                <div className="bg-card/60 rounded-lg p-4">
                  <div className="text-sm text-foreground mb-1">Modules</div>
                  <div className="text-2xl font-bold text-violet-400">{selectedPath.modules.length}</div>
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
                    <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold flex items-center justify-center shrink-0">
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
                  className="flex-1 h-11 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  View {selectedPath.certCode} on HashiCorp Developer
                </a>
              </div>
            </article>
          )}
        </section>

        {/* ── Learning Resources ───────────────────────────────────────── */}
        <section className="mb-16">
          <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <span className="text-purple-400 text-[24px] material-symbols-outlined">
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
                className="group bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6 flex flex-col hover:shadow-[0_0_25px_rgba(168,85,247,0.15)] hover:border-purple-400/50 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-purple-400 text-[24px]">
                    {resource.icon}
                  </span>
                </div>
                <div className="text-xs font-bold text-purple-400/70 uppercase tracking-wider mb-1">
                  {resource.type}
                </div>
                <h4 className="font-bold text-white mb-2 group-hover:text-purple-300 transition-colors">
                  {resource.title}
                </h4>
                <p className="text-xs text-foreground flex-1">{resource.description}</p>
                <div className="mt-4 flex items-center gap-1 text-purple-400 text-xs font-semibold">
                  Explore{' '}
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
