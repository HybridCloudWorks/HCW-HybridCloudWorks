import React from 'react';
import { useNavigate } from 'react-router';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { useCoderCornerData } from '@/hooks/useCoderCornerData';
import { routes } from '@/lib/routeFactory';
import ComingSoonPage from '@/pages/ComingSoonPage'; // TODO: remove to re-enable

export default function GitHubCodePage() {
  return <ComingSoonPage />; // TODO: remove to re-enable
  const navigate = useNavigate();
  const { items, loading } = useCoderCornerData('github');

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  return (
    <ContentListingTemplate
      title="GitHub Coder Corner"
      description="Curated GitHub automation patterns and workflow snippets managed through ContentForge."
      items={items}
      itemType="guide"
      loading={loading}
      categories={categories}
      icon="code"
      actionLabel="Open Pattern"
      onItemClick={(item) => {
        if (!item.slug) return;
        navigate(`${routes.code('github')}/${item.slug}`);
      }}
    />
  );
}
