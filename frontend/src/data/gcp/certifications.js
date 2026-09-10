/**
 * Google Cloud certification catalogue for /gcp/education (#461).
 *
 * Verified 2026-09-09 against https://cloud.google.com/learn/certification
 * and each credential's own page under that path; the page had nine and still
 * called the Workspace credential "Professional", which Google retired in
 * favour of the Associate Google Workspace Administrator (the Professional
 * URL now returns 404).
 *
 * RE-VERIFIED 2026-09-09 (#469 item 1) against the same index, which now
 * lists FIFTEEN — two Foundational, three Associate and ten Professional.
 * Thirteen were carried. The two that were not:
 *
 *   Professional Security Operations Engineer — added `active`. Two hours,
 *     $200, English and Japanese, 50-60 questions.
 *     https://cloud.google.com/learn/certification/security-operations-engineer
 *   Professional Agentic Architect — added `beta`. Google's index labels it
 *     "Agentic Architect (Beta)" and the certification page says the beta
 *     "is open until September 30", which is `betaEndDate` below. Three
 *     hours, $120 at the beta's 40% discount off a $200 retail price,
 *     English, ~80 questions, and a ONE-year validity rather than the two
 *     years a Professional certification normally carries.
 *     https://cloud.google.com/learn/certification/agentic-architect
 *
 * That `betaEndDate` is deliberate and it is an alarm: `findStaleStatuses`
 * fails the suite on 2026-10-01 for a `beta` row whose beta window has shut,
 * which is exactly when someone must go and read whether Google took it to
 * GA, extended the window, or withdrew it. No GA date is published yet, so
 * none is invented here.
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
  {
    id: 'psoe',
    slug: 'psoe',
    code: 'PSOE',
    title: 'Professional Security Operations Engineer',
    level: 'Professional',
    status: 'active',
    description:
      'Run a security operations practice on Google Cloud — detection engineering, threat hunting, triage and response across Google Security Operations. Two hours, $200, 50-60 questions, English and Japanese.',
    topics: ['Google SecOps', 'Detection Engineering', 'Threat Hunting', 'Incident Response'],
    hours: 45,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/security-operations-engineer',
  },
  {
    id: 'paa',
    slug: 'paa',
    code: 'PAA',
    title: 'Professional Agentic Architect',
    level: 'Professional',
    status: 'beta',
    betaEndDate: '2026-09-30',
    description:
      'Design, build, deploy and operate agentic systems on Google Cloud. In beta until September 30: three hours, ~80 questions, $120 at the beta discount against a $200 retail price, English only. Google gives the beta credential a one-year validity rather than the usual two, and publishes no GA date yet.',
    topics: ['Agentic Systems', 'Vertex AI Agents', 'Orchestration', 'Evaluation', 'Operations'],
    hours: 50,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://cloud.google.com/learn/certification/agentic-architect',
  },
];
