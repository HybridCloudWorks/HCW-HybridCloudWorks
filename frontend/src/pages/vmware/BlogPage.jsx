import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

export default function VMwareBlogPage() {
  return (
    <ProviderBlogPage
      provider="vmware"
      title="VMware Engineering Blog"
      subtitle="Private cloud architecture, VMware Cloud Foundation, NSX networking, and hybrid-cloud migration insights."
      metaTitle="VMware Engineering Blog | HCW"
      metaDesc="VMware architecture guides, VCF deep dives, vSphere and NSX best practices, and hybrid cloud insights."
      gradientFrom="from-sky-500"
      gradientTo="to-sky-400"
      accentColor="bg-sky-400"
      accentBorder="border-sky-400/60 text-sky-200"
      accentHover="group-hover:text-sky-300"
      glowColor="bg-sky-500/5"
    />
  );
}
