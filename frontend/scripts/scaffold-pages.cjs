const fs = require('fs');
const path = require('path');

const pages = [
  // AWS
  { file: 'src/pages/aws/LandingPage.jsx', title: 'AWS Landing Page' },
  {
    file: 'src/pages/aws/ArchitectureDesignsPage.jsx',
    title: 'AWS Architecture Designs',
  },
  { file: 'src/pages/aws/FrameworksPage.jsx', title: 'AWS Frameworks' },
  { file: 'src/pages/aws/BlogPage.jsx', title: 'AWS Blog' },
  { file: 'src/pages/aws/EducationPage.jsx', title: 'AWS Education' },
  {
    file: 'src/pages/aws/AudioArchitecturePage.jsx',
    title: 'AWS Audio Architecture',
  },

  // Azure
  { file: 'src/pages/azure/LandingPage.jsx', title: 'Azure Landing Page' },
  {
    file: 'src/pages/azure/ArchitectureDesignsPage.jsx',
    title: 'Azure Architecture Designs',
  },
  { file: 'src/pages/azure/FrameworksPage.jsx', title: 'Azure Frameworks' },
  {
    file: 'src/pages/azure/FrameworksPillarsPage.jsx',
    title: 'Azure Frameworks Pillars',
  },
  { file: 'src/pages/azure/BlogPage.jsx', title: 'Azure Blog' },
  { file: 'src/pages/azure/EducationPage.jsx', title: 'Azure Education' },
  {
    file: 'src/pages/azure/AudioArchitecturePage.jsx',
    title: 'Azure Audio Architecture',
  },

  // GCP
  { file: 'src/pages/gcp/LandingPage.jsx', title: 'GCP Landing Page' },
  {
    file: 'src/pages/gcp/ArchitectureDesignsPage.jsx',
    title: 'GCP Architecture Designs',
  },
  { file: 'src/pages/gcp/FrameworksPage.jsx', title: 'GCP Frameworks' },
  { file: 'src/pages/gcp/BlogPage.jsx', title: 'GCP Blog' },
  { file: 'src/pages/gcp/EducationPage.jsx', title: 'GCP Education' },
  {
    file: 'src/pages/gcp/AudioArchitecturePage.jsx',
    title: 'GCP Audio Architecture',
  },

  // FinOps
  { file: 'src/pages/finops/LandingPage.jsx', title: 'FinOps Landing Page' },
  { file: 'src/pages/finops/ToolsPage.jsx', title: 'FinOps Tools' },
  { file: 'src/pages/finops/FocusPage.jsx', title: 'FinOps FOCUS Standards' },
  {
    file: 'src/pages/finops/ArchitectureDesignsPage.jsx',
    title: 'FinOps Architectures',
  },
  { file: 'src/pages/finops/BlogPage.jsx', title: 'FinOps Blog' },
  { file: 'src/pages/finops/RssPage.jsx', title: 'FinOps RSS Feed' },

  // Terraform
  {
    file: 'src/pages/terraform/LandingPage.jsx',
    title: 'Terraform Landing Page',
  },
  { file: 'src/pages/terraform/CodePage.jsx', title: 'Terraform Code Catalog' },
  {
    file: 'src/pages/terraform/ModulesPage.jsx',
    title: 'Terraform Modules Gallery',
  },
  { file: 'src/pages/terraform/ToolsPage.jsx', title: 'Terraform Tools Suite' },
  { file: 'src/pages/terraform/BlogPage.jsx', title: 'Terraform Blog' },
  { file: 'src/pages/terraform/RssPage.jsx', title: 'Terraform RSS Feed' },

  // GitHub
  { file: 'src/pages/github/LandingPage.jsx', title: 'GitHub Landing Page' },
  {
    file: 'src/pages/github/WorkflowsPage.jsx',
    title: 'GitHub Workflows Catalog',
  },
  { file: 'src/pages/github/CodePage.jsx', title: 'GitHub Code Catalog' },
  { file: 'src/pages/github/ToolsPage.jsx', title: 'GitHub Tools Suite' },
  { file: 'src/pages/github/BlogPage.jsx', title: 'GitHub Blog' },
  { file: 'src/pages/github/RssPage.jsx', title: 'GitHub RSS Feed' },

  // Cloud Tools
  { file: 'src/pages/tools/MigrationPage.jsx', title: 'Cloud Migration Tool' },
  {
    file: 'src/pages/tools/ComparisonPage.jsx',
    title: 'Cross-Cloud Comparison',
  },
  { file: 'src/pages/tools/ResourcesPage.jsx', title: 'Cloud Resources Hub' },
  {
    file: 'src/pages/tools/DecisionsPage.jsx',
    title: 'Architectural Decision Logic',
  },

  // Templates
  {
    file: 'src/pages/templates/FrameworkTemplatePage.jsx',
    title: 'Framework Deep-Dive Template',
  },
  {
    file: 'src/pages/templates/ArchitectureTemplatePage.jsx',
    title: 'Architecture Deep-Dive Template',
  },
  {
    file: 'src/pages/templates/RosettaStoneTemplatePage.jsx',
    title: 'Rosetta Stone Template',
  },

  // Shared
  { file: 'src/pages/shared/HomePage.jsx', title: 'Home Page' },
  { file: 'src/pages/shared/AboutPage.jsx', title: 'About Page' },
  { file: 'src/pages/shared/ContactPage.jsx', title: 'Contact Page' },
  // { file: 'src/pages/shared/LegacyV1Page.jsx', title: 'Legacy V1 Reference' }, // Not needed as it's legacy
];

const template = (title) => `import React from 'react';

export default function Page() {
  return (
    <div className="container mx-auto py-12 px-4">
      <h1 className="text-4xl font-bold mb-6">${title}</h1>
      <div className="p-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700">
        <p className="text-xl text-muted-foreground text-center">
          Component Placeholder for <strong>${title}</strong><br />
          <span className="text-sm opacity-70">Implementation pending...</span>
        </p>
      </div>
    </div>
  );
}
`;

pages.forEach((page) => {
  const fullPath = path.resolve(process.cwd(), page.file);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }

  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, template(page.title));
    console.log(`Created file: ${page.file}`);
  } else {
    console.log(`Skipped existing file: ${page.file}`);
  }
});

console.log('Scaffolding complete.');
