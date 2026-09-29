import React from 'react';
import { useNavigate } from 'react-router';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import { useCoderCornerData } from '@/hooks/useCoderCornerData';
import { routes } from '@/lib/routeFactory';

/**
 * A provider's `/<provider>/code` page: the published code patterns filed
 * under that provider, filterable by category, each opening
 * `/<provider>/code/<slug>` (the article template, through
 * `ProviderCodeDispatcher` in App.jsx).
 *
 * GitHub, Terraform, Ansible and Docker each carried a copy of this body,
 * differing only in the provider and two strings, until Docker's made it four
 * (#776). Each page now passes those three things.
 *
 * @param {object} props
 * @param {string} props.provider - Provider key, as the API and the routes spell it.
 * @param {string} props.title - The page heading, and the start of its document title.
 * @param {string} props.description - One sentence under the heading.
 */
export default function ProviderCodePage({ provider, title, description }) {
  const navigate = useNavigate();
  const { items, loading } = useCoderCornerData(provider);

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  return (
    <ContentListingTemplate
      title={title}
      description={description}
      items={items}
      itemType="guide"
      loading={loading}
      categories={categories}
      icon="code"
      actionLabel="Open Pattern"
      onItemClick={(item) => {
        if (!item.slug) return;
        navigate(`${routes.code(provider)}/${item.slug}`);
      }}
    />
  );
}
