import React from 'react';
import { staticRoutes } from '@/lib/routeFactory';
import ProviderLandingTemplate from '@/components/shared/ProviderLandingTemplate';
import { ComingSoon, LABS_AGENT_SECTION_PATH, PlaceholderLink } from './DockerPlaceholderPage';

/*
 * Docker as a service provider (owner request 2026-09-28): the Terraform
 * landing page's template, with three focus areas that are placeholders.
 * Each says what it will cover and that it is coming; nothing here reads the
 * content API, and the template's live-content panel is off, because there is
 * no Docker content for it to show.
 *
 * Facts the first area states, from lab-image/: one Dockerfile with two final
 * targets, every download checked against a pinned checksum (versions.env),
 * and the publish workflow attaching a provenance attestation.
 */

export const FOCUS_AREAS = [
  {
    id: 'building-images',
    eyebrow: 'FOCUS AREA · IMAGES',
    title: 'Building images',
    icon: 'deployed_code',
    text: 'Writing Dockerfiles that stay small and quick to rebuild, multi-stage builds that keep build tools out of the image you ship, and provenance attestations that record how an image was made. The worked example is hcw-lab, the image every browser lab on this site runs: one Dockerfile, two build targets, and every download checked against a pinned checksum.',
    tags: ['Dockerfiles', 'Multi-stage builds', 'Provenance'],
  },
  {
    id: 'docker-desktop',
    eyebrow: 'FOCUS AREA · DESKTOP',
    title: 'The Docker Desktop app',
    icon: 'desktop_windows',
    text: 'Installing Docker Desktop on Windows, macOS and Linux, then using it day to day: running and inspecting containers, managing images and volumes, the settings worth changing first, and how the app relates to the docker command line.',
    tags: ['Install', 'Containers', 'Images and volumes'],
  },
  {
    id: 'agent-sandbox',
    eyebrow: 'FOCUS AREA · SANDBOXES',
    title: 'Running an agent in a sandbox',
    icon: 'shield_person',
    text: 'Docker Sandboxes run a coding agent in an isolated microVM on your own machine, with only the folder you give it. The recipe for pointing one at a landing zone from the Landing Zone Builder is on the browser labs page today.',
    tags: ['Docker Sandboxes', 'Coding agents', 'Landing zones'],
    link: { label: 'Run an agent against your landing zone', href: LABS_AGENT_SECTION_PATH },
  },
];

function FocusArea({ area }) {
  return (
    <article className="glass rounded-xl overflow-hidden flex flex-col" data-testid={area.id}>
      <div className="h-2 w-full bg-primary/60" aria-hidden="true" />
      <div className="p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="size-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary dark:text-(--slate-blue)">
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              {area.icon}
            </span>
          </div>
          <ComingSoon />
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {area.text}
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Topics">
          {area.tags.map((tag) => (
            <li
              key={tag}
              className="text-[11px] bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200 px-2 py-0.5 rounded"
            >
              {tag}
            </li>
          ))}
        </ul>
        {area.link && (
          <div>
            <PlaceholderLink link={area.link} />
          </div>
        )}
      </div>
    </article>
  );
}

export default function DockerLandingPage() {
  return (
    <ProviderLandingTemplate
      provider="docker"
      hero={{
        eyebrow: 'IMAGES · DESKTOP · SANDBOXES',
        title: (
          <>
            Container intelligence with <span className="display-accent">Docker</span>
          </>
        ),
        description:
          'Three guides are on the way: building container images, using the Docker Desktop app day to day, and running a coding agent in a sandbox. The worked example throughout is the image behind this site’s own browser labs.',
        cta: { label: 'Explore the browser labs', to: staticRoutes.labs },
      }}
      sections={FOCUS_AREAS.map((area) => ({
        eyebrow: area.eyebrow,
        title: area.title,
        content: <FocusArea area={area} />,
      }))}
      latestContent={false}
    />
  );
}
