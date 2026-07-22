import React from 'react';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';
import ComingSoonPage from '@/pages/ComingSoonPage'; // TODO: remove to re-enable

export default function TerraformToolsPage() {
  return <ComingSoonPage />; // TODO: remove to re-enable
  const tools = [
    {
      title: 'Terraform CLI',
      description: 'Official Terraform command-line tool with init, plan, apply, and destroy operations.',
      category: 'Core',
      complexity: 'Beginner',
      tags: ['CLI', 'Core', 'Official'],
      date: 'Updated Feb 2026',
    },
    {
      title: 'Terragrunt',
      description: 'Wrapper for Terraform providing DRY configs, remote state management, and dependency handling.',
      category: 'Orchestration',
      complexity: 'Intermediate',
      tags: ['Orchestration', 'DRY', 'State'],
      date: 'Updated Feb 2026',
    },
    {
      title: 'Infracost',
      description: 'Cost estimation tool showing infrastructure costs before deployment and in pull requests.',
      category: 'Cost Management',
      complexity: 'Beginner',
      tags: ['Cost', 'Estimation', 'CI/CD'],
      date: 'Updated Jan 2026',
    },
    {
      title: 'TFLint',
      description: 'Linter for Terraform code quality, security best practices, and AWS/Azure/GCP compliance checks.',
      category: 'Quality',
      complexity: 'Beginner',
      tags: ['Linting', 'Quality', 'Security'],
      date: 'Updated Jan 2026',
    },
    {
      title: 'Sentinel',
      description: 'Policy as Code framework for enforcing governance and compliance on Terraform runs.',
      category: 'Governance',
      complexity: 'Advanced',
      tags: ['Policy', 'Governance', 'Compliance'],
      date: 'Updated Jan 2026',
    },
    {
      title: 'Atlantis',
      description: 'Terraform automation and collaboration platform for pull request-based infrastructure updates.',
      category: 'Automation',
      complexity: 'Advanced',
      tags: ['Automation', 'CI/CD', 'Collaboration'],
      date: 'Updated Dec 2025',
    },
  ];

  const categories = ['Core', 'Orchestration', 'Cost Management', 'Quality', 'Governance', 'Automation'];

  return (
    <ContentListingTemplate
      title="Terraform Tools & Utilities"
      description="Essential and advanced tools for Terraform development, testing, cost management, and automation."
      items={tools}
      itemType="guide"
      categories={categories}
      icon="build"
    />
  );
}
