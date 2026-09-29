import React from 'react';
import ProviderCodePage from '@/components/shared/ProviderCodePage';

export default function AnsibleCodePage() {
  return (
    <ProviderCodePage
      provider="ansible"
      title="Ansible Code Patterns"
      description="Production-ready playbooks, roles, and automation snippets, reviewed before they are published."
    />
  );
}
