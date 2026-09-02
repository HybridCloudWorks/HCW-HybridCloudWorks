import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

export default function GcpBlogPage() {
  return (
    <ProviderBlogPage
      provider="gcp"
      title="Google Cloud Insights"
      subtitle="Deep dives into GCP architecture, data engineering, AI/ML, and multi-cloud strategies across the Google Cloud ecosystem."
      metaTitle="Google Cloud Insights | HCW"
      metaDesc="Expert GCP architecture guides, Vertex AI deep dives, BigQuery best practices, and Google Cloud engineering insights."
      gradientFrom="from-gcp-primary"
      gradientTo="to-gcp-primary"
      accentColor="bg-green-400"
      accentBorder="border-green-400/60 text-green-200"
      accentHover="group-hover:text-green-300"
      glowColor="bg-green-500/5"
    />
  );
}
