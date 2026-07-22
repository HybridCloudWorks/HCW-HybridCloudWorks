import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { getProviderPath, routes } from '@/lib/routeFactory';

// ── Shared data (mirrors EducationPage) ─────────────────────────────────────

const LEVEL_META = {
  Fundamentals: {
    badge: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
    accent: 'from-sky-900/30',
    glow: 'rgba(14,165,233,0.15)',
    label: 'Fundamentals',
  },
  Associate: {
    badge: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    accent: 'from-emerald-900/30',
    glow: 'rgba(16,185,129,0.15)',
    label: 'Associate',
  },
  Expert: {
    badge: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
    accent: 'from-violet-900/30',
    glow: 'rgba(139,92,246,0.15)',
    label: 'Expert',
  },
  Specialty: {
    badge: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
    accent: 'from-amber-900/30',
    glow: 'rgba(245,158,11,0.15)',
    label: 'Specialty',
  },
};

function getNextCertDotClass(level) {
  switch (level) {
    case 'Fundamentals':
      return 'bg-sky-500';
    case 'Associate':
      return 'bg-emerald-500';
    case 'Expert':
      return 'bg-violet-500';
    default:
      return 'bg-amber-500';
  }
}

const ALL_CERTS = [
  {
    slug: 'az-900',
    title: 'Microsoft Azure Fundamentals',
    code: 'AZ-900',
    level: 'Fundamentals',
    description: 'Foundational knowledge of cloud concepts and Azure core services.',
    longDescription:
      'Demonstrate foundational knowledge of cloud concepts and Microsoft Azure. This entry-level certification is ideal for anyone beginning their cloud journey, covering cloud models, Azure services, pricing, SLAs, and governance.',
    topics: ['Cloud Concepts', 'Azure Services', 'Pricing & SLAs', 'Governance & Compliance'],
    hours: 10,
    prepTime: '~4 weeks',
    successRate: '82%',
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-900',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-900',
    modules: [
      {
        title: 'Describe cloud concepts',
        url: 'https://learn.microsoft.com/en-us/training/modules/describe-cloud-compute/',
      },
      {
        title: 'Describe Azure architecture and services',
        url: 'https://learn.microsoft.com/en-us/training/modules/describe-core-azure-services/',
      },
      {
        title: 'Describe Azure management and governance',
        url: 'https://learn.microsoft.com/en-us/training/modules/describe-cost-management-azure/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'No prerequisites — recommended for beginners.',
    nextCerts: ['az-104', 'ai-900', 'dp-900'],
  },
  {
    slug: 'ai-900',
    title: 'Microsoft Azure AI Fundamentals',
    code: 'AI-900',
    level: 'Fundamentals',
    description: 'Core concepts of AI and machine learning on Azure.',
    longDescription:
      'Validate foundational knowledge of artificial intelligence (AI) and machine learning (ML) concepts and related Azure services. Ideal for those beginning to explore AI workloads.',
    topics: ['AI Workloads', 'ML Principles', 'Computer Vision', 'NLP', 'Generative AI'],
    hours: 12,
    prepTime: '~4 weeks',
    successRate: '80%',
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-ai-fundamentals/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-900',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=ai-900',
    modules: [
      {
        title: 'Get started with AI on Azure',
        url: 'https://learn.microsoft.com/en-us/training/modules/get-started-ai-fundamentals/',
      },
      {
        title: 'Explore visual tools for ML',
        url: 'https://learn.microsoft.com/en-us/training/modules/create-classification-model-azure-machine-learning-designer/',
      },
      {
        title: 'Explore computer vision in Microsoft Azure',
        url: 'https://learn.microsoft.com/en-us/training/modules/analyze-images-computer-vision/',
      },
      {
        title: 'Explore natural language processing',
        url: 'https://learn.microsoft.com/en-us/training/modules/analyze-text-with-text-analytics-service/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'Familiarity with computers. AZ-900 recommended but not required.',
    nextCerts: ['ai-102'],
  },
  {
    slug: 'dp-900',
    title: 'Microsoft Azure Data Fundamentals',
    code: 'DP-900',
    level: 'Fundamentals',
    description: 'Core data concepts and Azure data services fundamentals.',
    longDescription:
      'Demonstrate foundational knowledge of core data concepts and how they are implemented using Microsoft Azure data services. Covers relational, non-relational, and analytics workloads.',
    topics: ['Relational Data', 'Non-Relational Data', 'Analytics Workloads', 'Azure Databases'],
    hours: 10,
    prepTime: '~4 weeks',
    successRate: '81%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/azure-data-fundamentals/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/dp-900',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=dp-900',
    modules: [
      {
        title: 'Explore core data concepts',
        url: 'https://learn.microsoft.com/en-us/training/modules/explore-core-data-concepts/',
      },
      {
        title: 'Explore relational data in Azure',
        url: 'https://learn.microsoft.com/en-us/training/modules/explore-relational-data-offerings/',
      },
      {
        title: 'Explore non-relational data in Azure',
        url: 'https://learn.microsoft.com/en-us/training/modules/explore-non-relational-data-stores-azure/',
      },
      {
        title: 'Explore analytics in Azure',
        url: 'https://learn.microsoft.com/en-us/training/modules/explore-data-analytics-scale/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'Basic familiarity with data concepts. AZ-900 recommended.',
    nextCerts: ['dp-203'],
  },
  {
    slug: 'sc-900',
    title: 'Microsoft Security, Compliance, and Identity Fundamentals',
    code: 'SC-900',
    level: 'Fundamentals',
    description: 'Foundational knowledge of security, compliance, and identity across Microsoft.',
    longDescription:
      'Validate your knowledge of security, compliance, and identity concepts and related Microsoft products. Ideal for business stakeholders and IT professionals beginning their security journey.',
    topics: [
      'Security Concepts',
      'Identity & Access',
      'Microsoft Compliance',
      'Microsoft Defender',
    ],
    hours: 10,
    prepTime: '~4 weeks',
    successRate: '79%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/security-compliance-and-identity-fundamentals/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/sc-900',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=sc-900',
    modules: [
      {
        title: 'Describe security and compliance concepts',
        url: 'https://learn.microsoft.com/en-us/training/modules/describe-security-concepts-methodologies/',
      },
      {
        title: 'Describe Microsoft Entra capabilities',
        url: 'https://learn.microsoft.com/en-us/training/modules/explore-basic-services-identity-types/',
      },
      {
        title: 'Describe Microsoft security solutions',
        url: 'https://learn.microsoft.com/en-us/training/modules/describe-security-capabilities-of-azure/',
      },
      {
        title: 'Describe Microsoft compliance solutions',
        url: 'https://learn.microsoft.com/en-us/training/modules/describe-compliance-management-capabilities-microsoft/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'General understanding of Microsoft cloud services.',
    nextCerts: ['az-500', 'sc-200'],
  },
  {
    slug: 'az-104',
    title: 'Microsoft Azure Administrator',
    code: 'AZ-104',
    level: 'Associate',
    description: 'Manage Azure subscriptions, resources, and cloud infrastructure.',
    longDescription:
      'Master the essential skills needed to manage cloud services on Microsoft Azure. This certification covers compute resources, networking, storage, security, and monitoring — the core competencies of an Azure Administrator.',
    topics: ['Identity & Governance', 'Compute', 'Networking', 'Storage', 'Monitoring & Backup'],
    hours: 45,
    prepTime: '~3 months',
    successRate: '78%',
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-administrator/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-104',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-104',
    modules: [
      {
        title: 'Manage Azure identities and governance',
        url: 'https://learn.microsoft.com/en-us/training/modules/azure-active-directory/',
      },
      {
        title: 'Implement and manage storage',
        url: 'https://learn.microsoft.com/en-us/training/modules/azure-storage-fundamentals/',
      },
      {
        title: 'Deploy and manage Azure compute resources',
        url: 'https://learn.microsoft.com/en-us/training/modules/azure-compute-fundamentals/',
      },
      {
        title: 'Implement and manage virtual networking',
        url: 'https://learn.microsoft.com/en-us/training/modules/azure-networking-fundamentals/',
      },
      {
        title: 'Monitor and maintain Azure resources',
        url: 'https://learn.microsoft.com/en-us/training/modules/intro-to-azure-monitor/',
      },
    ],
    appliedSkills: [
      {
        code: 'APL-1002',
        title: 'Deploy and configure Azure Monitor',
        url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/deploy-and-configure-azure-monitor/',
      },
      {
        code: 'APL-1003',
        title: 'Secure storage for Azure Files and Azure Blob Storage',
        url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/secure-storage-azure-files-azure-blob-storage/',
      },
    ],
    prerequisites: 'AZ-900 recommended. 6+ months Azure experience.',
    nextCerts: ['az-305', 'az-500', 'az-700'],
  },
  {
    slug: 'az-204',
    title: 'Developing Solutions for Microsoft Azure',
    code: 'AZ-204',
    level: 'Associate',
    description: 'Design, build, test, and maintain cloud solutions on Azure.',
    longDescription:
      'Validate your ability to design and build cloud-native solutions on Azure. Covers compute, storage, security, API management, event-based, and message-based solutions.',
    topics: [
      'Compute Solutions',
      'Azure Storage',
      'Security',
      'API Management',
      'Event-Based Solutions',
    ],
    hours: 40,
    prepTime: '~3 months',
    successRate: '74%',
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-developer/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-204',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-204',
    modules: [
      {
        title: 'Implement Azure App Service web apps',
        url: 'https://learn.microsoft.com/en-us/training/modules/host-a-web-app-with-azure-app-service/',
      },
      {
        title: 'Implement containerized solutions',
        url: 'https://learn.microsoft.com/en-us/training/modules/intro-to-containers/',
      },
      {
        title: 'Implement Azure security',
        url: 'https://learn.microsoft.com/en-us/training/modules/intro-to-azure-key-vault/',
      },
      {
        title: 'Connect to and consume Azure services',
        url: 'https://learn.microsoft.com/en-us/training/modules/azure-event-grid/',
      },
    ],
    appliedSkills: [],
    prerequisites: '1+ year professional development experience. AZ-900 recommended.',
    nextCerts: ['az-305', 'az-400'],
  },
  {
    slug: 'az-500',
    title: 'Microsoft Azure Security Engineer',
    code: 'AZ-500',
    level: 'Associate',
    description: 'Implement and manage security across Azure workloads.',
    longDescription:
      'Validate your ability to implement security controls, maintain security posture, and identify and remediate vulnerabilities across Azure infrastructure.',
    topics: [
      'Identity & Access',
      'Platform Protection',
      'Data & Application Security',
      'Security Operations',
    ],
    hours: 50,
    prepTime: '~4 months',
    successRate: '75%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/azure-security-engineer/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-500',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-500',
    modules: [
      {
        title: 'Manage identity and access',
        url: 'https://learn.microsoft.com/en-us/training/modules/secure-azure-active-directory/',
      },
      {
        title: 'Secure networking',
        url: 'https://learn.microsoft.com/en-us/training/modules/secure-and-isolate-with-nsg-and-service-endpoints/',
      },
      {
        title: 'Secure compute, storage, and databases',
        url: 'https://learn.microsoft.com/en-us/training/modules/azure-well-architected-security/',
      },
      {
        title: 'Manage security operations',
        url: 'https://learn.microsoft.com/en-us/training/modules/intro-to-azure-defender/',
      },
    ],
    appliedSkills: [
      {
        code: 'APL-1005',
        title: 'Configure SIEM security operations using Microsoft Sentinel',
        url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/configure-siem-security-operations-using-microsoft-sentinel/',
      },
    ],
    prerequisites:
      'AZ-104 or equivalent experience. Understanding of networking and virtualization.',
    nextCerts: ['az-305'],
  },
  {
    slug: 'az-700',
    title: 'Designing and Implementing Microsoft Azure Networking Solutions',
    code: 'AZ-700',
    level: 'Associate',
    description: 'Design and implement core Azure networking infrastructure.',
    longDescription:
      'Validate your skills in designing and implementing Azure networking solutions including virtual networks, load balancing, routing, hybrid connectivity, and network security.',
    topics: ['Hybrid Connectivity', 'Routing', 'Load Balancing', 'Azure DNS', 'Private Access'],
    hours: 40,
    prepTime: '~3 months',
    successRate: '73%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/azure-network-engineer/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-700',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-700',
    modules: [
      {
        title: 'Design and implement Azure VNets',
        url: 'https://learn.microsoft.com/en-us/training/modules/introduction-to-azure-virtual-networks/',
      },
      {
        title: 'Design and implement hybrid networking',
        url: 'https://learn.microsoft.com/en-us/training/modules/design-implement-hybrid-networking/',
      },
      {
        title: 'Design and implement Azure ExpressRoute',
        url: 'https://learn.microsoft.com/en-us/training/modules/design-implement-azure-expressroute/',
      },
      {
        title: 'Load balancing in Azure',
        url: 'https://learn.microsoft.com/en-us/training/modules/load-balancing-https-traffic-azure/',
      },
    ],
    appliedSkills: [
      {
        code: 'APL-1001',
        title: 'Configure secure access to your workloads using Azure networking',
        url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/configure-secure-workloads-use-azure-virtual-networking/',
      },
    ],
    prerequisites: 'AZ-104 or equivalent networking knowledge.',
    nextCerts: ['az-305'],
  },
  {
    slug: 'az-800',
    title: 'Administering Windows Server Hybrid Core Infrastructure',
    code: 'AZ-800',
    level: 'Associate',
    description: 'Administer Windows Server in on-premises, hybrid, and IaaS workloads.',
    longDescription:
      'Validate your ability to configure and manage Windows Server on-premises, hybrid, and IaaS platform workloads including Active Directory Domain Services, identity, storage, and compute.',
    topics: ['Active Directory', 'Windows Server', 'Hybrid Identity', 'Storage', 'Virtualization'],
    hours: 40,
    prepTime: '~3 months',
    successRate: '71%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/windows-server-hybrid-administrator/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-800',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-800',
    modules: [
      {
        title: 'Deploy and manage AD DS in on-premises and cloud environments',
        url: 'https://learn.microsoft.com/en-us/training/modules/deploy-manage-active-directory-domain-services/',
      },
      {
        title: 'Manage Windows Servers and workloads in a hybrid environment',
        url: 'https://learn.microsoft.com/en-us/training/modules/deploy-azure-arc-enabled-servers/',
      },
      {
        title: 'Manage virtual machines and containers',
        url: 'https://learn.microsoft.com/en-us/training/modules/hyper-v-replica/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'Windows Server and Active Directory experience (on-premises and cloud).',
    nextCerts: ['az-305'],
  },
  {
    slug: 'az-140',
    title: 'Configuring and Operating Microsoft Azure Virtual Desktop',
    code: 'AZ-140',
    level: 'Associate',
    description: 'Plan, deliver, and manage virtual desktop experiences on Azure.',
    longDescription:
      'Validate your skills in planning, delivering, managing, and monitoring virtual desktop experiences and remote apps on Azure Virtual Desktop.',
    topics: ['AVD Architecture', 'Networking', 'Storage', 'Access Management', 'Monitoring'],
    hours: 35,
    prepTime: '~3 months',
    successRate: '72%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/azure-virtual-desktop-specialty/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-140',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-140',
    modules: [
      {
        title: 'Plan an Azure Virtual Desktop implementation',
        url: 'https://learn.microsoft.com/en-us/training/modules/plan-azure-virtual-desktop-implementation/',
      },
      {
        title: 'Implement an Azure Virtual Desktop infrastructure',
        url: 'https://learn.microsoft.com/en-us/training/modules/implement-manage-networking-azure-virtual-desktop/',
      },
      {
        title: 'Manage access and security',
        url: 'https://learn.microsoft.com/en-us/training/modules/manage-access-azure-virtual-desktop/',
      },
      {
        title: 'Manage user environments and apps',
        url: 'https://learn.microsoft.com/en-us/training/modules/configure-user-experience-settings/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'AZ-104 or equivalent. Experience with Azure networking and virtualization.',
    nextCerts: ['az-305'],
  },
  {
    slug: 'dp-203',
    title: 'Microsoft Azure Data Engineer',
    code: 'DP-203',
    level: 'Associate',
    description: 'Design and implement data storage and data processing solutions on Azure.',
    longDescription:
      'Validate your expertise in integrating, transforming, and consolidating data from structured, unstructured, and streaming data systems into Azure analytical solutions.',
    topics: [
      'Data Storage',
      'Data Processing',
      'Data Security',
      'Azure Synapse Analytics',
      'Azure Databricks',
    ],
    hours: 50,
    prepTime: '~4 months',
    successRate: '70%',
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-data-engineer/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/dp-203',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=dp-203',
    modules: [
      {
        title: 'Introduction to data engineering on Azure',
        url: 'https://learn.microsoft.com/en-us/training/modules/introduction-to-data-engineering-azure/',
      },
      {
        title: 'Build data analytics solutions using Azure Synapse serverless SQL pools',
        url: 'https://learn.microsoft.com/en-us/training/paths/build-data-analytics-solutions-using-azure-synapse-serverless-sql-pools/',
      },
      {
        title: 'Perform data engineering with Azure Databricks',
        url: 'https://learn.microsoft.com/en-us/training/paths/perform-data-engineering-with-azure-databricks/',
      },
      {
        title: 'Implement a Data Streaming Solution with Azure Stream Analytics',
        url: 'https://learn.microsoft.com/en-us/training/paths/implement-data-streaming-with-asa/',
      },
    ],
    appliedSkills: [
      {
        code: 'APL-1008',
        title: 'Migrate SQL Server workloads to Azure SQL Database',
        url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/migrate-sql-workloads-azure-sql-database/',
      },
    ],
    prerequisites: 'DP-900 recommended. Knowledge of SQL and data processing concepts.',
    nextCerts: [],
  },
  {
    slug: 'ai-102',
    title: 'Designing and Implementing a Microsoft Azure AI Solution',
    code: 'AI-102',
    level: 'Associate',
    description:
      'Build AI solutions using Azure Cognitive Services, Azure AI Search, and Azure OpenAI.',
    longDescription:
      'Validate your ability to build, manage, and deploy AI solutions using Azure AI Services, Azure OpenAI Service, and Azure AI Search — including NLP, computer vision, and generative AI.',
    topics: ['Azure AI Services', 'NLP', 'Computer Vision', 'Azure OpenAI', 'AI Search'],
    hours: 45,
    prepTime: '~3 months',
    successRate: '72%',
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-ai-engineer/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-102',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=ai-102',
    modules: [
      {
        title: 'Get started with Azure AI Services',
        url: 'https://learn.microsoft.com/en-us/training/modules/introduction-to-azure-ai/',
      },
      {
        title: 'Develop NLP solutions with Azure AI Language',
        url: 'https://learn.microsoft.com/en-us/training/modules/analyze-text-with-text-analytics-service/',
      },
      {
        title: 'Develop Generative AI Solutions with Azure OpenAI Service',
        url: 'https://learn.microsoft.com/en-us/training/modules/explore-azure-openai/',
      },
      {
        title: 'Implement knowledge mining with Azure AI Search',
        url: 'https://learn.microsoft.com/en-us/training/modules/introduction-to-azure-search/',
      },
    ],
    appliedSkills: [
      {
        code: 'APL-1006',
        title: 'Build a natural language processing solution with Azure AI Language',
        url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/build-natural-language-solution-azure-ai/',
      },
      {
        code: 'APL-1007',
        title: 'Develop generative AI solutions with Azure OpenAI Service',
        url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/develop-generative-ai-solutions-with-azure-openai-service/',
      },
    ],
    prerequisites: 'AI-900 recommended. Programming experience (C# or Python).',
    nextCerts: [],
  },
  {
    slug: 'az-305',
    title: 'Microsoft Azure Solutions Architect Expert',
    code: 'AZ-305',
    level: 'Expert',
    description: 'Design comprehensive Azure solutions and enterprise-scale architecture.',
    longDescription:
      'Validate advanced subject matter expertise in designing cloud and hybrid solutions that run on Azure, covering identity, governance, compute, storage, and networking at enterprise scale.',
    topics: [
      'Identity & Governance',
      'Compute Architecture',
      'Storage Design',
      'Networking Design',
      'Migration',
    ],
    hours: 60,
    prepTime: '~6 months',
    successRate: '71%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/azure-solutions-architect/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-305',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-305',
    modules: [
      {
        title: 'Design identity, governance, and monitoring solutions',
        url: 'https://learn.microsoft.com/en-us/training/modules/design-identity-governance-monitor-solutions/',
      },
      {
        title: 'Design data storage solutions',
        url: 'https://learn.microsoft.com/en-us/training/modules/design-data-storage-solution-for-non-relational-data/',
      },
      {
        title: 'Design business continuity solutions',
        url: 'https://learn.microsoft.com/en-us/training/modules/design-solution-for-backup-disaster-recovery/',
      },
      {
        title: 'Design infrastructure solutions',
        url: 'https://learn.microsoft.com/en-us/training/modules/design-compute-solution/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'AZ-104 required. AZ-204 recommended. Advanced Azure experience.',
    nextCerts: [],
  },
  {
    slug: 'az-400',
    title: 'Azure DevOps Engineer Expert',
    code: 'AZ-400',
    level: 'Expert',
    description: 'Implement CI/CD pipelines and DevOps practices on Azure.',
    longDescription:
      'Validate advanced expertise in combining people, processes, and technology to continuously deliver valuable products and services. Covers CI/CD, infrastructure as code, monitoring, and security.',
    topics: [
      'CI/CD Pipelines',
      'Infrastructure as Code',
      'Security Integration',
      'Monitoring',
      'Automation',
    ],
    hours: 65,
    prepTime: '~6 months',
    successRate: '69%',
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/devops-engineer/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-400',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-400',
    modules: [
      {
        title: 'AZ-400: Get started on a DevOps transformation journey',
        url: 'https://learn.microsoft.com/en-us/training/paths/az-400-get-started-devops-transformation-journey/',
      },
      {
        title: 'AZ-400: Implement CI with Azure Pipelines and GitHub Actions',
        url: 'https://learn.microsoft.com/en-us/training/paths/az-400-implement-ci-azure-pipelines-github-actions/',
      },
      {
        title: 'AZ-400: Design and implement a release strategy',
        url: 'https://learn.microsoft.com/en-us/training/paths/az-400-design-implement-release-strategy/',
      },
      {
        title: 'AZ-400: Implement security and validate code bases for compliance',
        url: 'https://learn.microsoft.com/en-us/training/paths/az-400-implement-security-validate-code-bases-compliance/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'AZ-104 or AZ-204 required. DevOps experience highly recommended.',
    nextCerts: [],
  },
  {
    slug: 'az-120',
    title: 'Planning and Administering Microsoft Azure for SAP Workloads',
    code: 'AZ-120',
    level: 'Specialty',
    description: 'Architect and administer SAP solutions on Microsoft Azure.',
    longDescription:
      'Validate your expertise in planning, migration, and administration of SAP solutions on Azure, covering infrastructure, SAP HANA, high availability, and disaster recovery.',
    topics: [
      'SAP on Azure',
      'Migration Planning',
      'Compute & Storage',
      'HANA',
      'High Availability',
    ],
    hours: 50,
    prepTime: '~4 months',
    successRate: '68%',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/azure-for-sap-workloads-specialty/',
    studyGuideUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-120',
    practiceUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=az-120',
    modules: [
      {
        title: 'AZ-120: Planning for SAP Workloads on Microsoft Azure',
        url: 'https://learn.microsoft.com/en-us/training/paths/plan-sap-workloads/',
      },
      {
        title: 'AZ-120: Migrating SAP Workloads to Azure',
        url: 'https://learn.microsoft.com/en-us/training/paths/migrate-sap-workloads-azure/',
      },
      {
        title: 'AZ-120: Administering SAP Workloads on Azure',
        url: 'https://learn.microsoft.com/en-us/training/paths/administer-sap-workloads-azure/',
      },
    ],
    appliedSkills: [],
    prerequisites: 'AZ-104 and SAP HANA or SAP NetWeaver experience required.',
    nextCerts: [],
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function CertDetailPage() {
  const { certSlug } = useParams();
  const cert = ALL_CERTS.find((c) => c.slug === certSlug);

  if (!cert) {
    return (
      <main className="grow pt-28 pb-20 px-4 md:px-8 max-w-360 mx-auto w-full">
        <div className="text-center py-20">
          <span className="text-primary text-[64px] material-symbols-outlined mb-4 block">
            search_off
          </span>
          <h1 className="text-3xl font-bold text-white mb-4">Certification Not Found</h1>
          <p className="text-foreground mb-8">
            The certification <code className="font-mono text-primary">{certSlug}</code> was not
            found.
          </p>
          <Link
            to={routes.education('azure')}
            className="px-6 h-11 bg-primary hover:bg-blue-800 text-white font-bold rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Azure Education
          </Link>
        </div>
      </main>
    );
  }

  const meta = LEVEL_META[cert.level];
  const nextCerts = ALL_CERTS.filter((c) => cert.nextCerts?.includes(c.slug));

  return (
    <>
      <Helmet>
        <title>
          {cert.code}: {cert.title} | Azure Education | HCW
        </title>
        <meta name="description" content={cert.description} />
        <meta property="og:title" content={`${cert.code}: ${cert.title}`} />
        <meta property="og:description" content={cert.longDescription} />
      </Helmet>

      <main className="grow pt-28 pb-20 px-4 md:px-8 max-w-360 mx-auto w-full">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-foreground/60 mb-8">
          <Link to={routes.education('azure')} className="hover:text-primary transition-colors">
            Azure Education
          </Link>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-foreground">{cert.code}</span>
        </nav>

        {/* Hero */}
        <section
          className={`mb-10 bg-linear-to-br ${meta.accent} to-card/20 backdrop-blur-md border border-card/40 rounded-2xl p-8 relative overflow-hidden`}
        >
          <div
            className="absolute -top-10 -right-10 w-64 h-64 rounded-full blur-3xl pointer-events-none"
            style={{ background: `radial-gradient(circle, ${meta.glow} 0%, transparent 70%)` }}
          />
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className={`px-3 py-1 border text-xs font-bold rounded ${meta.badge}`}>
                {cert.level}
              </span>
              <span className="text-sm font-mono text-foreground/60">{cert.code}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">{cert.title}</h1>
            <p className="text-foreground text-lg max-w-3xl mb-6">{cert.longDescription}</p>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <div className="text-foreground/60 mb-0.5">Study Hours</div>
                <div className="text-2xl font-bold text-primary">{cert.hours}h</div>
              </div>
              <div>
                <div className="text-foreground/60 mb-0.5">Prep Time</div>
                <div className="text-2xl font-bold text-white">{cert.prepTime}</div>
              </div>
              {cert.successRate && (
                <div>
                  <div className="text-foreground/60 mb-0.5">Avg. Pass Rate</div>
                  <div className="text-2xl font-bold text-cyan-400">{cert.successRate}</div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          <div className="space-y-8">
            {/* Topics */}
            <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-primary material-symbols-outlined text-[20px]">category</span>
                Topics Covered
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {cert.topics.map((topic, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-card/50 rounded-xl px-3 py-2.5"
                  >
                    <span className="text-primary material-symbols-outlined text-[16px]">
                      check_circle
                    </span>
                    <span className="text-foreground text-sm">{topic}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Microsoft Learn Modules */}
            <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-primary material-symbols-outlined text-[20px]">
                  menu_book
                </span>
                Microsoft Learn Modules
              </h2>
              <div className="space-y-3">
                {cert.modules.map((mod, i) => (
                  <a
                    key={i}
                    href={mod.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 group bg-card/40 hover:bg-card/60 border border-card/30 hover:border-primary/30 rounded-xl px-4 py-3 transition-all"
                  >
                    <span className="shrink-0 w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground group-hover:text-primary transition-colors flex-1">
                      {mod.title}
                    </span>
                    <span className="material-symbols-outlined text-[14px] text-foreground/40 group-hover:text-primary transition-colors shrink-0">
                      open_in_new
                    </span>
                  </a>
                ))}
              </div>
            </section>

            {/* Applied Skills */}
            {cert.appliedSkills?.length > 0 && (
              <section className="bg-card/40 backdrop-blur-md border border-cyan-500/20 rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                  <span className="text-cyan-400 material-symbols-outlined text-[20px]">
                    construction
                  </span>
                  Associated Applied Skills
                </h2>
                <p className="text-sm text-foreground/70 mb-4">
                  Scenario-based assessments that complement this certification with hands-on proof.
                </p>
                <div className="space-y-3">
                  {cert.appliedSkills.map((skill, i) => (
                    <a
                      key={i}
                      href={skill.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 group bg-card/40 hover:bg-cyan-900/20 border border-card/30 hover:border-cyan-500/30 rounded-xl px-4 py-3 transition-all"
                    >
                      <span className="text-cyan-400 material-symbols-outlined text-[18px] shrink-0 mt-0.5">
                        verified
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-mono text-foreground/50 mb-0.5">
                          {skill.code}
                        </div>
                        <div className="text-sm font-semibold text-foreground group-hover:text-cyan-300 transition-colors">
                          {skill.title}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-[14px] text-foreground/40 group-hover:text-cyan-300 transition-colors shrink-0 mt-1">
                        open_in_new
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* What's Next */}
            {nextCerts.length > 0 && (
              <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <span className="text-primary material-symbols-outlined text-[20px]">
                    trending_up
                  </span>
                  What to Study Next
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {nextCerts.map((next) => (
                    <Link
                      key={next.slug}
                      to={getProviderPath('azure', `education/${next.slug}`)}
                      className="group flex items-center gap-3 bg-card/40 hover:bg-card/60 border border-card/30 hover:border-primary/30 rounded-xl px-4 py-3 transition-all"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${getNextCertDotClass(next.level)}`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-foreground/50">{next.code}</div>
                        <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                          {next.title.replace(/Microsoft\s+/i, '')}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-[16px] text-foreground/40 group-hover:text-primary transition-colors ml-auto shrink-0">
                        arrow_forward
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-6 h-fit sticky top-28">
            {/* CTA */}
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6 space-y-3">
              <a
                href={cert.learnUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full h-11 bg-primary hover:bg-blue-800 text-white font-bold rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                View on Microsoft Learn
              </a>
              {cert.studyGuideUrl && (
                <a
                  href={cert.studyGuideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full h-11 bg-card/50 hover:bg-card/70 text-foreground font-semibold rounded-lg transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">description</span>
                  Official Study Guide
                </a>
              )}
              {cert.practiceUrl && (
                <a
                  href={cert.practiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full h-11 bg-card/50 hover:bg-card/70 text-foreground font-semibold rounded-lg transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">quiz</span>
                  Free Practice Assessment
                </a>
              )}
            </div>

            {/* Prerequisites */}
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-primary material-symbols-outlined text-[18px]">info</span>
                Prerequisites
              </h3>
              <p className="text-sm text-foreground">{cert.prerequisites}</p>
            </div>

            {/* Quick Stats */}
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white">Quick Stats</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground/60">Exam Code</span>
                  <span className="font-mono font-bold text-primary">{cert.code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/60">Level</span>
                  <span
                    className={`px-2 py-0.5 border text-[10px] font-bold rounded ${meta.badge}`}
                  >
                    {cert.level}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/60">Study Hours</span>
                  <span className="font-bold text-white">{cert.hours}h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/60">Prep Time</span>
                  <span className="font-bold text-white">{cert.prepTime}</span>
                </div>
                {cert.successRate && (
                  <div className="flex justify-between">
                    <span className="text-foreground/60">Avg. Pass Rate</span>
                    <span className="font-bold text-cyan-400">{cert.successRate}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-foreground/60">MS Learn Modules</span>
                  <span className="font-bold text-white">{cert.modules.length}</span>
                </div>
              </div>
            </div>

            <Link
              to={routes.education('azure')}
              className="flex items-center gap-2 text-sm text-foreground/60 hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Azure Education
            </Link>
          </aside>
        </div>
      </main>
    </>
  );
}
