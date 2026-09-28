import React from 'react';
import { routes } from '@/lib/routeFactory';
import DockerPlaceholderPage from './DockerPlaceholderPage';

/** The lab image's source, which is public and is the worked example. */
export const LAB_IMAGE_SOURCE_URL =
  'https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/tree/main/lab-image';

export default function DockerCodePage() {
  return (
    <DockerPlaceholderPage
      eyebrow="Docker · Code"
      title="Docker Code"
      description="Dockerfiles, compose files and build scripts you can copy, each explained line by line, are on the way. The lab image’s own Dockerfile is public already."
      plans={[
        'Annotated Dockerfiles, from a single stage to a multi-stage build',
        'Compose files for running a small stack on your own machine',
        'Build scripts, and the checks an image passes before it is published',
      ]}
      links={[
        { label: 'Read the lab image’s Dockerfile', href: LAB_IMAGE_SOURCE_URL, external: true },
        { label: 'Back to the Docker hub', to: routes.landing('docker') },
      ]}
    />
  );
}
