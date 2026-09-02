import React from 'react';
import ProviderBlogPage from '@/components/shared/ProviderBlogPage';

export default function GitHubBlogPage() {
  return (
    <ProviderBlogPage
      provider="github"
      title="GitHub Engineering Blog"
      subtitle="Practical guides on GitHub Actions, CI/CD workflows, developer tooling, and platform engineering best practices."
      metaTitle="GitHub Engineering Blog | HCW"
      metaDesc="GitHub Actions workflows, CI/CD best practices, developer tooling, and platform engineering insights from the HCW team."
      gradientFrom="from-slate-700 dark:from-slate-300"
      gradientTo="to-slate-700 dark:to-slate-100"
      accentColor="bg-slate-300"
      accentBorder="border-slate-300/60 text-slate-200"
      accentHover="group-hover:text-slate-200"
      glowColor="bg-slate-500/5"
    />
  );
}
