import React from 'react';
import { Helmet } from 'react-helmet-async';
import EducationTracks from '@/components/shared/EducationTracks';
import {
  certifications,
  filterLevels,
  learningPaths,
  levelMeta,
  resources,
} from '@/data/vmware/education';

export default function VMwareEducationPage() {
  return (
    <>
      <Helmet>
        <title>VMware Education & Certifications | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="VMware certification tracks, learning paths, and resources — VCP and VCAP paths for VMware Cloud Foundation and vSphere."
        />
      </Helmet>
      <main className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-10">
        <header>
          <h1 className="display-heading text-3xl sm:text-4xl text-slate-900 dark:text-white mb-3">
            VMware Education & Certifications
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            Certification tracks and learning paths for VMware Cloud Foundation, vSphere, vSAN and
            NSX — from the foundational VCP to the advanced VCAP designs.
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
