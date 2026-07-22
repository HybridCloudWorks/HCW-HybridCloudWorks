import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { routes } from '@/lib/routeFactory';
import { getFunctionsBase } from '@/lib/functionsBase';
import { useTheme } from '@/context/ThemeContext';
import Eyebrow from '@/components/shared/Eyebrow';
import NumberedSection from '@/components/shared/NumberedSection';
import StatBlock from '@/components/shared/StatBlock';

const getProviderLogoSrc = (provider, theme) => {
  if (provider === 'github') {
    return theme === 'dark'
      ? '/icons/providers/GitHub_Invertocat_White_Clearspace.svg'
      : '/icons/providers/GitHub_Invertocat_Black_Clearspace.svg';
  }
  if (provider === 'finops') return '/icons/providers/FinOps.svg';
  if (provider === 'vmware') return '/icons/providers/vmware.svg';
  return `/icons/providers/${provider}.png`;
};

/* Provider logo strip (marquee-style row) — reuses the Quick Access Hubs data */
const PROVIDER_LOGOS = [
  { provider: 'azure', label: 'Azure', src: '/icons/providers/azure.png' },
  { provider: 'aws', label: 'AWS', src: '/icons/providers/aws.png' },
  { provider: 'gcp', label: 'GCP', src: '/icons/providers/gcp.png' },
  { provider: 'terraform', label: 'Terraform', src: '/icons/providers/terraform.svg' },
  { provider: 'github', label: 'GitHub', src: '/icons/providers/github.svg' },
  { provider: 'finops', label: 'FinOps', src: '/icons/providers/FinOps.svg' },
  { provider: 'vmware', label: 'VMware', src: '/icons/providers/vmware.svg' },
  { provider: 'ansible', label: 'Ansible', src: '/icons/providers/ansible.svg' },
];

const vendorDesigns = [
  {
    title: 'Global Load Balancing',
    pillar: 'Reliability',
    provider: 'aws',
    color: 'hsl(var(--aws-orange) / 0.12)',
    slug: 'global-load-balancing',
    icon: 'hub',
  },
  {
    title: 'Enterprise Landing Zone',
    pillar: 'Security',
    provider: 'azure',
    color: 'hsl(var(--azure-blue) / 0.12)',
    slug: 'enterprise-landing-zone',
    icon: 'domain_verification',
  },
  {
    title: 'Zero-Trust Security',
    pillar: 'Security & Compliance',
    provider: 'gcp',
    color: 'hsl(var(--gcp-red) / 0.12)',
    slug: 'zero-trust-security',
    icon: 'enhanced_encryption',
  },
  {
    title: 'Cloud Cost Governance',
    pillar: 'Cost-Optimization',
    provider: 'finops',
    color: 'hsl(var(--finops-green) / 0.12)',
    slug: 'finops-governance',
    icon: 'payments',
  },
  {
    title: 'Multi-Region DR',
    pillar: 'Reliability',
    provider: 'aws',
    color: 'hsl(var(--aws-orange) / 0.12)',
    slug: 'multi-region-dr',
    icon: 'rebase_edit',
  },
  {
    title: 'Hybrid Connectivity',
    pillar: 'Reliability',
    provider: 'azure',
    color: 'hsl(var(--azure-blue) / 0.12)',
    slug: 'hybrid-connectivity',
    icon: 'settings_input_component',
  },
  {
    title: 'BigQuery Data Lake',
    pillar: 'Performance Efficiency',
    provider: 'gcp',
    color: 'hsl(var(--gcp-red) / 0.12)',
    slug: 'bigquery-data-lake',
    icon: 'database',
  },
  {
    title: 'Unit Economics Dashboard',
    pillar: 'Cost-Optimization',
    provider: 'finops',
    color: 'hsl(var(--finops-green) / 0.12)',
    slug: 'unit-economics',
    icon: 'monitoring',
  },
  {
    title: 'Serverless API',
    pillar: 'Performance Efficiency',
    provider: 'aws',
    color: 'hsl(var(--aws-orange) / 0.12)',
    slug: 'serverless-api',
    icon: 'api',
  },
  {
    title: 'Kubernetes on GKE',
    pillar: 'Operational Excellence',
    provider: 'gcp',
    color: 'hsl(var(--gcp-red) / 0.12)',
    slug: 'container-orchestration',
    icon: 'grid_view',
  },
];

