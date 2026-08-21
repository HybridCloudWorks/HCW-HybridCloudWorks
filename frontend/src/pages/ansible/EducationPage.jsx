import React from 'react';
import { Helmet } from 'react-helmet-async';
import EducationTracks from '@/components/shared/EducationTracks';
import {
  certifications,
  filterLevels,
  learningPaths,
  levelMeta,
  resources,
} from '@/data/ansible/education';

export default function AnsibleEducationPage() {
  return (
    <>
      <Helmet>
        <title>Ansible Education & Certifications | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="Ansible certification tracks, learning paths, and automation resources — covering RHCSA, RHCE, and Specialist certifications."
        />
      </Helmet>
      <main className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-10">
        <header>
          <h1 className="display-heading text-3xl sm:text-4xl text-slate-900 dark:text-white mb-3">
            Ansible Education & Certifications
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            Validate your infrastructure automation and configuration management skills with Red Hat
            Ansible certification tracks. New to Red Hat? Start with RHCSA to build core Linux
            foundations before automating them with RHCE.
          </p>
        </header>
        <EducationTracks
          certifications={certifications}
          learningPaths={learningPaths}
          resources={resources}
          levelMeta={levelMeta}
          filterLevels={filterLevels}
        />
      </main>
    </>
  );
}
