import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicContentList } from '@/lib/publicApi';

function isVMware(doc = {}) {
  const provider = String(doc.cloudProvider || doc['Cloud Provider'] || '').toLowerCase();
  return provider === 'vmware';
}

export default function VMwareArchitecturePage() {
  const navigate = useNavigate();
  // Published-only is enforced server-side by the public API.
  const { data: docs, loading } = usePublicData(
    () => fetchPublicContentList({ type: 'architecture', limit: 250 }),
    'architecture:content'
  );

  const items = (docs || []).filter(isVMware).map((doc) => ({
    id: doc.id,
    title: doc.title || doc.Title || 'Untitled Blueprint',
    description: doc.summary || doc.Summary || doc.description || '',
    category: doc.category || doc.Category || 'Architecture',
    complexity: doc.complexity || doc.level,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    slug: doc.slug || doc.Slug || null,
  }));

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  return (
    <ContentListingTemplate
      title="VMware Reference Architectures"
      description="Production-ready VMware Cloud Foundation, vSphere, and NSX blueprints managed through ContentForge."
      items={items}
      itemType="architecture"
      loading={loading}
      categories={categories}
      icon="schema"
      actionLabel="View Blueprint"
      onItemClick={(item) => {
        if (!item.slug) return;
        navigate(`/vmware/architecture-designs/${item.slug}`);
      }}
    />
  );
}
