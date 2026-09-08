import React from 'react';
import { useNavigate } from 'react-router';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicContentList } from '@/lib/publicApi';
import { staticBlueprints } from './architecture-blueprints';

function isVMware(doc = {}) {
  const provider = String(doc.cloudProvider || doc['Cloud Provider'] || '').toLowerCase();
  return provider === 'vmware';
}

/**
 * A hardcoded blueprint in the listing's item shape.
 *
 * The sibling module is empty today, which is why this page is the one
 * `/vmware/architecture-designs` leaves the sitemap for (issue #373). It is
 * consumed here anyway, and that is the point: the pre-render decides whether to
 * advertise the URL by counting that same array, so a page that ignored it would
 * bring the URL back the moment someone added a blueprint and still render
 * nothing — the original bug, inverted. One array, read by both.
 *
 * The fields are the shape the four sibling modules use; `level` is this
 * listing's `complexity`.
 */
function blueprintItem(blueprint) {
  return {
    id: blueprint.slug || blueprint.title,
    title: blueprint.title,
    description: blueprint.description || '',
    category: blueprint.category || 'Architecture',
    complexity: blueprint.level,
    tags: Array.isArray(blueprint.tags) ? blueprint.tags : [],
    slug: blueprint.slug || null,
  };
}

export default function VMwareArchitecturePage() {
  const navigate = useNavigate();
  // Published-only is enforced server-side by the public API.
  const { data: docs, loading } = usePublicData(
    () => fetchPublicContentList({ type: 'architecture', limit: 250 }),
    'architecture:content'
  );

  const items = [
    ...(docs || []).filter(isVMware).map((doc) => ({
      id: doc.id,
      title: doc.title || doc.Title || 'Untitled Blueprint',
      description: doc.summary || doc.Summary || doc.description || '',
      category: doc.category || doc.Category || 'Architecture',
      complexity: doc.complexity || doc.level,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      slug: doc.slug || doc.Slug || null,
    })),
    // API documents first, then the hardcoded list — the order the four sibling
    // architecture pages already use.
    ...staticBlueprints.map(blueprintItem),
  ];

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
