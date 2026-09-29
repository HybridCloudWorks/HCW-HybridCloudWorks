import React from 'react';
import ProviderCodePage from '@/components/shared/ProviderCodePage';

export default function TerraformCodePage() {
  return (
    <ProviderCodePage
      provider="terraform"
      title="Terraform Code Patterns"
      description="Production-ready Terraform snippets and implementation notes, reviewed before they are published."
    />
  );
}
