import React from 'react';
import { useNavigate } from 'react-router';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { useCoderCornerData } from '@/hooks/useCoderCornerData';
import ComingSoonPage from '@/pages/ComingSoonPage'; // TODO: remove to re-enable

export default function TerraformCodePage() {
  return <ComingSoonPage />; // TODO: remove to re-enable
  const navigate = useNavigate();
  const { items, loading } = useCoderCornerData('terraform');

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  return (
    <ContentListingTemplate
      title="Terraform Code Patterns"
      description="Production-ready Terraform snippets and implementation notes managed through ContentForge."
      items={items}
      itemType="guide"
      loading={loading}
      categories={categories}
      icon="code"
      actionLabel="Open Pattern"
      onItemClick={(item) => {
        if (!item.slug) return;
        navigate(`/terraform/code/${item.slug}`);
      }}
    />
  );
}
