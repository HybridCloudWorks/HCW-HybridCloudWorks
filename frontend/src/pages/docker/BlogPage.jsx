import React from 'react';
import { routes, staticRoutes } from '@/lib/routeFactory';
import DockerPlaceholderPage from './DockerPlaceholderPage';

// Static, not ProviderBlogPage: there are no Docker articles yet, and a list
// page with nothing in it reads as a fault rather than as "coming soon".
export default function DockerBlogPage() {
  return (
    <DockerPlaceholderPage
      eyebrow="Docker · Blog"
      title="Docker Blog"
      description="Articles on building, running and securing containers are on the way, starting with how the image behind this site’s browser labs is built."
      plans={[
        'Writing Dockerfiles that stay small, quick to rebuild and easy to review',
        'Multi-stage builds, and why the lab image uses one',
        'Provenance attestations: a signed record of how an image was built',
      ]}
      links={[
        { label: 'Back to the Docker hub', to: routes.landing('docker') },
        { label: 'See the browser labs', to: staticRoutes.labs },
      ]}
    />
  );
}
