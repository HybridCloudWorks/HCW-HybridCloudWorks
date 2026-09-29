import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router';
import EducationTracks from '@/components/shared/EducationTracks';
import {
  CREDENTIALS_NOTE,
  DATA_AS_OF,
  DATA_SOURCE,
  certifications,
  filterLevels,
  learningPaths,
  levelMeta,
  resources,
} from '@/data/docker/education';
import { staticRoutes } from '@/lib/routeFactory';

/**
 * `/docker/education` (#778): Docker's own learning paths and the two
 * credentials that carry Docker's name, from the checked, dated catalogue in
 * src/data/docker/education.js, on the same EducationTracks body as Ansible's
 * and VMware's pages. Docker runs no exam of its own, and the page says so
 * before any card, in the catalogue's own words (`CREDENTIALS_NOTE`), so the
 * two certification cards cannot be read as Docker's.
 */
export default function DockerEducationPage() {
  return (
    <>
      <Helmet>
        <title>Docker Learning | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="Docker's own learning paths, from a first container to multi-stage builds, Compose and supply-chain security, and the two credentials that carry Docker's name, with who issues each."
        />
      </Helmet>
      <main className="relative z-10 max-w-[1200px] mx-auto w-full px-4 md:px-8 py-12 flex flex-col gap-10">
        <header>
          <h1 className="display-heading text-3xl sm:text-4xl text-slate-900 dark:text-white mb-3">
            Docker Learning
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            Docker teaches through short, self-guided modules in its documentation: a first
            container, building images, Compose, supply-chain security and more. Every browser lab
            on this site runs in a Docker container too, so you can{' '}
            <Link to={staticRoutes.labs} className="underline underline-offset-4">
              try things out in one
            </Link>{' '}
            while you read.
          </p>
          <p
            data-testid="docker-credentials-note"
            className="mt-4 max-w-2xl rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-slate-800 dark:text-slate-200"
          >
            {CREDENTIALS_NOTE}
          </p>
        </header>
        <EducationTracks
          certifications={certifications}
          learningPaths={learningPaths}
          resources={resources}
          levelMeta={levelMeta}
          filterLevels={filterLevels}
          dataAsOf={DATA_AS_OF}
          dataSource={DATA_SOURCE}
        />
      </main>
    </>
  );
}
