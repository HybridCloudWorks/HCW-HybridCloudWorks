import React from 'react';
import ProviderCodePage from '@/components/shared/ProviderCodePage';

// The shared code listing, like Terraform's and Ansible's (#776): published
// code patterns filed under Docker, each opening /docker/code/<slug>.
export default function DockerCodePage() {
  return (
    <ProviderCodePage
      provider="docker"
      title="Docker Code Patterns"
      description="Dockerfiles, compose files and build scripts you can copy, each explained, and reviewed before they are published."
    />
  );
}
