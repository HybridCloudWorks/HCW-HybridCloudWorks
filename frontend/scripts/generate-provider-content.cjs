const fs = require('fs');
const path = require('path');

// Provider-specific content data
const providerContent = {
  azure: {
    blog: [
      {
        title: 'Azure Landing Zones: Enterprise-Scale Architecture',
        description:
          'Comprehensive guide to implementing Azure Landing Zones with management groups, policies, and governance at scale.',
        date: 'Feb 9, 2026',
        author: 'Enterprise Architecture Team',
        category: 'Architecture',
        tags: ['Landing Zones', 'Governance', 'Enterprise'],
      },
      {
        title: 'Implementing Zero Trust Security on Azure',
        description:
          'Step-by-step approach to building a Zero Trust architecture using Azure AD, Conditional Access, and Defender for Cloud.',
        date: 'Feb 6, 2026',
        author: 'Security Team',
        category: 'Security',
        tags: ['Zero Trust', 'Azure AD', 'Security'],
      },
      {
        title: 'Azure Cost Management: FinOps Best Practices',
        description:
          'Optimize Azure spending with budgets, cost allocation tags, and Azure Advisor recommendations.',
        date: 'Feb 3, 2026',
        author: 'FinOps Team',
        category: 'Cost Optimization',
        tags: ['FinOps', 'Cost Management', 'Optimization'],
      },
      {
        title: 'Hybrid Cloud with Azure Arc',
        description:
          'Extend Azure management and services to on-premises and multi-cloud environments with Azure Arc.',
        date: 'Jan 30, 2026',
        author: 'Hybrid Cloud Team',
        category: 'Hybrid Cloud',
        tags: ['Azure Arc', 'Hybrid', 'Multi-Cloud'],
      },
      {
        title: 'AKS Production Best Practices',
        description:
          'Deploy and manage production-grade Kubernetes clusters on Azure Kubernetes Service with monitoring and security.',
        date: 'Jan 27, 2026',
        author: 'Container Team',
        category: 'Containers',
        tags: ['AKS', 'Kubernetes', 'DevOps'],
      },
      {
        title: 'Azure Well-Architected Framework Deep Dive',
        description:
          'Apply the five pillars of the Azure Well-Architected Framework to build reliable, secure, and efficient cloud solutions.',
        date: 'Jan 24, 2026',
        author: 'Cloud Architecture Team',
        category: 'Architecture',
        tags: ['WAF', 'Best Practices', 'Design'],
      },
    ],
    architecture: [
      {
        title: 'Hub-Spoke Network Topology with Azure Firewall',
        description:
          'Centralized network architecture using hub-spoke topology, Azure Firewall, and Network Security Groups for enterprise security.',
        category: 'Networking',
        complexity: 'Advanced',
        tags: ['Networking', 'Firewall', 'Hub-Spoke'],
        date: 'Updated Feb 2026',
      },
      {
        title: 'Microservices on AKS with Service Mesh',
        description:
          'Cloud-native microservices architecture using AKS, Istio service mesh, and Azure Container Registry.',
        category: 'Containers',
        complexity: 'Advanced',
        tags: ['AKS', 'Microservices', 'Istio'],
        date: 'Updated Feb 2026',
      },
      {
        title: 'Serverless Event Processing with Azure Functions',
        description:
          'Event-driven architecture using Azure Functions, Event Grid, and Cosmos DB for real-time data processing.',
        category: 'Serverless',
        complexity: 'Intermediate',
        tags: ['Functions', 'Event Grid', 'Cosmos DB'],
        date: 'Updated Jan 2026',
      },
      {
        title: 'Data Platform with Synapse Analytics',
        description:
          'Modern data warehouse architecture using Azure Synapse, Data Lake Storage, and Power BI for analytics.',
        category: 'Data & Analytics',
        complexity: 'Advanced',
        tags: ['Synapse', 'Data Lake', 'Analytics'],
        date: 'Updated Jan 2026',
      },
      {
        title: 'Multi-Region Active-Active Architecture',
        description:
          'Global application deployment with Traffic Manager, Cosmos DB multi-region writes, and Azure Front Door.',
        category: 'Resilience',
        complexity: 'Advanced',
        tags: ['Multi-Region', 'High Availability', 'Global'],
        date: 'Updated Jan 2026',
      },
      {
        title: 'Enterprise Landing Zone with CAF',
        description:
          'Cloud Adoption Framework implementation with subscription organization, RBAC, and policy governance.',
        category: 'Governance',
        complexity: 'Intermediate',
        tags: ['CAF', 'Landing Zones', 'Governance'],
        date: 'Updated Dec 2025',
      },
    ],
  },
  gcp: {
    blog: [
      {
        title: 'Building ML Pipelines with Vertex AI',
        description:
          'End-to-end machine learning workflows using Vertex AI Pipelines, AutoML, and custom training jobs.',
        date: 'Feb 8, 2026',
        author: 'ML Engineering Team',
        category: 'AI/ML',
        tags: ['Vertex AI', 'ML Pipelines', 'AutoML'],
      },
      {
        title: 'BigQuery Performance Optimization',
        description:
          'Advanced techniques for optimizing BigQuery queries, partitioning strategies, and cost management.',
        date: 'Feb 5, 2026',
        author: 'Data Engineering Team',
        category: 'Data & Analytics',
        tags: ['BigQuery', 'Performance', 'Optimization'],
      },
      {
        title: 'GKE Autopilot: Serverless Kubernetes',
        description:
          'Leverage GKE Autopilot for fully managed Kubernetes with automated node provisioning and security.',
        date: 'Feb 2, 2026',
        author: 'Container Team',
        category: 'Containers',
        tags: ['GKE', 'Autopilot', 'Kubernetes'],
      },
      {
        title: 'Cloud Run: Serverless Containers at Scale',
        description:
          'Deploy containerized applications with Cloud Run for automatic scaling and pay-per-use pricing.',
        date: 'Jan 29, 2026',
        author: 'DevOps Team',
        category: 'Serverless',
        tags: ['Cloud Run', 'Containers', 'Serverless'],
      },
      {
        title: 'Multi-Cloud with Anthos',
        description:
          'Unified application management across GCP, AWS, and on-premises with Anthos service mesh.',
        date: 'Jan 26, 2026',
        author: 'Hybrid Cloud Team',
        category: 'Multi-Cloud',
        tags: ['Anthos', 'Multi-Cloud', 'Service Mesh'],
      },
      {
        title: 'Real-Time Analytics with Dataflow',
        description:
          'Stream processing pipelines using Apache Beam on Dataflow for real-time data transformation.',
        date: 'Jan 23, 2026',
        author: 'Data Streaming Team',
        category: 'Data & Analytics',
        tags: ['Dataflow', 'Streaming', 'Apache Beam'],
      },
    ],
    architecture: [
      {
        title: 'Data Lake Architecture with Cloud Storage',
        description:
          'Scalable data lake using Cloud Storage, Dataproc, and BigQuery for petabyte-scale analytics.',
        category: 'Data & Analytics',
        complexity: 'Intermediate',
        tags: ['Data Lake', 'BigQuery', 'Cloud Storage'],
        date: 'Updated Feb 2026',
      },
      {
        title: 'ML Model Serving with Vertex AI',
        description:
          'Production ML deployment architecture with Vertex AI Endpoints, monitoring, and A/B testing.',
        category: 'AI/ML',
        complexity: 'Advanced',
        tags: ['Vertex AI', 'ML Serving', 'Production'],
        date: 'Updated Feb 2026',
      },
      {
        title: 'Microservices on GKE with Istio',
        description:
          'Cloud-native architecture using GKE, Istio service mesh, and Cloud Load Balancing.',
        category: 'Containers',
        complexity: 'Advanced',
        tags: ['GKE', 'Istio', 'Microservices'],
        date: 'Updated Jan 2026',
      },
      {
        title: 'Event-Driven Architecture with Pub/Sub',
        description:
          'Asynchronous messaging patterns using Cloud Pub/Sub, Cloud Functions, and Firestore.',
        category: 'Serverless',
        complexity: 'Intermediate',
        tags: ['Pub/Sub', 'Cloud Functions', 'Events'],
        date: 'Updated Jan 2026',
      },
      {
        title: 'Global Application with Cloud CDN',
        description:
          'Low-latency global delivery using Cloud CDN, Cloud Load Balancing, and Cloud Armor.',
        category: 'Networking',
        complexity: 'Intermediate',
        tags: ['CDN', 'Global', 'Performance'],
        date: 'Updated Jan 2026',
      },
      {
        title: 'Hybrid Connectivity with Cloud Interconnect',
        description:
          'Enterprise-grade network connectivity between on-premises and GCP using Dedicated Interconnect.',
        category: 'Networking',
        complexity: 'Advanced',
        tags: ['Interconnect', 'Hybrid', 'Networking'],
        date: 'Updated Dec 2025',
      },
    ],
  },
};

