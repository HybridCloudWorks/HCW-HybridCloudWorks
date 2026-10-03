import React from 'react';
import { routes } from '@/lib/routeFactory';
import DockerPlaceholderPage from './DockerPlaceholderPage';

export default function DockerToolsPage() {
  return (
    <DockerPlaceholderPage
      eyebrow="Docker · Tools"
      title="Docker Tools"
      description="A guide to the tools around Docker, what each one is for and when to reach for it, is on the way."
      plans={[
        'Docker Desktop and the docker command line',
        'Docker Compose for setups with more than one container',
        'Docker Sandboxes, for running a coding agent in isolation',
      ]}
      links={[
        { label: 'The Docker Desktop app', to: routes.desktop('docker') },
        { label: 'Building images', to: routes.buildingImages('docker') },
        { label: 'Run an agent in a sandbox', to: routes.sandboxes('docker') },
        { label: 'Back to the Docker hub', to: routes.landing('docker') },
      ]}
    />
  );
}
