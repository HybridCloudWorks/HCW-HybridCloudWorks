import React from 'react';
import { Link } from 'react-router';
import { routes } from '@/lib/routeFactory';
import ProviderLandingTemplate from '@/components/shared/ProviderLandingTemplate';
import HeroImageCarousel from '@/components/landing/HeroImageCarousel';
import usePodcastData from '@/hooks/usePodcastData';

// No gcp hero set exists under public/images/ yet (#371); the carousel renders
// nothing for an empty list, which beats five 404s and broken <img> boxes.
// Add the files (1155×924 RGBA PNG like azure-hero/) and list them here;
// scripts/hero-assets-exist.test.js fails on a path that does not exist.
const GCP_HERO_IMAGES = [];

const ARCHITECTURE_CARDS = [
  {
    label: 'Data Platform',
    meta: 'Streaming',
    title: 'Streaming Analytics Platform',
    text: 'Pub/Sub ingestion, Dataflow processing, BigQuery warehousing, and Looker dashboards with governance controls.',
    tags: ['Pub/Sub', 'Dataflow', 'BigQuery'],
  },
  {
    label: 'Containers',
    meta: 'Production GKE',
    title: 'Enterprise GKE Blueprint',
    text: 'Private GKE clusters, Workload Identity, policy guardrails, and GitOps deployment for production workloads.',
    tags: ['GKE', 'IAM', 'GitOps'],
  },
];

const FRAMEWORKS = [
  {
    abbr: 'GCAF',
    name: 'Google Cloud Architecture Framework',
    description:
      'Six areas of system design for reliable, secure, high-performing, cost-optimized GCP workloads.',
  },
  {
    abbr: 'GCAF-A',
    name: 'Google Cloud Adoption Framework',
    description:
      "Assess and improve your organization's cloud maturity across four themes: Learn, Lead, Scale, Secure.",
  },
  {
    abbr: 'GCLZ',
    name: 'Google Cloud Landing Zone',
    description:
      'Prescriptive, automated foundational environment for deploying GCP workloads with security and governance.',
  },
];

const CERTS = [
  {
    code: 'ACE',
    title: 'Associate Cloud Engineer',
    difficulty: 'Associate',
    duration: '~3 months',
    skills: ['Compute', 'Storage', 'Networking'],
  },
  {
    code: 'PCA',
    title: 'Professional Cloud Architect',
    difficulty: 'Professional',
    duration: '~6 months',
    skills: ['Architecture', 'GKE', 'Multi-Region'],
  },
  {
    code: 'PDE',
    title: 'Professional Data Engineer',
    difficulty: 'Professional',
    duration: '~6 months',
    skills: ['BigQuery', 'Dataflow', 'Pub/Sub'],
  },
];

function ArchitectureCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {ARCHITECTURE_CARDS.map((card) => (
        <Link
          key={card.title}
          to={routes.architectureDesigns('gcp')}
          className="glass glass-hover rounded-xl overflow-hidden flex flex-col"
        >
          <div className="h-2 w-full bg-primary/60" aria-hidden="true" />
          <div className="p-5 flex flex-col gap-2 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] bg-primary/15 text-primary px-2 py-0.5 rounded font-bold uppercase tracking-wide">
                {card.label}
              </span>
              <span className="text-[10px] text-slate-500">{card.meta}</span>
            </div>
            <h3 className="font-bold text-foreground">{card.title}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {card.text}
            </p>
            <div className="flex gap-1 flex-wrap mt-auto pt-2">
              {card.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function FrameworkCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {FRAMEWORKS.map(({ abbr, name, description }) => (
        <div key={abbr} className="glass rounded-xl p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="size-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-base" aria-hidden="true">
                account_tree
              </span>
            </div>
            <div>
              <div className="text-[10px] font-black text-primary/80 tracking-widest uppercase">
                {abbr}
              </div>
              <h3 className="text-sm font-bold text-foreground leading-snug">{name}</h3>
            </div>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        </div>
      ))}
    </div>
  );
}

function PodcastList() {
  const { episodes } = usePodcastData('gcp');
  if (!episodes || episodes.length === 0) {
    return <p className="text-sm text-slate-500 py-2">No episodes available yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {episodes.slice(0, 3).map((ep, i) => {
        const mins = ep.duration ? Math.floor(Number(ep.duration) / 60) : null;
        return (
          <Link
            key={ep.id}
            to={routes.audio('gcp')}
            className="glass glass-hover rounded-xl flex items-start gap-3 p-4"
          >
            <div className="size-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                play_circle
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-bold">
                  EP {i + 1}
                </span>
                {mins ? <span className="text-[10px] text-slate-500">{mins} min</span> : null}
              </div>
              <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">
                {ep.title}
              </h3>
              {ep.publishedAtString && (
                <p className="text-[10px] text-slate-500 mt-0.5">{ep.publishedAtString}</p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function CertList() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {CERTS.map(({ code, title, difficulty, duration, skills }) => (
        <Link
          key={code}
          to={routes.education('gcp')}
          className="glass glass-hover rounded-xl flex items-start gap-3 p-4"
        >
          <div className="size-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-base" aria-hidden="true">
              workspace_premium
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-[10px] font-black text-primary">{code}</span>
              <span className="text-[10px] text-slate-500">
                {difficulty} · {duration}
              </span>
            </div>
            <h3 className="text-sm font-bold text-foreground leading-snug">{title}</h3>
            <div className="flex gap-1 flex-wrap mt-1">
              {skills.map((s) => (
                <span
                  key={s}
                  className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function GCPLandingPage() {
  return (
    <ProviderLandingTemplate
      provider="gcp"
      hero={{
        eyebrow: 'DATA + AI + PLATFORM',
        title: (
          <>
            Architecture intelligence for <span className="display-accent">Google Cloud</span>
          </>
        ),
        description:
          "Unlock Google Cloud's data and AI capabilities with production-ready architectures for streaming analytics, enterprise GKE deployments, and machine learning pipelines — from Pub/Sub ingestion to BigQuery warehousing.",
        media: (
          <HeroImageCarousel
            images={GCP_HERO_IMAGES}
            intervalMs={3000}
            fadeMs={800}
            alt="Google Cloud architecture imagery"
          />
        ),
        cta: { label: 'Explore Architectures', to: routes.architectureDesigns('gcp') },
        stats: [
          { value: '6', label: 'Framework Areas' },
          { value: '2', suffix: '+', label: 'Reference Designs' },
          { value: '3', label: 'Cert Tracks' },
        ],
      }}
      sections={[
        {
          eyebrow: 'REFERENCE DESIGNS',
          title: 'Google Cloud Reference Architectures',
          action: { label: 'All designs', to: routes.architectureDesigns('gcp') },
          content: <ArchitectureCards />,
        },
        {
          eyebrow: 'GUIDANCE',
          title: 'Frameworks',
          action: { label: 'All frameworks', to: routes.frameworks('gcp') },
          content: <FrameworkCards />,
        },
        {
          eyebrow: 'ON AIR',
          title: 'Google Cloud Podcasts',
          action: { label: 'All episodes', to: routes.audio('gcp') },
          content: <PodcastList />,
        },
        {
          eyebrow: 'LEARNING CENTER',
          title: 'Certification Tracks',
          action: { label: 'All certifications', to: routes.education('gcp') },
          content: <CertList />,
        },
      ]}
    />
  );
}
