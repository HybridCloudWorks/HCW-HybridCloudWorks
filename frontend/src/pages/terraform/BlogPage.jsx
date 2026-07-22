import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';
import ComingSoonPage from '@/pages/ComingSoonPage'; // TODO: remove to re-enable

export default function TerraformBlogPage() {
  return <ComingSoonPage />; // TODO: remove to re-enable
  return (
    <ProviderBlogPage
      provider="terraform"
      title="Terraform Engineering Blog"
      subtitle="Infrastructure as code patterns, module design, state management, and GitOps workflows for scalable Terraform deployments."
      metaTitle="Terraform Engineering Blog | HCW"
      metaDesc="Terraform best practices, module design patterns, state management, and IaC workflows for enterprise deployments."
      gradientFrom="from-terraform-primary"
      gradientTo="to-terraform-primary"
      accentColor="bg-violet-400"
      accentBorder="border-violet-400/60 text-violet-200"
      accentHover="group-hover:text-violet-300"
      glowColor="bg-violet-500/5"
    />
  );
}
