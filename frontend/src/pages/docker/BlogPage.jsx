import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

// The shared blog listing, like every provider's (#776). It lists published
// articles filed under Docker, and each links to /docker/blog/<slug>.
export default function DockerBlogPage() {
  return (
    <ProviderBlogPage
      provider="docker"
      title="Docker Containers Blog"
      subtitle="Building container images, using the Docker Desktop app day to day, and running coding agents in sandboxes, with the image behind this site’s browser labs as the worked example."
      metaTitle="Docker Containers Blog | HCW"
      metaDesc="Dockerfiles, multi-stage builds and provenance attestations, Docker Desktop, and running a coding agent in a Docker sandbox."
      gradientFrom="from-docker-primary"
      gradientTo="to-docker-primary"
      accentColor="bg-blue-400"
      accentBorder="border-blue-400/60 text-blue-200"
      accentHover="group-hover:text-blue-300"
      glowColor="bg-blue-500/5"
    />
  );
}
