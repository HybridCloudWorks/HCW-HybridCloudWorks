import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

export default function AzureBlogPage() {
  return (
    <ProviderBlogPage
      provider="azure"
      title="Azure Cloud Insights"
      subtitle="Expert analysis, architectural patterns, and best practices for building secure, scalable, and cost-effective solutions on Microsoft Azure."
      metaTitle="Azure Cloud Insights | HCW"
      metaDesc="Expert analysis, architectural patterns, and best practices for building on Microsoft Azure. Case studies, frameworks, and cloud governance insights."
      gradientFrom="from-azure-primary"
      gradientTo="to-azure-primary"
      accentColor="bg-blue-400"
      accentBorder="border-blue-400/60 text-blue-200"
      accentHover="group-hover:text-blue-300"
      glowColor="bg-blue-500/5"
    />
  );
}