const latestFeeds = [
  {
    id: 1,
    title: 'Azure Kubernetes Service: New Zero-Trust Network Policy',
    description:
      'Introducing advanced network security features for AKS to support zero-trust architectures by default.',
    provider: 'azure',
    time: '2 HRS AGO',
    category: 'Security',
    tag: 'NETWORKING',
  },
  {
    id: 2,
    title: 'AWS Lambda now supports Multi-Region Event Triggers',
    description:
      'Simplify your serverless disaster recovery with automated event replication across AWS regions.',
    provider: 'aws',
    time: '4 HRS AGO',
    category: 'Serverless',
    tag: 'ARCHITECTURE',
  },
  {
    id: 3,
    title: 'GCP BigQuery: Generative AI Functions in SQL',
    description:
      'Execute LLM prompts directly within your SQL queries using new built-in BigQuery ML functions.',
    provider: 'gcp',
    time: '6 HRS AGO',
    category: 'Data & AI',
    tag: 'INNOVATION',
  },
  {
    id: 4,
    title: 'FinOps Guide: Optimizing GPU Spot Instances',
    description:
      'Strategies for managing high-cost AI workloads using spot instances without sacrificing reliability.',
    provider: 'finops',
    time: '1 DAY AGO',
    category: 'Cost Mgmt',
    tag: 'OPTIMIZATION',
  },
  {
    id: 5,
    title: 'Terraform: Cross-Cloud Module Registry Updates',
    description:
      'New verified modules for managing hybrid-cloud connectivity across all three major providers.',
    provider: 'terraform',
    time: '1 DAY AGO',
    category: 'IaC',
    tag: 'DEVELOPMENT',
  },
  {
    id: 6,
    title: 'GitHub Actions: Enhanced Security for OIDC',
    description:
      'Strengthen your CI/CD pipelines with more granular controls for OpenID Connect authentication.',
    provider: 'github',
    time: '2 DAYS AGO',
    category: 'CI/CD',
    tag: 'SECURITY',
  },
  {
    id: 7,
    title: 'Azure AI Search: Vector Store Capacity Increased',
    description:
      'Scale your RAG applications with 5x more vector storage capacity in the latest Azure AI Search tier.',
    provider: 'azure',
    time: '2 DAYS AGO',
    category: 'AI/ML',
    tag: 'PERFORMANCE',
  },
  {
    id: 8,
    title: 'AWS Cost Explorer: New Granular Usage Reports',
    description:
      'Get deep visibility into managed service costs with per-request billing breakdown and forecasting.',
    provider: 'aws',
    time: '3 DAYS AGO',
    category: 'FinOps',
    tag: 'GOVERNANCE',
  },
  {
    id: 9,
    title: 'GCP GKE: Autopilot for High-Performance Computing',
    description:
      'Run your HPC workloads with the simplicity of Autopilot while maintaining raw performance control.',
    provider: 'gcp',
    time: '3 DAYS AGO',
    category: 'Containers',
    tag: 'RELIABILITY',
  },
  {
    id: 10,
    title: 'FinOps: Unit Economics Benchmarking Report',
    description:
      'Latest industry standards for measuring cloud cost efficiency relative to business growth indicators.',
    provider: 'finops',
    time: '4 DAYS AGO',
    category: 'Cost Mgmt',
    tag: 'BENCHMARKING',
  },
];

const PROVIDER_THEMES = {
  azure: { bg: 'hsl(var(--azure-blue) / 0.16)', border: 'border-l-azure', text: 'text-azure' },
  aws: { bg: 'hsl(var(--aws-orange) / 0.16)', border: 'border-l-aws', text: 'text-aws' },
  gcp: { bg: 'hsl(var(--gcp-red) / 0.16)', border: 'border-l-gcp', text: 'text-gcp' },
  finops: { bg: 'hsl(var(--finops-green) / 0.12)', border: 'border-l-finops', text: 'text-finops' },
  terraform: {
    bg: 'hsl(var(--terraform-purple) / 0.12)',
    border: 'border-l-terraform',
    text: 'text-terraform',
  },
  github: { bg: 'hsl(var(--github-gray) / 0.08)', border: 'border-l-github', text: 'text-github' },
  vmware: { bg: 'hsl(var(--vmware-blue) / 0.12)', border: 'border-l-vmware', text: 'text-vmware' },
  ansible: {
    bg: 'hsl(var(--ansible-red) / 0.10)',
    border: 'border-l-ansible',
    text: 'text-ansible',
  },
};

const PROVIDER_BG_ICONS = {
  azure: '/icons/providers/azure_bg.jpg',
  aws: '/icons/providers/aws_bg.jpg',
  gcp: '/icons/providers/gcp_bg.jpg',
  finops: '/icons/providers/finops_bg.png',
  terraform: '/icons/providers/terraform_bg.png',
  github: '/icons/providers/github_bg.png',
  vmware: '/icons/providers/vmware_bg.png',
  ansible: '/icons/providers/ansible_bg.png',
};

const PROVIDER_ICONS = {
  azure: 'rss_feed',
  aws: 'rss_feed',
  gcp: 'rss_feed',
  finops: 'rss_feed',
  terraform: 'layers',
  github: 'terminal',
  vmware: 'rss_feed',
  ansible: 'terminal',
};

