import React from 'react';
import { useNavigate } from 'react-router';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { useCoderCornerData } from '@/hooks/useCoderCornerData';

export default function AnsibleCodePage() {
  const navigate = useNavigate();
  const { items, loading } = useCoderCornerData('ansible');

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  return (
    <ContentListingTemplate
      title="Ansible Code Patterns"
      description="Production-ready playbooks, roles, and automation snippets managed through ContentForge."
      items={items}
      itemType="guide"
      loading={loading}
      categories={categories}
      icon="code"
      actionLabel="Open Pattern"
      onItemClick={(item) => {
        if (!item.slug) return;
        navigate(`/ansible/code/${item.slug}`);
      }}
    />
  );
}
