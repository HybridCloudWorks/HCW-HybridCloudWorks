import React from 'react';
import { routes } from '@/lib/routeFactory';
import DockerPlaceholderPage from './DockerPlaceholderPage';

// Static until Docker has a news source to read from. The shared NewsPage has
// a Docker row (NEWS_META), so switching this to <NewsPage provider="docker" />
// is the whole change once one exists.
export default function DockerRssPage() {
  return (
    <DockerPlaceholderPage
      eyebrow="Docker · News"
      title="Docker News"
      description="Docker release notes and announcements will be gathered here. Until then, Docker publishes its own news on its blog."
      plans={[
        'Docker Desktop and Docker Engine releases',
        'Changes to images, builds and security features',
        'Docker Sandboxes and other new tools',
      ]}
      links={[
        { label: 'Docker’s own blog', href: 'https://www.docker.com/blog/', external: true },
        { label: 'Back to the Docker hub', to: routes.landing('docker') },
      ]}
    />
  );
}