const getHealthBadgeClass = (status) => {
  if (status === 'DEGRADED' || status === 'REGIONAL IMPACT') {
    return 'text-amber-600 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/20';
  }
  if (status === 'OPERATIONAL') {
    return 'text-emerald-600 dark:text-emerald-400 bg-emerald-100/50 dark:bg-emerald-900/20';
  }
  return 'text-slate-600 dark:text-slate-300 bg-slate-100/70 dark:bg-slate-800/70';
};

const getOverallHealth = (statuses) => {
  const values = Object.values(statuses);
  if (values.includes('DEGRADED') || values.includes('REGIONAL IMPACT')) return 'DEGRADED';
  if (values.every((status) => status === 'OPERATIONAL')) return 'OPERATIONAL';
  return 'CHECKING';
};

const getOverallHealthIconClass = (status) => {
  if (status === 'DEGRADED') return 'text-amber-500';
  if (status === 'OPERATIONAL') return 'text-emerald-500';
  return 'text-slate-500';
};

const getOverallHealthIcon = (status) => {
  if (status === 'DEGRADED') return 'warning';
  if (status === 'OPERATIONAL') return 'check_circle';
  return 'sync';
};

const shouldFetchPlatformHealth = (functionsBase) => {
  if (!functionsBase) return false;
  if (typeof window === 'undefined') return true;

  const isLocalOrigin = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const isRemoteFunctionsBase = functionsBase.includes('cloudfunctions.net');
  return !(isLocalOrigin && isRemoteFunctionsBase);
};