function generateBlogPage(provider, content) {
  const providerName = provider.toUpperCase();
  const categories = [...new Set(content.map((item) => item.category))];

  return `import React from 'react';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';

export default function ${provider.charAt(0).toUpperCase() + provider.slice(1)}BlogPage() {
  const blogPosts = ${JSON.stringify(content, null, 2)};

  const categories = ${JSON.stringify(categories)};

  return (
    <ContentListingTemplate
      title="${providerName} Cloud Insights"
      description="Expert analysis, architectural patterns, and best practices for building on ${providerName === 'GCP' ? 'Google Cloud Platform' : 'Microsoft Azure'}."
      items={blogPosts}
      itemType="blog"
      categories={categories}
    />
  );
}
`;
}

function generateArchitecturePage(provider, content) {
  const providerName = provider.toUpperCase();
  const categories = [...new Set(content.map((item) => item.category))];

  return `import React from 'react';
import { ContentListingTemplate } from '@/components/templates/ContentListingTemplate';

export default function ${provider.charAt(0).toUpperCase() + provider.slice(1)}ArchitectureDesignsPage() {
  const architectures = ${JSON.stringify(content, null, 2)};

  const categories = ${JSON.stringify(categories)};

  return (
    <ContentListingTemplate
      title="${providerName} Reference Architectures"
      description="Battle-tested architectural patterns and design blueprints for scalable, secure, and cost-effective ${providerName === 'GCP' ? 'Google Cloud' : 'Azure'} solutions."
      items={architectures}
      itemType="architecture"
      categories={categories}
    />
  );
}
`;
}

// Generate files
['azure', 'gcp'].forEach((provider) => {
  const blogContent = generateBlogPage(provider, providerContent[provider].blog);
  const archContent = generateArchitecturePage(provider, providerContent[provider].architecture);

  const blogPath = path.join(__dirname, `../src/pages/${provider}/BlogPage.jsx`);
  const archPath = path.join(__dirname, `../src/pages/${provider}/ArchitectureDesignsPage.jsx`);

  fs.writeFileSync(blogPath, blogContent);
  fs.writeFileSync(archPath, archContent);

  console.log(`✓ Created ${provider}/BlogPage.jsx`);
  console.log(`✓ Created ${provider}/ArchitectureDesignsPage.jsx`);
});

console.log('\n✅ All provider content pages generated successfully!');
