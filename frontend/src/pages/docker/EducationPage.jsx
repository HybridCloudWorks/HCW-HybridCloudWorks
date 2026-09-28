import React from 'react';
import { routes, staticRoutes } from '@/lib/routeFactory';
import DockerPlaceholderPage from './DockerPlaceholderPage';

// No certification catalogue yet: src/data/docker/education.js is empty by
// design, and this page says so rather than rendering an empty table.
export default function DockerEducationPage() {
  return (
    <DockerPlaceholderPage
      eyebrow="Docker · Learning"
      title="Docker Learning"
      description="Learning tracks for containers and Docker are on the way. Until then, every browser lab on this site already runs in a Docker container built from one image."
      plans={[
        'Containers and images from first principles',
        'Building images with Dockerfiles and multi-stage builds',
        'Docker Desktop day to day, and running a coding agent in a Docker sandbox',
      ]}
      links={[
        { label: 'See the browser labs', to: staticRoutes.labs },
        { label: 'Back to the Docker hub', to: routes.landing('docker') },
      ]}
    />
  );
}
