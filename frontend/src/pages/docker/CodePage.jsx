import React from 'react';
import { useNavigate } from 'react-router';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { useCoderCornerData } from '@/hooks/useCoderCornerData';
import { routes } from '@/lib/routeFactory';

// The shared code listing, like Terraform's and Ansible's (#776): published
// code patterns filed under Docker, each opening /docker/code/<slug>.
export default function DockerCodePage() {
  const navigate = useNavigate();
  const { items, loading } = useCoderCornerData('docker');

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  return (
    <ContentListingTemplate
      title="Docker Code Patterns"
      description="Dockerfiles, compose files and build scripts you can copy, each explained, and reviewed before they are published."
      items={items}
      itemType="guide"
      loading={loading}
      categories={categories}
      icon="code"
      actionLabel="Open Pattern"
      onItemClick={(item) => {
        if (!item.slug) return;
        navigate(`${routes.code('docker')}/${item.slug}`);
      }}
    />
  );
}
