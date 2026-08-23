import React from 'react';
import { Link } from 'react-router';
import { routes } from '@/lib/routeFactory';
import ProviderLandingTemplate from '@/components/shared/ProviderLandingTemplate';
import HeroImageCarousel from '@/components/landing/HeroImageCarousel';
import usePodcastData from '@/hooks/usePodcastData';

const AWS_HERO_IMAGES = [
  '/images/aws-hero/1.png',
  '/images/aws-hero/2.png',
  '/images/aws-hero/3.png',
  '/images/aws-hero/4.png',
  '/images/aws-hero/5.png',
  '/images/aws-hero/6.png',
];

const ARCHITECTURE_CARDS = [
  {
    label: 'Networking',
    meta: 'Multi-Region',
    title: 'Global Load Balancing',
    text: 'Route 53 latency routing, CloudFront distributions, and ALB across regions with health-check failover and active-active traffic splitting.',
    tags: ['Route 53', 'CloudFront', 'ALB'],
  },
  {
    label: 'Serverless',
    meta: 'Event-Driven',
    title: 'Serverless API',
    text: 'API Gateway with Lambda authorizers, DynamoDB single-table design, WAF edge protection, and X-Ray distributed tracing.',
    tags: ['API Gateway', 'Lambda', 'DynamoDB'],
  },
];

const FRAMEWORKS = [
  {
    abbr: 'WAF',
    name: 'AWS Well-Architected Framework',
    description:
      'Six pillars for building secure, reliable, efficient, cost-effective, sustainable AWS workloads.',
  },
  {
    abbr: 'CAF',
    name: 'AWS Cloud Adoption Framework',
    description:
      'Guidance for accelerating cloud adoption across six perspectives: Business, People, Governance, Platform, Security, Operations.',
  },
  {
    abbr: 'LZA',
    name: 'AWS Landing Zone Accelerator',
    description:
      'Automated, multi-account AWS environment setup with security and governance guardrails built in.',
  },
];

const CERTS = [
  {
    slug: 'clf-c02',
    code: 'CLF-C02',
    title: 'Cloud Practitioner',
    difficulty: 'Foundational',
    duration: '1 month',
    skills: ['Cloud Basics', 'Billing', 'Security'],
  },
  {
    slug: 'saa-c03',
    code: 'SAA-C03',
    title: 'Solutions Architect Associate',
    difficulty: 'Associate',
    duration: '3 months',
    skills: ['EC2', 'S3', 'VPC', 'IAM'],
  },
  {
    slug: 'sap-c02',
    code: 'SAP-C02',
    title: 'Solutions Architect Professional',
    difficulty: 'Professional',
    duration: '6 months',
    skills: ['Multi-Region', 'Hybrid', 'Cost'],
  },
  {
    slug: 'scs-c02',
    code: 'SCS-C02',
    title: 'Security Specialty',
    difficulty: 'Specialty',
    duration: '4 months',
    skills: ['IAM', 'KMS', 'GuardDuty'],
  },
];

function ArchitectureCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {ARCHITECTURE_CARDS.map((card) => (
        <Link
          key={card.title}
          to={routes.architectureDesigns('aws')}
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
  const { episodes } = usePodcastData('aws');
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
            to={routes.audio('aws')}
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {CERTS.map(({ slug, code, title, difficulty, duration, skills }) => (
        <Link
          key={code}
          to={`/aws/education/${slug}`}
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

export default function AWSLandingPage() {
  return (
    <ProviderLandingTemplate
      provider="aws"
      hero={{
        eyebrow: 'BUILD. INNOVATE. ELEVATE.',
        title: (
          <>
            Architecture intelligence for <span className="display-accent">AWS</span>
          </>
        ),
        description:
          'Master AWS with proven patterns for global load balancing, serverless architectures, and event-driven microservices — reference implementations that combine AWS best practices with real-world operational insight.',
        media: (
          <HeroImageCarousel
            images={AWS_HERO_IMAGES}
            intervalMs={3000}
            fadeMs={800}
            alt="AWS cloud architecture imagery"
          />
        ),
        cta: { label: 'Explore Architectures', to: routes.architectureDesigns('aws') },
        stats: [
          { value: '6', label: 'WAF Pillars' },
          { value: '2', suffix: '+', label: 'Reference Designs' },
          { value: '4', label: 'Cert Tracks' },
        ],
      }}
      sections={[
        {
          eyebrow: 'REFERENCE DESIGNS',
          title: 'AWS Reference Architectures',
          action: { label: 'All designs', to: routes.architectureDesigns('aws') },
          content: <ArchitectureCards />,
        },
        {
          eyebrow: 'GUIDANCE',
          title: 'Frameworks',
          action: { label: 'All frameworks', to: routes.frameworks('aws') },
          content: <FrameworkCards />,
        },
        {
          eyebrow: 'ON AIR',
          title: 'AWS Podcasts',
          action: { label: 'All episodes', to: routes.audio('aws') },
          content: <PodcastList />,
        },
        {
          eyebrow: 'LEARNING CENTER',
          title: 'Certification Tracks',
          action: { label: 'All certifications', to: routes.education('aws') },
          content: <CertList />,
        },
      ]}
    />
  );
}
