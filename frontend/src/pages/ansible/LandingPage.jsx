import React from 'react';
import { Link } from 'react-router-dom';
import { routes } from '@/lib/routeFactory';
import ProviderLandingTemplate from '@/components/shared/ProviderLandingTemplate';

const CODE_CARDS = [
  {
    label: 'Playbooks',
    meta: 'Reusable',
    title: 'Playbook Patterns',
    text: 'Idempotent, role-driven playbooks for configuration management across Linux, Windows, and network devices.',
    tags: ['Roles', 'Idempotency', 'Vault'],
    to: routes.code('ansible'),
  },
  {
    label: 'Event-Driven',
    meta: 'EDA',
    title: 'Event-Driven Automation',
    text: 'Rulebooks and event sources that trigger remediation automatically — self-healing infrastructure with Ansible EDA.',
    tags: ['Rulebooks', 'Webhooks', 'Remediation'],
    to: routes.code('ansible'),
  },
];

const QUICK_LINKS = [
  {
    icon: 'code',
    title: 'Code Patterns',
    desc: 'Playbooks, roles, and automation snippets from Coder Corner.',
    to: routes.code('ansible'),
  },
  {
    icon: 'article',
    title: 'Automation Blog',
    desc: 'Playbook design and platform engineering deep dives.',
    to: routes.blog('ansible'),
  },
  {
    icon: 'rss_feed',
    title: 'Ansible News',
    desc: 'Latest from the Ansible and Red Hat ecosystem.',
    to: routes.rss('ansible'),
  },
  {
    icon: 'school',
    title: 'Certification Prep',
    desc: 'RHCE and Ansible Automation Platform learning tracks.',
    to: routes.education('ansible'),
  },
];

const LEARNING = [
  {
    code: 'RHCE',
    title: 'Red Hat Certified Engineer',
    difficulty: 'Professional',
    duration: '~4 months',
    skills: ['Playbooks', 'Roles', 'Vault'],
  },
  {
    code: 'EX374',
    title: 'Developing Automation with AAP',
    difficulty: 'Specialist',
    duration: '~3 months',
    skills: ['Collections', 'EEs', 'CI/CD'],
  },
  {
    code: 'EX467',
    title: 'Managing Automation with AAP',
    difficulty: 'Specialist',
    duration: '~3 months',
    skills: ['Controller', 'Hub', 'RBAC'],
  },
];

function CodeCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {CODE_CARDS.map((card) => (
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
          to={routes.education('ansible')}
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

export default function AnsibleLandingPage() {
  return (
    <ProviderLandingTemplate
      provider="ansible"
      hero={{
        eyebrow: 'AUTOMATE. ORCHESTRATE. SCALE.',
        title: (
          <>
            Automation intelligence with <span className="display-accent">Ansible</span>
          </>
        ),
        description:
          'Battle-tested playbooks, event-driven automation patterns, and enterprise workflows for the Red Hat Ansible Automation Platform.',
        cta: { label: 'Browse Code Patterns', to: routes.code('ansible') },
        stats: [
          { value: '2', suffix: '+', label: 'Pattern Collections' },
          { value: '3', label: 'Cert Tracks' },
          { value: '100', suffix: '%', label: 'Idempotent' },
        ],
      }}
      sections={[
        {
          eyebrow: 'CODE LIBRARY',
          title: 'Automation Patterns',
          action: { label: 'All patterns', to: routes.code('ansible') },
          content: <CodeCards />,
        },
        {
          eyebrow: 'QUICK REFERENCE',
          title: 'Most-Used Resources',
          content: <QuickReference />,
        },
        {
          eyebrow: 'LEARNING CENTER',
          title: 'Certification & Learning Tracks',
          action: { label: 'Learning hub', to: routes.education('ansible') },
          content: <LearningList />,
        },
      ]}
    />
  );
}
