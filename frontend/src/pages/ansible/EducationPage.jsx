import React from 'react';
import { Helmet } from 'react-helmet-async';

const TRACKS = [
  {
    code: 'RHCE (EX294)',
    title: 'Red Hat Certified Engineer — Ansible Automation',
    level: 'Professional',
    duration: '~4 months',
    skills: ['Playbooks', 'Roles', 'Variables', 'Vault'],
    url: 'https://www.redhat.com/en/services/certification/rhce',
  },
  {
    code: 'EX374',
    title: 'Red Hat Certified Specialist — Developing Automation with Ansible Automation Platform',
    level: 'Specialist',
    duration: '~3 months',
    skills: ['Collections', 'Execution Environments', 'CI/CD'],
    url: 'https://www.redhat.com/en/services/training/ex374-red-hat-certified-specialist-developing-automation-ansible-automation-platform-exam',
  },
  {
    code: 'EX467',
    title: 'Red Hat Certified Specialist — Managing Automation with Ansible Automation Platform',
    level: 'Specialist',
    duration: '~3 months',
    skills: ['Controller', 'Automation Hub', 'RBAC'],
    url: 'https://www.redhat.com/en/services/certification',
  },
];

export default function AnsibleEducationPage() {
  return (
    <>
      <Helmet>
        <title>Ansible Learning Center | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="Ansible certification tracks — RHCE and Red Hat Certified Specialist paths for the Ansible Automation Platform."
        />
      </Helmet>
      <main className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-8">
        <header>
          <h1 className="display-heading text-3xl sm:text-4xl text-slate-900 dark:text-white mb-3">
            Ansible Learning Center
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            Certification tracks for automation engineering with Ansible and the Red Hat Ansible
            Automation Platform.
          </p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TRACKS.map(({ code, title, level, duration, skills, url }) => (
            <a
              key={code}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="glass glass-hover rounded-xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="size-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                  <span
                    className="material-symbols-outlined text-primary text-base"
                    aria-hidden="true"
                  >
                    workspace_premium
                  </span>
                </div>
                <div>
                  <div className="text-[10px] font-black text-primary tracking-widest uppercase">
                    {code}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {level} · {duration}
                  </span>
                </div>
              </div>
              <h2 className="text-sm font-bold text-foreground leading-snug">{title}</h2>
              <div className="flex gap-1 flex-wrap mt-auto">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
