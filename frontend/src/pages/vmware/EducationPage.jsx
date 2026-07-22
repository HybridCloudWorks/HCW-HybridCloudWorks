import React from 'react';
import { Helmet } from 'react-helmet-async';

const TRACKS = [
  {
    code: 'VCP-VCF',
    title: 'VCP — VMware Cloud Foundation Administrator',
    level: 'Professional',
    duration: '~3 months',
    skills: ['vSphere', 'vSAN', 'NSX', 'SDDC Manager'],
    url: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    code: 'VCP-VCF-ARCH',
    title: 'VCP — VMware Cloud Foundation Architect',
    level: 'Professional',
    duration: '~4 months',
    skills: ['Design', 'Capacity Planning', 'Availability'],
    url: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    code: 'VCAP-DCV',
    title: 'VCAP — Data Center Virtualization',
    level: 'Advanced',
    duration: '~6 months',
    skills: ['Deploy', 'Operate', 'Troubleshoot'],
    url: 'https://www.broadcom.com/support/education/vmware/certification',
  },
];

export default function VMwareEducationPage() {
  return (
    <>
      <Helmet>
        <title>VMware Learning Center | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="VMware certification tracks — VCP and VCAP paths for VMware Cloud Foundation and data center virtualization."
        />
      </Helmet>
      <main className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-8">
        <header>
          <h1 className="display-heading text-3xl sm:text-4xl text-slate-900 dark:text-white mb-3">
            VMware Learning Center
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            Certification tracks for VMware Cloud Foundation and data center virtualization,
            maintained by Broadcom.
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
