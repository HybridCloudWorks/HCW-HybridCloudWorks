import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

export default function FinOpsBlogPage() {
  return (
    <ProviderBlogPage
      provider="finops"
      title="FinOps Insights Blog"
      subtitle="Cloud cost optimization, FinOps frameworks, tagging strategies, and financial governance practices for multi-cloud environments."
      metaTitle="FinOps Insights Blog | HCW"
      metaDesc="Cloud financial management, cost optimization frameworks, FinOps best practices, and multi-cloud cost governance insights."
      gradientFrom="from-finops-primary"
      gradientTo="to-finops-primary"
      accentColor="bg-emerald-400"
      accentBorder="border-emerald-400/60 text-emerald-200"
      accentHover="group-hover:text-emerald-300"
      glowColor="bg-emerald-500/5"
    />
  );
}
