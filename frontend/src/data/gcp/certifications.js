/**
 * Google Cloud certification catalogue for /gcp/education (#461).
 *
 * Verified 2026-09-09 against https://cloud.google.com/learn/certification
 * and each credential's own page under that path. Google lists fourteen
 * certifications; the page had nine and still called the Workspace
 * credential "Professional", which Google retired in favour of the Associate
 * Google Workspace Administrator (the Professional URL now returns 404).
 *
 * Google does not publish exam codes; the `code` values here are the
 * community short forms this page has always used.
 *
 * `status` and any dates are read through `@/lib/certStatus` at render time;
 * `src/data/education-catalogues.test.js` fails when a dated row is past.
 */
export const DATA_AS_OF = '2026-09-09';

export const DATA_SOURCE = {
  label: 'Google Cloud certifications',
  url: 'https://cloud.google.com/learn/certification',
};

export const certifications = [
  {
    id: 'cdl',
    slug: 'cdl',
    code: 'CDL',
    title: 'Cloud Digital Leader',
    level: 'Foundational',
    status: 'active',
    description:
      'Understand how Google Cloud products can support digital transformation and drive business value.',
    topics: ['Digital Transformation', 'Cloud Value', 'Products'],
    hours: 10,
    prepTime: '~4 weeks',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-digital-leader',
  },
  {
    id: 'gail',
    slug: 'gail',
    code: 'GAIL',
    title: 'Generative AI Leader',
    level: 'Foundational',
    status: 'active',
    description:
      'Explain generative AI fundamentals, Google Cloud gen AI offerings, ways to improve model output, and business strategies for gen AI solutions.',
    topics: ['Gen AI Fundamentals', 'Gemini', 'Prompting', 'AI Strategy'],
    hours: 12,
    prepTime: '~4 weeks',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/generative-ai-leader',
  },
  {
    id: 'ace',
    slug: 'ace',
    code: 'ACE',
    title: 'Associate Cloud Engineer',
    level: 'Associate',
    status: 'active',
    description:
      'Deploy applications, monitor operations, and manage enterprise cloud solutions on Google Cloud.',
    topics: ['Compute', 'Storage', 'Networking', 'IAM', 'Billing'],
    hours: 40,
    prepTime: '~3 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-engineer',
  },
  {
    id: 'adp',
    slug: 'adp',
    code: 'ADP',
    title: 'Associate Data Practitioner',
    level: 'Associate',
    status: 'active',
    description:
      'Prepare and ingest data, analyze and present it, orchestrate pipelines, and manage data on Google Cloud.',
    topics: ['Data Ingestion', 'BigQuery', 'Pipelines', 'Data Management'],
    hours: 30,
    prepTime: '~2 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/data-practitioner',
  },
  {
    id: 'agwa',
    slug: 'agwa',
    code: 'AGWA',
    title: 'Associate Google Workspace Administrator',
    level: 'Associate',
    status: 'active',
    description:
      'Manage users and objects, core Workspace services, security policies, endpoints, and day-to-day troubleshooting in a Google Workspace environment.',
    topics: ['Admin Console', 'Security', 'Endpoints', 'Compliance'],
    hours: 30,
    prepTime: '~2 months',
    featured: false,
    learnUrl:
      'https://cloud.google.com/learn/certification/associate-google-workspace-administrator',
  },
  {
    id: 'pca',
    slug: 'pca',
    code: 'PCA',
    title: 'Professional Cloud Architect',
    level: 'Professional',
    status: 'active',
    description:
      'Design, develop, and manage robust, secure, scalable, highly available, and dynamic solutions on Google Cloud.',
    topics: ['Architecture', 'GKE', 'Multi-Region', 'Disaster Recovery'],
    hours: 60,
    prepTime: '~6 months',
    featured: true,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-architect',
  },
  {
    id: 'pcd',
    slug: 'pcd',
    code: 'PCD',
    title: 'Professional Cloud Developer',
    level: 'Professional',
    status: 'active',
    description:
      'Build and deploy scalable, secure applications using Google Cloud services and developer tooling.',
    topics: ['App Engine', 'Cloud Run', 'GKE', 'APIs', 'DevOps'],
    hours: 55,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-developer',
  },
  {
    id: 'pde',
    slug: 'pde',
    code: 'PDE',
    title: 'Professional Data Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Design and build data processing systems and create machine learning models using Google Cloud.',
    topics: ['BigQuery', 'Dataflow', 'Pub/Sub', 'Bigtable', 'ML'],
    hours: 55,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/data-engineer',
  },
  {
    id: 'pcdbe',
    slug: 'pcdbe',
    code: 'PCDBE',
    title: 'Professional Cloud Database Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Design, migrate, deploy, and manage scalable, highly available database solutions spanning Cloud SQL, Spanner, AlloyDB and more.',
    topics: ['Cloud SQL', 'Spanner', 'AlloyDB', 'Migration', 'HA'],
    hours: 50,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-database-engineer',
  },
  {
    id: 'pcdoe',
    slug: 'pcdoe',
    code: 'PCDOE',
    title: 'Professional Cloud DevOps Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Bootstrap a Google Cloud organization, apply SRE practices, build CI/CD pipelines, implement observability, and optimize performance and cost.',
    topics: ['SRE', 'CI/CD', 'Observability', 'Cost'],
    hours: 50,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-devops-engineer',
  },
  {
    id: 'pcse',
    slug: 'pcse',
    code: 'PCSE',
    title: 'Professional Cloud Security Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Configure and manage security across Google Cloud services, including IAM, VPC, and compliance.',
    topics: ['IAM', 'VPC', 'Encryption', 'Compliance', 'BeyondCorp'],
    hours: 50,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-security-engineer',
  },
  {
    id: 'pcne',
    slug: 'pcne',
    code: 'PCNE',
    title: 'Professional Cloud Network Engineer',
    level: 'Professional',
    status: 'active',
    description: 'Implement and manage networking infrastructure in Google Cloud environments.',
    topics: ['VPC', 'Load Balancing', 'Cloud CDN', 'Interconnect'],
    hours: 45,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/cloud-network-engineer',
  },
  {
    id: 'pmle',
    slug: 'pmle',
    code: 'PMLE',
    title: 'Professional Machine Learning Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Design, build, and productionize ML models using Vertex AI and MLOps on Google Cloud.',
    topics: ['Vertex AI', 'TFX', 'MLOps', 'Feature Store', 'Pipelines'],
    hours: 55,
    prepTime: '~5 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/machine-learning-engineer',
  },
];
