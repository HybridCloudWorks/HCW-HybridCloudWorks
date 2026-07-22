import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

export default function AnsibleBlogPage() {
  return (
    <ProviderBlogPage
      provider="ansible"
      title="Ansible Automation Blog"
      subtitle="Playbook design, automation patterns, event-driven Ansible, and platform engineering with the Ansible Automation Platform."
      metaTitle="Ansible Automation Blog | HCW"
      metaDesc="Ansible best practices, playbook design patterns, automation controller guides, and platform engineering insights."
      gradientFrom="from-red-500"
      gradientTo="to-red-400"
      accentColor="bg-red-400"
      accentBorder="border-red-400/60 text-red-200"
      accentHover="group-hover:text-red-300"
      glowColor="bg-red-500/5"
    />
  );
}
