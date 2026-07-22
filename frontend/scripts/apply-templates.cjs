const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.resolve(__dirname, '../src/pages');

// Map filenames to template configurations
const TEMPLATE_MAP = {
  'LandingPage.jsx': 'LandingPageTemplate',
  'ArchitectureDesignsPage.jsx': 'ContentHubTemplate',
  'FrameworksPage.jsx': 'ContentHubTemplate',
  'BlogPage.jsx': 'ContentHubTemplate',
  'EducationPage.jsx': 'ContentHubTemplate',
  'AudioArchitecturePage.jsx': 'ContentHubTemplate',
  'ToolsPage.jsx': 'ContentHubTemplate',
  'ModulesPage.jsx': 'ContentHubTemplate',
  'CodePage.jsx': 'ContentHubTemplate',
  'WorkflowsPage.jsx': 'ContentHubTemplate',
  'RssPage.jsx': 'ContentHubTemplate',
  'FocusPage.jsx': 'ContentHubTemplate',
  // Templates
  'FrameworkTemplatePage.jsx': 'ContentHubTemplate', // Fallback
  'ArchitectureTemplatePage.jsx': 'ContentHubTemplate', // Fallback
  'RosettaStoneTemplatePage.jsx': 'ContentHubTemplate', // Fallback
  // Tools
  'MigrationPage.jsx': 'ContentHubTemplate',
  'ComparisonPage.jsx': 'ContentHubTemplate',
  'ResourcesPage.jsx': 'ContentHubTemplate',
  'DecisionsPage.jsx': 'ContentHubTemplate',
  // Shared
  'HomePage.jsx': 'LandingPageTemplate', // Special case, might need custom
  'AboutPage.jsx': 'ContentHubTemplate', // Simple text page usually
  'ContactPage.jsx': 'ContentHubTemplate',
};

function getTemplateForFile(filename) {
  if (TEMPLATE_MAP[filename]) return TEMPLATE_MAP[filename];
  return 'ContentHubTemplate'; // Default
}

function generateContent(filepath, filename) {
  const templateName = getTemplateForFile(filename);
  const dirName = path.basename(path.dirname(filepath));
  // Provider name (capitalized) e.g. "aws" -> "AWS"
  const providerName = dirName === 'shared' ? 'HCW' : dirName.toUpperCase();

  // Human readable title from filename
  // e.g. "ArchitectureDesignsPage.jsx" -> "Architecture Designs"
  const pageTitle = filename
    .replace('Page.jsx', '')
    .split(/(?=[A-Z])/)
    .join(' ');
  const fullTitle = `${providerName} ${pageTitle}`;

  if (templateName === 'LandingPageTemplate') {
    return `import React from 'react';
import { LandingPageTemplate } from '@/components/templates/LandingPageTemplate';
import { Cloud, Server, Code, BookOpen } from 'lucide-react';

export default function ${filename.replace('.jsx', '')}() {
  const features = [
    {
      icon: Cloud,
      title: 'Cloud Architecture',
      description: 'Explore best practices and design patterns.',
      link: '${dirName === 'shared' ? '/aws' : `/${dirName}/architecture-designs`}',
    },
    {
      icon: Code,
      title: 'Infrastructure as Code',
      description: 'Templates and modules for quick deployment.',
      link: '${dirName === 'shared' ? '/terraform' : `/${dirName}/frameworks`}',
    },
    {
      icon: BookOpen,
      title: 'Learning Hub',
      description: 'Tutorials, guides, and educational resources.',
      link: '${dirName === 'shared' ? '/gcp' : `/${dirName}/education`}',
    },
  ];

  return (
    <LandingPageTemplate
      providerName="${providerName}"
      heroTitle="${fullTitle}"
      heroDescription="Your central hub for ${providerName} cloud excellence. Discover architectures, frameworks, and tools to accelerate your journey."
      heroSubtitle="${providerName} Cloud Works"
      features={features}
      primaryCTA={{ label: 'Get Started', href: '/about' }}
      secondaryCTA={{ label: 'Browse Content', href: '/blog' }}
    />
  );
}
`;
  } else {
    // ContentHubTemplate
    return `import React from 'react';
import { ContentHubTemplate } from '@/components/templates/ContentHubTemplate';
import { useFirestoreCollection } from '@/hooks/useFirestore';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function ${filename.replace('.jsx', '')}() {
  // Example hook usage - strictly for foundation
  // In real app, path would be specific e.g., 'providers/${dirName}/posts'
  const { data, loading, error } = useFirestoreCollection('content_placeholder'); 

  return (
    <ContentHubTemplate
      title="${fullTitle}"
      description="Access a curated collection of ${fullTitle.toLowerCase()} resources, guides, and updates."
    >
      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
           <Card>
             <CardHeader><CardTitle>Example Content 1</CardTitle></CardHeader>
             <CardContent>Content placeholder for ${fullTitle}.</CardContent>
           </Card>
           <Card>
             <CardHeader><CardTitle>Example Content 2</CardTitle></CardHeader>
             <CardContent>More content coming soon.</CardContent>
           </Card>
        </div>
      )}
    </ContentHubTemplate>
  );
}
`;
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (file.endsWith('.jsx')) {
      if (file === 'App.jsx') continue; // Skip App.jsx
      console.log(`Processing ${file}...`);
      const content = generateContent(fullPath, file);
      fs.writeFileSync(fullPath, content);
    }
  }
}

console.log('Applying templates to all pages...');
walkDir(PAGES_DIR);
console.log('Done.');
