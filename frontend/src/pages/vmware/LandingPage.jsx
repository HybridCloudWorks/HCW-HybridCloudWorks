import React from 'react';
import { Link } from 'react-router-dom';
import { routes } from '@/lib/routeFactory';
import ProviderLandingTemplate from '@/components/shared/ProviderLandingTemplate';

const ARCHITECTURE_CARDS = [
  {
    label: 'Private Cloud',
    meta: 'VCF',
    title: 'VMware Cloud Foundation',
    text: 'Full-stack SDDC blueprint — vSphere, vSAN, NSX, and Aria automation for a consistent private-cloud platform.',
    tags: ['vSphere', 'vSAN', 'NSX'],
  },
  {
    label: 'Hybrid',
    meta: 'Multi-Cloud',
    title: 'Hybrid Cloud Extension',
    text: 'HCX-based workload mobility between on-premises vSphere and hyperscaler-hosted VMware SDDCs with zero-downtime migration.',
    tags: ['HCX', 'AVS', 'VMC'],
  },
];

const FRAMEWORKS = [
  {
    abbr: 'VCF',
    name: 'VMware Cloud Foundation',
    description:
      'Integrated software-defined data center stack with standardized architecture for compute, storage, and networking.',
  },
  {
    abbr: 'VVD',
    name: 'VMware Validated Designs',
    description:
      'Prescriptive, tested blueprints for deploying and operating VMware SDDC environments at scale.',
  },
  {
    abbr: 'NSX-REF',
    name: 'NSX Reference Designs',
    description:
      'Network virtualization and micro-segmentation patterns for zero-trust east-west security.',
  },
];

const CERTS = [
  {
    code: 'VCP-VCF',
    title: 'VCP — VMware Cloud Foundation',
    difficulty: 'Professional',
    duration: '~3 months',
    skills: ['vSphere', 'vSAN', 'NSX'],
  },
  {
    code: 'VCAP-DCV',
    title: 'VCAP — Data Center Virtualization',
    difficulty: 'Advanced',
    duration: '~6 months',
    skills: ['Design', 'Deploy', 'Operate'],
  },
];

function ArchitectureCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {ARCHITECTURE_CARDS.map((card) => (
        <Link
          key={card.title}
          to={routes.architectureDesigns('vmware')}
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

function CertList() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {CERTS.map(({ code, title, difficulty, duration, skills }) => (
        <Link
          key={code}
          to={routes.education('vmware')}
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

export default function VMwareLandingPage() {
  return (
    <ProviderLandingTemplate
      provider="vmware"
      hero={{
        eyebrow: 'PRIVATE CLOUD · VIRTUALIZATION · HYBRID',
        title: (
          <>
            Architecture intelligence for <span className="display-accent">VMware</span>
          </>
        ),
        description:
          'Private-cloud and hybrid architectures built on VMware Cloud Foundation — vSphere, vSAN, and NSX patterns for modernizing the data center and extending it to the hyperscalers.',
        cta: { label: 'Explore Architectures', to: routes.architectureDesigns('vmware') },
        stats: [
          { value: '3', label: 'Validated Designs' },
          { value: '2', suffix: '+', label: 'Reference Blueprints' },
          { value: '2', label: 'Cert Tracks' },
        ],
      }}
      sections={[
        {
          eyebrow: 'REFERENCE DESIGNS',
          title: 'VMware Reference Architectures',
          action: { label: 'All designs', to: routes.architectureDesigns('vmware') },
          content: <ArchitectureCards />,
        },
        {
          eyebrow: 'GUIDANCE',
          title: 'Frameworks',
          action: { label: 'All frameworks', to: routes.frameworks('vmware') },
          content: <FrameworkCards />,
        },
        {
          eyebrow: 'LEARNING CENTER',
          title: 'Certification Tracks',
          action: { label: 'All certifications', to: routes.education('vmware') },
          content: <CertList />,
        },
      ]}
    />
  );
}