export default function HomePage() {
  const { theme } = useTheme();
  const [startIndex, setStartIndex] = useState(0);
  const [healthStatuses, setHealthStatuses] = useState({
    aws: 'CHECKING',
    azure: 'CHECKING',
    gcp: 'CHECKING',
    github: 'CHECKING',
  });
  const [lastVerified, setLastVerified] = useState('Syncing...');

  useEffect(() => {
    const timer = setInterval(() => {
      setStartIndex((prev) => (prev + 1) % vendorDesigns.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchHealth = async () => {
      const now = new Date();
      const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const functionsBase = getFunctionsBase();

      if (!shouldFetchPlatformHealth(functionsBase)) {
        setLastVerified('Health API unavailable');
        return;
      }

      try {
        const res = await fetch(`${functionsBase}/getPlatformHealth`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok || !data.statuses) throw new Error('Invalid health response');

        setHealthStatuses({
          aws: data.statuses.aws || 'UNKNOWN',
          azure: data.statuses.azure || 'UNKNOWN',
          gcp: data.statuses.gcp || 'UNKNOWN',
          github: data.statuses.github || 'UNKNOWN',
        });
      } catch {
        setLastVerified('Health check unavailable');
        return;
      }
      setLastVerified(`Verified at ${timestamp}`);
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 3600000); // Check every hour
    return () => clearInterval(interval);
  }, []);

  const visibleDesigns = [
    vendorDesigns[startIndex],
    vendorDesigns[(startIndex + 1) % vendorDesigns.length],
    vendorDesigns[(startIndex + 2) % vendorDesigns.length],
    vendorDesigns[(startIndex + 3) % vendorDesigns.length],
  ];
  const overallHealth = getOverallHealth(healthStatuses);
  return (
    <main className="relative z-10 max-w-[1400px] mx-auto w-full px-4 md:px-8 py-8 flex flex-col gap-16 bg-background text-foreground">
      <Helmet>
        <title>HybridCloudWorks | Multi-Cloud Architecture Command Center</title>
      </Helmet>

      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-x-0 top-0 h-[60vh] ambient-glow"></div>
        <div className="absolute -top-40 left-1/2 h-130 w-130 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(214,178,120,0.1),transparent_65%)] blur-2xl"></div>
        <div className="absolute top-40 -right-24 h-90 w-90 rounded-full bg-[radial-gradient(circle_at_center,rgba(194,180,144,0.12),transparent_70%)] blur-2xl"></div>
        <div className="absolute bottom-0 left-10 h-70 w-70 rounded-full bg-[radial-gradient(circle_at_center,rgba(130,113,110,0.1),transparent_70%)] blur-2xl"></div>
      </div>

      {/* Hero Section */}
      <section className="relative w-full grid lg:grid-cols-2 gap-10 items-center pt-6">
        <div className="flex flex-col gap-6">
          <Eyebrow>Build. Document. Operationalize.</Eyebrow>
          <h1 className="display-heading text-4xl sm:text-5xl lg:text-6xl text-slate-900 dark:text-white max-w-2xl">
            Multi-cloud architecture,
            <br />
            <span className="display-accent">engineered to ship.</span>
          </h1>
          <p className="text-base sm:text-lg text-slate-700 dark:text-(--subtitle-gray) max-w-xl leading-relaxed">
            HybridCloudWorks is a centralized platform for designing, documenting, and
            operationalizing multi-cloud architectures, frameworks, and implementation patterns
            across AWS, Azure, GCP, and FinOps — curated reference designs, deployment blueprints,
            compliance checklists, and automation tools for cloud architects and engineers.
          </p>
          <div className="flex flex-wrap gap-4 mt-2">
            <a
              href="#hubs"
              className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-7 py-3 text-[11px] uppercase tracking-[0.24em] font-semibold font-sans transition-opacity hover:opacity-90"
            >
              Browse All Hubs
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </a>
          </div>
          {/* Glassy stat blocks (Hyoga "Global Reach 35+" style) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <StatBlock value="24" suffix="+" label="Blueprints" />
            <StatBlock value="104" suffix="+" label="Articles" />
            <StatBlock value="22" suffix="+" label="Modules" />
            <StatBlock value="99.9" suffix="%" label="Uptime" />
          </div>
        </div>
        <div className="relative h-100 lg:h-130 w-full flex items-center justify-center hero-mesh rounded-2xl border border-glass-border overflow-hidden group">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(172,183,174,0.2),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(194,180,144,0.14),transparent_50%)] opacity-90"></div>
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(45deg, rgba(255,255,255,0.02) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0.02) 75%, transparent 75%, transparent)',
              backgroundSize: '20px 20px',
              opacity: 0.28,
            }}
          ></div>
          <div className="relative z-10 w-64 h-64 md:w-80 md:h-80 flex items-center justify-center">
            <div className="w-full h-full bg-slate-800 rounded-xl flex items-center justify-center">
              <img
                src="/icons/hcw-logo.png"
                alt="HybridCloudWorks logo"
                width="320"
                height="320"
                fetchPriority="high"
                decoding="async"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="absolute -top-5 -right-5 w-24 h-24 border border-slate-500/30 rounded-lg transform -rotate-12 bg-slate-700/60 backdrop-blur-md flex items-center justify-center animate-[bounce_5s_infinite]">
              <span className="material-symbols-outlined text-4xl text-(--popover-foreground)">
                cloud
              </span>
            </div>
            <div
              className="absolute -left-2.5 w-32 h-16 border border-slate-500/30 rounded-lg bg-slate-700/60 backdrop-blur-md flex items-center justify-center gap-2"
              style={{ bottom: '-35px', transform: 'rotate(7deg)' }}
            >
              <div className="w-2 h-2 rounded-full bg-muted"></div>
              <span className="text-xs font-mono text-(--popover-foreground)">Online</span>
            </div>
            <div className="absolute -top-5 -left-5 w-20 h-20 border border-slate-500/30 rounded-lg transform rotate-0 bg-slate-700/60 backdrop-blur-md flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-(--popover-foreground)">
                shield
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Provider logo strip (marquee-style row) */}
      <section aria-label="Provider hubs" className="relative">
        <div className="flex flex-wrap items-center justify-between gap-6 border-y border-glass-border py-6 px-2">
          {PROVIDER_LOGOS.map((logo) => (
            <Link
              key={logo.provider}
              to={routes.landing(logo.provider)}
              className="flex items-center gap-2 opacity-60 grayscale transition-all hover:opacity-100 hover:grayscale-0"
              aria-label={`${logo.label} hub`}
            >
              {logo.provider === 'github' ? (
                <img
                  src={getProviderLogoSrc('github', theme)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-7 w-auto object-contain"
                />
              ) : (
                <img
                  src={logo.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-7 w-auto object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              )}
              <span className="eyebrow-label text-slate-600 dark:text-slate-400">{logo.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Value Pillars */}
      <NumberedSection number={1} eyebrow="Capabilities" title="Build. Learn. Scale.">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Build and Test */}
          {/* Build and Test */}
          <div className="glass-panel group rounded-xl p-6 border border-secondary/40 hover:border-accent/80 transition-colors relative min-h-65 overflow-hidden hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/20 flex flex-col">
            <div className="h-11 w-11 rounded-lg bg-white/70 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 flex items-center justify-center mb-4 transition-transform group-hover:scale-95 group-hover:opacity-0 delay-75 duration-300">
              <span className="material-symbols-outlined text-slate-700 dark:text-(--popover-foreground)">
                build
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 font-display transition-opacity group-hover:opacity-0 delay-75 duration-300">
              Build and Test
            </h3>
            <p className="text-sm text-slate-700 dark:text-(--subtitle-gray) leading-relaxed transition-opacity group-hover:opacity-0 delay-75 duration-300">
              Explore battle-tested architecture designs and comprehensive blueprints for enterprise
              cloud deployments.
            </p>

            {/* Floating Blurry Pane */}
            <div className="absolute inset-0 bg-white/85 dark:bg-slate-900/90 backdrop-blur-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-20 flex flex-col p-6 rounded-xl border border-glass-border">
              <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-3">
                Architectures
              </h4>
              <div className="flex flex-col gap-2 flex-1 justify-center">
                <Link
                  to={routes.architectureDesigns('azure')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-azure shadow-[0_0_6px_hsl(var(--azure-blue))]"></span>
                  <span className="font-aptos font-semibold text-lg tracking-tight text-azure">
                    Azure Architectures
                  </span>
                </Link>
                <Link
                  to={routes.architectureDesigns('aws')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-aws shadow-[0_0_6px_hsl(var(--aws-orange))]"></span>
                  <span className="font-ember font-semibold text-lg tracking-tight text-aws">
                    AWS Architectures
                  </span>
                </Link>
                <Link
                  to={routes.architectureDesigns('gcp')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--gcp-red) / 1)] shadow-[0_0_6px_hsl(var(--gcp-red))]"></span>
                  <span className="font-googlesans font-semibold text-lg tracking-tight text-[hsl(var(--gcp-red))]">
                    GCP Architectures
                  </span>
                </Link>
                <Link
                  to={routes.frameworks('finops')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-finops shadow-[0_0_6px_hsl(var(--finops-green))]"></span>
                  <span className="font-display font-semibold text-lg tracking-tight text-finops">
                    FinOps Frameworks
                  </span>
                </Link>
              </div>
            </div>
          </div>

          {/* Learn and Compare */}
          <div className="glass-panel group rounded-xl p-6 border border-secondary/40 hover:border-accent/80 transition-colors relative min-h-65 overflow-hidden hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/20 flex flex-col">
            <div className="h-11 w-11 rounded-lg bg-white/70 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 flex items-center justify-center mb-4 transition-transform group-hover:scale-95 group-hover:opacity-0 delay-75 duration-300">
              <span className="material-symbols-outlined text-slate-700 dark:text-(--popover-foreground)">
                school
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 font-display transition-opacity group-hover:opacity-0 delay-75 duration-300">
              Learnings and Certifications
            </h3>
            <p className="text-sm text-slate-700 dark:text-(--subtitle-gray) leading-relaxed transition-opacity group-hover:opacity-0 delay-75 duration-300">
              Study guides and certification paths to master cloud technologies.
            </p>

            {/* Floating Blurry Pane */}
            <div className="absolute inset-0 bg-white/85 dark:bg-slate-900/90 backdrop-blur-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-20 flex flex-col p-6 rounded-xl border border-glass-border">
              <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-3">
                Learning Hubs
              </h4>
              <div className="flex flex-col gap-3 flex-1 justify-center">
                <Link
                  to={routes.education('azure')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-azure shadow-[0_0_6px_hsl(var(--azure-blue))]"></span>
                  <span className="font-aptos font-semibold text-lg tracking-tight text-azure">
                    Azure Learning
                  </span>
                </Link>
                <Link
                  to={routes.education('aws')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-aws shadow-[0_0_6px_hsl(var(--aws-orange))]"></span>
                  <span className="font-ember font-semibold text-lg tracking-tight text-aws">
                    AWS Learning
                  </span>
                </Link>
                <Link
                  to={routes.education('gcp')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--gcp-red) / 1)] shadow-[0_0_6px_hsl(var(--gcp-red))]"></span>
                  <span className="font-googlesans font-semibold text-lg tracking-tight text-[hsl(var(--gcp-red))]">
                    GCP Learning
                  </span>
                </Link>
                <Link
                  to={routes.frameworks('finops')}
                  className="flex items-center gap-3 group/link hover:pl-2 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-finops shadow-[0_0_6px_hsl(var(--finops-green))]"></span>
                  <span className="font-display font-semibold text-lg tracking-tight text-finops">
                    FinOps Frameworks
                  </span>
                </Link>
              </div>
            </div>
          </div>

          {/* Share and Scale */}
          <div className="glass-panel group rounded-xl p-6 border border-secondary/40 hover:border-accent/80 transition-colors relative min-h-65 overflow-hidden hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/20 flex flex-col">
            <div className="h-11 w-11 rounded-lg bg-white/70 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 flex items-center justify-center mb-4 transition-transform group-hover:scale-95 group-hover:opacity-0 delay-75 duration-300">
              <span className="material-symbols-outlined text-slate-700 dark:text-(--popover-foreground)">
                share
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 font-display transition-opacity group-hover:opacity-0 delay-75 duration-300">
              Frameworks and Practices
            </h3>
            <p className="text-sm text-slate-700 dark:text-(--subtitle-gray) leading-relaxed transition-opacity group-hover:opacity-0 delay-75 duration-300">
              Accelerate development with standardized frameworks and automated DevOps workflows
              tailored for scale.
            </p>

            {/* Floating Blurry Pane */}
            <div className="absolute inset-0 bg-white/85 dark:bg-slate-900/90 backdrop-blur-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-20 flex flex-col p-6 rounded-xl border border-glass-border">
              <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-3">
                Frameworks, Modules and Workflows
              </h4>
              <div className="flex flex-col gap-3 flex-1 justify-center">
                <Link
                  to={routes.frameworks('azure')}
                  className="flex items-center gap-3 group/link hover:pl-1 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-azure shadow-[0_0_6px_hsl(var(--azure-blue))]"></span>
                  <span className="font-aptos font-semibold text-lg tracking-tight text-azure">
                    Azure Frameworks
                  </span>
                </Link>
                <Link
                  to={routes.frameworks('aws')}
                  className="flex items-center gap-3 group/link hover:pl-1 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-aws shadow-[0_0_6px_hsl(var(--aws-orange))]"></span>
                  <span className="font-ember font-semibold text-lg tracking-tight text-aws">
                    AWS Frameworks
                  </span>
                </Link>
                <Link
                  to={routes.frameworks('gcp')}
                  className="flex items-center gap-3 group/link hover:pl-1 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--gcp-red) / 1)] shadow-[0_0_6px_hsl(var(--gcp-red))]"></span>
                  <span className="font-googlesans font-semibold text-lg tracking-tight text-[hsl(var(--gcp-red))]">
                    GCP Frameworks
                  </span>
                </Link>
                <Link
                  to={routes.frameworks('finops')}
                  className="flex items-center gap-3 group/link hover:pl-1 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-finops shadow-[0_0_6px_hsl(var(--finops-green))]"></span>
                  <span className="font-display font-semibold text-lg tracking-tight text-finops">
                    FinOps Frameworks
                  </span>
                </Link>
                <Link
                  to={routes.modules('terraform')}
                  className="flex items-center gap-3 group/link hover:pl-1 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-terraform shadow-[0_0_6px_hsl(var(--terraform-purple))]"></span>
                  <span className="font-terraform font-semibold text-lg tracking-tight text-terraform">
                    Terraform Modules
                  </span>
                </Link>
                <Link
                  to={routes.workflows('github')}
                  className="flex items-center gap-3 group/link hover:pl-1 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-github dark:bg-slate-200"></span>
                  <span className="font-monasans font-semibold text-lg tracking-tight text-github dark:text-slate-200">
                    GitHub Workflows
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </NumberedSection>

      {/* Inspiration Gallery */}
      <NumberedSection
        number={2}
        eyebrow="Cloud Vendor Collections"
        title="Architectural Designs from Cloud Vendors"
        className="glass-panel rounded-2xl p-6 md:p-8 overflow-hidden"
      >
        <div className="relative">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {visibleDesigns.map((design) => (
              <Link
                key={design.slug}
                to={`/${design.provider}/architecture-designs/${design.slug}`}
                className="group rounded-xl border border-slate-700/40 overflow-hidden bg-slate-900/40 flex flex-col h-50 cursor-pointer transition-transform duration-300 hover:-translate-y-1"
              >
                {/* Top Half: "Screenshot" simulation */}
                <div className="flex-1 bg-slate-800/50 flex items-center justify-center relative overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: `radial-gradient(circle at center, ${design.color} 0%, transparent 70%)`,
                    }}
                  ></div>
                  <span
                    className="material-symbols-outlined text-4xl dark:text-white/30 text-slate-400 z-10"
                    style={{ color: `${design.color}44` }}
                  >
                    {design.icon}
                  </span>
                  <div className="absolute bottom-2 right-2 text-[8px] font-mono text-slate-500 uppercase">
                    Snapshot v2.0
                  </div>
                </div>

                {/* Bottom Half: Ultra-Light Provider Shaded Color */}
                <div
                  className="p-4 pt-3 pb-1 h-22.5 flex flex-col relative"
                  style={{ backgroundColor: design.color }}
                >
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight line-clamp-2">
                    {design.title}
                  </h3>
                  <div className="absolute bottom-0 left-2 h-6 w-6 flex items-center">
                    {design.provider === 'github' ? (
                      <img
                        src={getProviderLogoSrc('github', theme)}
                        alt="GitHub logo"
                        loading="lazy"
                        decoding="async"
                        className="h-4 w-auto object-contain"
                      />
                    ) : (
                      <img
                        src={getProviderLogoSrc(design.provider, theme)}
                        alt={`${design.provider} logo`}
                        loading="lazy"
                        decoding="async"
                        className={`${design.provider === 'finops' || design.provider === 'vmware' ? 'h-6' : 'h-4'} w-auto object-contain`}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                  <p className="text-[9px] uppercase font-black text-slate-800 dark:text-slate-300 tracking-wider absolute bottom-0 right-3">
                    {design.pillar}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </NumberedSection>

      {/* Content Grid */}
      <NumberedSection number={3} eyebrow="Live Signal" title="Active Feeds" id="hubs">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
          {/* Feed Column */}
          <div className="lg:col-span-9 flex flex-col gap-6">
            {/* Quick Access Hubs moved to sidebar for vertical layout */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 glass-panel rounded-lg">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-slate-600 dark:text-slate-400">
                  rss_feed
                </span>
                <span className="eyebrow-label text-slate-700 dark:text-slate-300">
                  Latest from the providers
                </span>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 text-xs font-mono rounded bg-secondary hover:bg-[hsl(var(--secondary)/0.9)] text-(--primary-foreground) border border-secondary dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white dark:border-slate-600">
                  Last 24 Hours: 3
                </button>
                {/* Removed filter buttons */}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {latestFeeds.map((feed) => (
                <article
                  key={feed.id}
                  className={`dashboard-card rounded-md p-4 flex flex-col sm:flex-row gap-4 border-l-4 ${PROVIDER_THEMES[feed.provider].border} transition-all group relative overflow-hidden mr-[5%]`}
                  style={{ backgroundColor: PROVIDER_THEMES[feed.provider].bg }}
                >
                  <div className="w-full sm:w-48 h-28 bg-white/50 dark:bg-slate-800/50 rounded shrink-0 overflow-hidden relative border border-slate-200/50 dark:border-slate-700/50">
                    <img
                      src={PROVIDER_BG_ICONS[feed.provider]}
                      alt={feed.provider}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="flex flex-col justify-between flex-1 py-1">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="material-symbols-outlined text-slate-600 dark:text-slate-400 text-base">
                          {PROVIDER_ICONS[feed.provider] || 'rss_feed'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-700 dark:text-white uppercase font-bold">
                          {feed.provider.toUpperCase()} :: {feed.tag}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight mb-2 group-hover:translate-x-1 transition-transform">
                        {feed.title}
                      </h3>
                      <p className="text-sm text-slate-800 dark:text-slate-300 line-clamp-2 leading-relaxed">
                        {feed.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-900/10">
                      <span className="text-xs text-slate-600 dark:text-white font-mono flex items-center gap-1 font-bold">
                        <span className="material-symbols-outlined text-[14px]">
                          calendar_today
                        </span>{' '}
                        {feed.time}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="lg:col-span-3 flex flex-col gap-6">
            <div className="glass-panel rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-300/70 dark:border-slate-700/50 pb-2">
                <div className="flex flex-col">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-400">
                    Platform Health
                  </h3>
                  <span className="text-[8px] text-slate-500 font-mono mt-0.5">{lastVerified}</span>
                </div>
                <span
                  className={`material-symbols-outlined text-sm animate-pulse ${getOverallHealthIconClass(overallHealth)}`}
                >
                  {getOverallHealthIcon(overallHealth)}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                <a
                  href="https://www.cloudlookingglass.com/aws.rss"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between group/status hover:bg-slate-100/50 dark:hover:bg-slate-800/50 p-1 -m-1 rounded transition-colors"
                >
                  <span className="text-xs text-slate-700 dark:text-slate-300 group-hover/status:text-slate-900 dark:group-hover/status:text-white flex items-center gap-1">
                    Amazon Web Services
                    <span className="material-symbols-outlined text-[10px] opacity-0 group-hover/status:opacity-100 transition-opacity">
                      open_in_new
                    </span>
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${getHealthBadgeClass(healthStatuses.aws)}`}
                  >
                    {healthStatuses.aws}
                  </span>
                </a>
                <a
                  href="https://azure.microsoft.com/en-us/explore/global-infrastructure/products-by-region/table?msockid=23509514b2c567502fbc83a8b6c5654a"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between group/status hover:bg-slate-100/50 dark:hover:bg-slate-800/50 p-1 -m-1 rounded transition-colors"
                >
                  <span className="text-xs text-slate-700 dark:text-slate-300 group-hover/status:text-slate-900 dark:group-hover/status:text-white flex items-center gap-1">
                    Microsoft Azure
                    <span className="material-symbols-outlined text-[10px] opacity-0 group-hover/status:opacity-100 transition-opacity">
                      open_in_new
                    </span>
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${getHealthBadgeClass(healthStatuses.azure)}`}
                  >
                    {healthStatuses.azure}
                  </span>
                </a>
                <a
                  href="https://status.cloud.google.com/en/feed.atom"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between group/status hover:bg-slate-100/50 dark:hover:bg-slate-800/50 p-1 -m-1 rounded transition-colors"
                >
                  <span className="text-xs text-slate-700 dark:text-slate-300 group-hover/status:text-slate-900 dark:group-hover/status:text-white flex items-center gap-1">
                    Google Cloud
                    <span className="material-symbols-outlined text-[10px] opacity-0 group-hover/status:opacity-100 transition-opacity">
                      open_in_new
                    </span>
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${getHealthBadgeClass(healthStatuses.gcp)}`}
                  >
                    {healthStatuses.gcp}
                  </span>
                </a>
                <a
                  href="https://www.githubstatus.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between group/status hover:bg-slate-100/50 dark:hover:bg-slate-800/50 p-1 -m-1 rounded transition-colors"
                >
                  <span className="text-xs text-slate-700 dark:text-slate-300 group-hover/status:text-slate-900 dark:group-hover/status:text-white flex items-center gap-1">
                    GitHub Actions
                    <span className="material-symbols-outlined text-[10px] opacity-0 group-hover/status:opacity-100 transition-opacity">
                      open_in_new
                    </span>
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${getHealthBadgeClass(healthStatuses.github)}`}
                  >
                    {healthStatuses.github}
                  </span>
                </a>
              </div>
            </div>

            {/* Cloud Ecosystem Stats moved to hero stat blocks */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-400">
                  Quick Access Hubs
                </h4>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-azure"
                  to={routes.rss('azure')}
                  style={{ '--glow-color': 'rgba(0, 120, 212, 0.4)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-white group-hover:text-slate-900 dark:group-hover:text-(--popover-foreground) transition-colors">
                    <span className="material-symbols-outlined text-xl">cloud_done</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-slate-900 dark:group-hover:text-white">
                      Azure
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono">
                      24 FEEDS
                    </span>
                  </div>
                </Link>
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-aws"
                  to={routes.rss('aws')}
                  style={{ '--glow-color': 'rgba(255, 153, 0, 0.4)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-white group-hover:text-slate-900 dark:group-hover:text-(--popover-foreground) transition-colors">
                    <span className="material-symbols-outlined text-xl">rocket_launch</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-slate-900 dark:group-hover:text-white">
                      AWS
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono">
                      32 FEEDS
                    </span>
                  </div>
                </Link>
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-gcp"
                  to={routes.rss('gcp')}
                  style={{ '--glow-color': 'rgba(219, 68, 55, 0.4)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-white group-hover:text-gcp transition-colors">
                    <span className="material-symbols-outlined text-xl">query_stats</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-gcp">
                      GCP
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono group-hover:text-gcp/80 transition-colors">
                      18 FEEDS
                    </span>
                  </div>
                </Link>
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-terraform"
                  to={routes.rss('terraform')}
                  style={{ '--glow-color': 'rgba(123, 66, 188, 0.4)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-white group-hover:text-terraform transition-colors">
                    <span className="material-symbols-outlined text-xl">layers</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-terraform">
                      Terraform
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono">
                      12 FEEDS
                    </span>
                  </div>
                </Link>
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-github"
                  to={routes.rss('github')}
                  style={{ '--glow-color': 'rgba(110, 118, 129, 0.4)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-muted-foreground group-hover:text-github transition-colors">
                    <span className="material-symbols-outlined text-xl">terminal</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-github">
                      GitHub
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono">
                      9 FEEDS
                    </span>
                  </div>
                </Link>
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-finops"
                  to={routes.rss('finops')}
                  style={{ '--glow-color': 'rgba(30, 164, 130, 0.4)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-muted-foreground group-hover:text-finops transition-colors">
                    <span className="material-symbols-outlined text-xl">payments</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-finops">
                      FinOps
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono">
                      7 FEEDS
                    </span>
                  </div>
                </Link>
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-vmware"
                  to={routes.rss('vmware')}
                  style={{ '--glow-color': 'rgba(0, 145, 218, 0.4)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-muted-foreground group-hover:text-vmware transition-colors">
                    <span className="material-symbols-outlined text-xl">dns</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-vmware">
                      VMware
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono">
                      NEW HUB
                    </span>
                  </div>
                </Link>
                <Link
                  className="hub-icon-btn glass-panel rounded-lg p-3 flex items-center gap-3 group border-l-4 border-l-transparent hover:border-l-ansible"
                  to={routes.rss('ansible')}
                  style={{ '--glow-color': 'rgba(238, 0, 0, 0.35)' }}
                >
                  <div className="p-2 rounded bg-white/70 dark:bg-slate-800/50 text-slate-700 dark:text-muted-foreground group-hover:text-ansible transition-colors">
                    <span className="material-symbols-outlined text-xl">terminal</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900 dark:text-(--popover-foreground) group-hover:text-ansible">
                      Ansible
                    </span>
                    <span className="text-[10px] text-slate-600 dark:text-white font-mono">
                      NEW HUB
                    </span>
                  </div>
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </NumberedSection>
    </main>
  );
}
