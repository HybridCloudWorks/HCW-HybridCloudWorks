import React from 'react';
import { Link } from 'react-router';
import { routes } from '@/lib/routeFactory';
import ProviderLandingTemplate from '@/components/shared/ProviderLandingTemplate';
import HeroImageCarousel from '@/components/landing/HeroImageCarousel';

// No terraform hero set exists under public/images/ yet (#371); the carousel renders
// nothing for an empty list, which beats five 404s and broken <img> boxes.
// Add the files (1155×924 RGBA PNG like azure-hero/) and list them here;
// frontend/scripts/hero-assets-exist.test.js fails on a path that does not exist.
const TERRAFORM_HERO_IMAGES = [];

/*
 * NOTE: links previously pointed at /terraform/frameworks and
 * /terraform/architecture-designs which 404 (Terraform is not handled by
 * the frameworks/architecture dispatchers). All links now target live
 * routes: /terraform/modules, /terraform/code, /terraform/education.
 */

const MODULE_CARDS = [
  {
    label: 'Multi-Cloud',
    meta: 'Reusable',
    title: 'Module Collections',
    text: 'Curated, production-ready Terraform modules for common infrastructure patterns across AWS, Azure, and GCP.',
    tags: ['AWS', 'Azure', 'GCP'],
    to: routes.modules('terraform'),
  },
  {
    label: 'Enterprise',
    meta: 'HCP Terraform',
    title: 'Sentinel Policies',
    text: 'Policy-as-code with Sentinel and OPA for team workflows, drift detection, and VCS integration.',
    tags: ['Sentinel', 'OPA', 'Drift'],
    to: routes.modules('terraform'),
  },
];

const QUICK_LINKS = [
  {
    icon: 'layers',
    title: 'Reusable Modules',
    desc: 'Production-ready modules for AWS, Azure, and GCP.',
    to: routes.modules('terraform'),
  },
  {
    icon: 'code',
    title: 'Code Patterns',
    desc: 'Terraform snippets and implementation notes from Coder Corner.',
    to: routes.code('terraform'),
  },
  {
    icon: 'bolt',
    title: 'CI/CD Integration',
    desc: 'Automated testing and deployment pipelines for IaC.',
    to: routes.tools('terraform'),
  },
  {
    icon: 'school',
    title: 'Certification Prep',
    desc: 'Terraform Associate and enterprise learning tracks.',
    to: routes.education('terraform'),
  },
];

const LEARNING = [
  {
    code: 'TA-003',
    title: 'Terraform Associate',
    difficulty: 'Associate',
    duration: '6 weeks',
    skills: ['HCL', 'State', 'Modules'],
  },
  {
    code: 'TF-MULTI',
    title: 'Multi-Cloud IaC',
    difficulty: 'Intermediate',
    duration: '8 weeks',
    skills: ['AWS', 'Azure', 'GCP'],
  },
  {
    code: 'HCP-TF',
    title: 'HCP Terraform Enterprise',
    difficulty: 'Professional',
    duration: '10 weeks',
    skills: ['Sentinel', 'OPA', 'Drift'],
  },
];

function ModuleCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {MODULE_CARDS.map((card) => (
        <Link
          key={card.title}
          to={card.to}
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

function QuickReference() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {QUICK_LINKS.map(({ icon, title, desc, to }) => (
        <Link
          key={title}
          to={to}
          className="glass glass-hover rounded-xl flex items-center gap-3 p-4 group/item"
        >
          <div className="size-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              {icon}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-snug">{title}</h3>
            <p className="text-[11px] text-slate-500 leading-snug">{desc}</p>
          </div>
          <span
            className="material-symbols-outlined text-slate-400 group-hover/item:text-primary transition-colors text-base shrink-0"
            aria-hidden="true"
          >
            chevron_right
          </span>
        </Link>
      ))}
    </div>
  );
}

function LearningList() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {LEARNING.map(({ code, title, difficulty, duration, skills }) => (
        <Link
          key={code}
          to={routes.education('terraform')}
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

export default function TerraformLandingPage() {
  return (
    <ProviderLandingTemplate
      provider="terraform"
      hero={{
        eyebrow: 'INFRASTRUCTURE AS CODE',
        title: (
          <>
            Infrastructure intelligence with <span className="display-accent">Terraform</span>
          </>
        ),
        description:
          'Master Terraform with battle-tested modules, multi-cloud patterns, and enterprise-grade IaC workflows.',
        media: (
          <HeroImageCarousel
            images={TERRAFORM_HERO_IMAGES}
            intervalMs={3000}
            fadeMs={800}
            alt="Terraform infrastructure imagery"
          />
        ),
        cta: { label: 'Browse Modules', to: routes.modules('terraform') },
        stats: [
          { value: '12', label: 'Module Collections' },
          { value: '3', label: 'Cloud Providers' },
          { value: '40', suffix: '+', label: 'Ready-to-Use Modules' },
        ],
      }}
      sections={[
        {
          eyebrow: 'MODULE LIBRARY',
          title: 'Terraform Module Library',
          action: { label: 'All modules', to: routes.modules('terraform') },
          content: <ModuleCards />,
        },
        {
          eyebrow: 'QUICK REFERENCE',
          title: 'Most-Used Resources',
          content: <QuickReference />,
        },
        {
          eyebrow: 'LEARNING CENTER',
          title: 'Certification & Learning Tracks',
          action: { label: 'Learning hub', to: routes.education('terraform') },
          content: <LearningList />,
        },
      ]}
    />
  );
}
