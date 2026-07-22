import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { useCoderCornerData } from '@/hooks/useCoderCornerData';
import { useProviderConfig } from '@/context/ProviderContext';

/**
 * ProviderCoderCornerPage — public Coder Corner listing for any provider.
 *
 * Pattern-matches ProviderBlogPage usage: a thin shared page parameterized
 * by `provider`, backed by useCoderCornerData (`content` collection with
 * type === 'coder_corner', legacy `blogs` fallback). Items navigate to
 * /:provider/coder-corner/:slug which renders BlogDetailTemplate with
 * section="coder-corner".
 *
 * @param {object} props
 * @param {string} props.provider - Provider key ('aws' | 'azure' | ... | 'ansible').
 */
export default function ProviderCoderCornerPage({ provider }) {
  const navigate = useNavigate();
  const config = useProviderConfig();
  const { items, loading } = useCoderCornerData(provider);

  const providerName = config?.name || String(provider || '').toUpperCase();
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  return (
    <ContentListingTemplate
      title={`${providerName} Coder Corner`}
      description={`Community scripts, code reviews, and implementation patterns for ${providerName} — curated through the ContentForge pipeline.`}
      items={items}
      itemType="guide"
      loading={loading}
      categories={categories}
      icon="code"
      actionLabel="Open Pattern"
      onItemClick={(item) => {
        if (!item.slug) return;
        navigate(`/${provider}/coder-corner/${item.slug}`);
      }}
    />
  );
}
