import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

export default function AWSBlogPage() {
  return (
    <ProviderBlogPage
      provider="aws"
      title="AWS Architecture Blog"
      subtitle="Expert insights on AWS architecture, engineering practices, and cloud-native strategies."
      metaTitle="AWS Architecture Blog | HCW"
      metaDesc="Expert insights on AWS architecture, engineering practices, and cloud-native strategies. Practical patterns, playbooks, and guidance from real-world deployments."
      gradientFrom="from-aws-primary"
      gradientTo="to-aws-primary"
      accentColor="bg-amber-400"
      accentBorder="border-amber-400/60 text-amber-200"
      accentHover="group-hover:text-amber-300"
      glowColor="bg-amber-500/5"
    />
  );
}
