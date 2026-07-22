import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { getProviderPath, routes } from '@/lib/routeFactory';

// ── Shared data ──────────────────────────────────────────────────────────────

const LEVEL_META = {
  Foundational: {
    badge: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
    accent: 'from-sky-900/30',
    glow: 'rgba(14,165,233,0.15)',
    dot: 'bg-sky-500',
  },
  Associate: {
    badge: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    accent: 'from-emerald-900/30',
    glow: 'rgba(16,185,129,0.15)',
    dot: 'bg-emerald-500',
  },
  Professional: {
    badge: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
    accent: 'from-violet-900/30',
    glow: 'rgba(139,92,246,0.15)',
    dot: 'bg-violet-500',
  },
  Specialty: {
    badge: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
    accent: 'from-amber-900/30',
    glow: 'rgba(245,158,11,0.15)',
    dot: 'bg-amber-500',
  },
};

const ALL_CERTS = [
  {
    slug: 'clf-c02',
    code: 'CLF-C02',
    title: 'AWS Certified Cloud Practitioner',
    level: 'Foundational',
    description:
      'Foundational cloud fluency across AWS services, billing, security, and global infrastructure.',
    longDescription:
      'Build foundational knowledge of cloud concepts and core AWS services. This entry-level certification is ideal for anyone beginning their AWS journey, covering cloud models, AWS services, pricing, SLAs, security, and global infrastructure.',
    topics: ['Cloud Concepts', 'AWS Services', 'Billing & Pricing', 'Security & Compliance'],
    hours: 10,
    prepTime: '~4 weeks',
    successRate: '82%',
    learnUrl: 'https://aws.amazon.com/certification/certified-cloud-practitioner/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=cloud+practitioner+practice',
    microcredentialUrl: null,
    modules: [
      {
        title: 'Cloud Concepts',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials',
      },
      {
        title: 'AWS Core Services Overview',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials',
      },
      {
        title: 'Security & the Shared Responsibility Model',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials',
      },
      {
        title: 'Billing, Pricing & Support Plans',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials',
      },
    ],
    prerequisites: 'No prerequisites — recommended for beginners.',
    nextCerts: ['saa-c03', 'aif-c01'],
  },
  {
    slug: 'aif-c01',
    code: 'AIF-C01',
    title: 'AWS Certified AI Practitioner',
    level: 'Foundational',
    description: 'Understand generative AI, responsible AI, and core ML concepts on AWS.',
    longDescription:
      'Validate foundational knowledge of artificial intelligence, machine learning, and generative AI concepts and how they are applied using AWS services. Ideal for non-technical roles beginning their AI journey.',
    topics: ['Generative AI', 'Responsible AI', 'ML Basics', 'AWS AI Services'],
    hours: 15,
    prepTime: '~6 weeks',
    successRate: '78%',
    learnUrl: 'https://aws.amazon.com/certification/certified-ai-practitioner/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/ai-practitioner-01/ai-practitioner-01.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=ai+practitioner+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'Introduction to Artificial Intelligence',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/19434/introduction-to-artificial-intelligence',
      },
      {
        title: 'Generative AI Essentials',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/17432/generative-ai-with-large-language-models',
      },
      {
        title: 'Responsible AI on AWS',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/18404/responsible-ai',
      },
      {
        title: 'AWS AI & ML Services Overview',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9459/amazon-sagemaker-getting-started',
      },
    ],
    prerequisites: 'No prerequisites. CLF-C02 recommended but not required.',
    nextCerts: ['mla-c01', 'aip-c01'],
  },
  {
    slug: 'saa-c03',
    code: 'SAA-C03',
    title: 'AWS Certified Solutions Architect – Associate',
    level: 'Associate',
    description:
      'Design scalable, resilient, and cost-efficient architectures using core AWS services.',
    longDescription:
      'Validate your ability to design and implement scalable, highly available, and cost-efficient solutions on AWS. This is the most widely recognized AWS Associate certification, covering compute, storage, databases, networking, security, and architecture best practices.',
    topics: [
      'EC2 & Compute',
      'S3 & Storage',
      'VPC & Networking',
      'IAM & Security',
      'RDS & Databases',
      'CloudFormation',
    ],
    hours: 40,
    prepTime: '~3 months',
    successRate: '74%',
    learnUrl: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/solutions-architect-associate-03/solutions-architect-associate-03.html',
    practiceUrl:
      'https://skillbuilder.aws/search?searchText=solutions+architect+associate+practice',
    microcredentialUrl: null,
    modules: [
      {
        title: 'Designing Resilient Architectures',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-solutions-architect-associate-official-practice-question-set',
      },
      {
        title: 'High-Performing Architectures',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-solutions-architect-associate-official-practice-question-set',
      },
      {
        title: 'Secure Applications & Architectures',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-solutions-architect-associate-official-practice-question-set',
      },
      {
        title: 'Cost-Optimized Architectures',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-solutions-architect-associate-official-practice-question-set',
      },
    ],
    prerequisites: 'CLF-C02 recommended. 1+ year of hands-on AWS experience.',
    nextCerts: ['sap-c02', 'dop-c02', 'scs-c02'],
  },
  {
    slug: 'soa-c02',
    code: 'SOA-C02',
    title: 'AWS Certified CloudOps Engineer – Associate',
    level: 'Associate',
    description:
      'Deploy, manage, and operate scalable systems on AWS with a focus on monitoring and automation.',
    longDescription:
      'Validate your ability to deploy, manage, and operate workloads on AWS. Covers monitoring, automation, storage, security, and operational best practices for cloud engineers who manage and operate AWS environments.',
    topics: [
      'Monitoring & Observability',
      'Automation',
      'Storage',
      'Networking',
      'Security & Compliance',
    ],
    hours: 35,
    prepTime: '~3 months',
    successRate: '72%',
    learnUrl: 'https://aws.amazon.com/certification/certified-cloudops-engineer-associate/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/sysops-administrator-associate-03/sysops-administrator-associate-03.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=cloudops+engineer+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'Monitoring, Logging & Remediation',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9534/exam-prep-aws-certified-sysops-administrator-associate',
      },
      {
        title: 'Reliability & Business Continuity',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9534/exam-prep-aws-certified-sysops-administrator-associate',
      },
      {
        title: 'Deployment, Provisioning & Automation',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9534/exam-prep-aws-certified-sysops-administrator-associate',
      },
      {
        title: 'Security & Compliance',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9534/exam-prep-aws-certified-sysops-administrator-associate',
      },
    ],
    prerequisites: 'SAA-C03 recommended. 1+ year of AWS operations experience.',
    nextCerts: ['dop-c02'],
  },
  {
    slug: 'dva-c02',
    code: 'DVA-C02',
    title: 'AWS Certified Developer – Associate',
    level: 'Associate',
    description:
      'Develop and maintain applications on AWS with a focus on serverless and CI/CD patterns.',
    longDescription:
      'Validate your ability to develop, deploy, debug, and optimize cloud-native applications on AWS. Covers serverless architectures, CI/CD pipelines, DynamoDB, API Gateway, Lambda, and AWS SDKs.',
    topics: ['Lambda & Serverless', 'API Gateway', 'DynamoDB', 'CodePipeline & CI/CD', 'SDK & CLI'],
    hours: 40,
    prepTime: '~3 months',
    successRate: '73%',
    learnUrl: 'https://aws.amazon.com/certification/certified-developer-associate/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/developer-associate-02/developer-associate-02.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=developer+associate+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'Development with AWS Services',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9543/exam-prep-aws-certified-developer-associate',
      },
      {
        title: 'Security & Authentication',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9543/exam-prep-aws-certified-developer-associate',
      },
      {
        title: 'Deployment & CI/CD',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9543/exam-prep-aws-certified-developer-associate',
      },
      {
        title: 'Troubleshooting & Optimization',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9543/exam-prep-aws-certified-developer-associate',
      },
    ],
    prerequisites: 'CLF-C02 recommended. 1+ year of development experience on AWS.',
    nextCerts: ['sap-c02', 'dop-c02'],
  },
  {
    slug: 'dea-c01',
    code: 'DEA-C01',
    title: 'AWS Certified Data Engineer – Associate',
    level: 'Associate',
    description: 'Design, build, and maintain data pipelines and data architecture on AWS.',
    longDescription:
      'Validate your expertise in designing, building, and maintaining data pipelines and data architecture on AWS using services like Glue, Kinesis, Redshift, and Lake Formation. Covers data ingestion, transformation, orchestration, and security.',
    topics: ['AWS Glue', 'Amazon Kinesis', 'Amazon Redshift', 'Lake Formation', 'Data Security'],
    hours: 40,
    prepTime: '~3 months',
    successRate: '70%',
    learnUrl: 'https://aws.amazon.com/certification/certified-data-engineer-associate/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/data-engineer-associate-01/data-engineer-associate-01.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=data+engineer+associate+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'Data Ingestion & Transformation',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/18924/exam-prep-aws-certified-data-engineer-associate',
      },
      {
        title: 'Data Store Management',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/18924/exam-prep-aws-certified-data-engineer-associate',
      },
      {
        title: 'Data Operations & Support',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/18924/exam-prep-aws-certified-data-engineer-associate',
      },
      {
        title: 'Data Security & Governance',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/18924/exam-prep-aws-certified-data-engineer-associate',
      },
    ],
    prerequisites: 'CLF-C02 recommended. Experience with data engineering concepts and SQL.',
    nextCerts: ['sap-c02'],
  },
  {
    slug: 'mla-c01',
    code: 'MLA-C01',
    title: 'AWS Certified Machine Learning Engineer – Associate',
    level: 'Associate',
    description:
      'Implement ML solutions on AWS including model deployment, automation, and MLOps practices.',
    longDescription:
      'Validate your ability to implement, operationalize, and maintain ML solutions on AWS. Covers SageMaker, model deployment, MLOps pipelines, automation, and monitoring of production ML workloads.',
    topics: ['Amazon SageMaker', 'MLOps', 'Model Deployment', 'Automation', 'Monitoring'],
    hours: 40,
    prepTime: '~3 months',
    successRate: '71%',
    learnUrl: 'https://aws.amazon.com/certification/certified-machine-learning-engineer-associate/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/machine-learning-engineer-associate-01/machine-learning-engineer-associate-01.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=machine+learning+engineer+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'Data Preparation for ML',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-machine-learning-specialty-exam-prep',
      },
      {
        title: 'Model Development & Training',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-machine-learning-specialty-exam-prep',
      },
      {
        title: 'Model Deployment & Inference',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-machine-learning-specialty-exam-prep',
      },
      {
        title: 'MLOps & Monitoring',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9541/aws-certified-machine-learning-specialty-exam-prep',
      },
    ],
    prerequisites: 'AIF-C01 recommended. Experience with ML concepts and Python.',
    nextCerts: [],
  },
  {
    slug: 'aip-c01',
    code: 'AIP-C01',
    title: 'AWS Certified Generative AI Developer – Professional',
    level: 'Professional',
    description:
      'Design, build, and optimize generative AI solutions using Amazon Bedrock and AWS AI services.',
    longDescription:
      'Validate your expertise in designing, building, and optimizing generative AI solutions using Amazon Bedrock and related AWS AI services. Covers foundation model selection, RAG architectures, agents, guardrails, responsible AI, and performance optimization for production generative AI workloads.',
    topics: [
      'Amazon Bedrock',
      'Foundation Models',
      'RAG Architectures',
      'Bedrock Agents',
      'Guardrails & Responsible AI',
    ],
    hours: 40,
    prepTime: '~3 months',
    successRate: null,
    learnUrl:
      'https://aws.amazon.com/certification/certified-generative-ai-developer-professional/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/ai-professional-01/ai-professional-01.html',
    practiceUrl:
      'https://skillbuilder.aws/search?searchText=generative+ai+developer+professional+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'Getting Started with Amazon Bedrock',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/17447/amazon-bedrock-getting-started',
      },
      {
        title: 'Building Generative AI Applications with Amazon Bedrock',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/17897/building-generative-ai-applications-using-amazon-bedrock',
      },
      {
        title: 'Designing RAG & Agent Architectures',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/17897/building-generative-ai-applications-using-amazon-bedrock',
      },
      {
        title: 'Responsible AI & Guardrails on Bedrock',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/18404/responsible-ai',
      },
    ],
    prerequisites:
      'AIF-C01 recommended. Experience with AWS AI services and application development.',
    nextCerts: [],
  },
  {
    slug: 'sap-c02',
    code: 'SAP-C02',
    title: 'AWS Certified Solutions Architect – Professional',
    level: 'Professional',
    description:
      'Advanced design of complex, multi-region, hybrid, and cost-optimized AWS architectures.',
    longDescription:
      'Validate advanced subject matter expertise in designing cost-effective, highly available, and secure AWS solutions at enterprise scale. Covers multi-account strategies, hybrid architectures, migrations, and complex networking.',
    topics: [
      'Multi-Region Design',
      'Hybrid Architectures',
      'Migration Strategy',
      'Cost Optimization',
      'Advanced Networking',
    ],
    hours: 60,
    prepTime: '~6 months',
    successRate: '68%',
    learnUrl: 'https://aws.amazon.com/certification/certified-solutions-architect-professional/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/solutions-architect-professional-02/solutions-architect-professional-02.html',
    practiceUrl:
      'https://skillbuilder.aws/search?searchText=solutions+architect+professional+practice',
    microcredentialUrl: null,
    modules: [
      {
        title: 'Organizational Complexity & Migrations',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9542/exam-prep-aws-certified-solutions-architect-professional',
      },
      {
        title: 'New Solutions Design',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9542/exam-prep-aws-certified-solutions-architect-professional',
      },
      {
        title: 'Continuous Improvement',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9542/exam-prep-aws-certified-solutions-architect-professional',
      },
      {
        title: 'Workload Acceleration',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9542/exam-prep-aws-certified-solutions-architect-professional',
      },
    ],
    prerequisites: 'SAA-C03 required. 2+ years of hands-on AWS architecture experience.',
    nextCerts: [],
  },
  {
    slug: 'dop-c02',
    code: 'DOP-C02',
    title: 'AWS Certified DevOps Engineer – Professional',
    level: 'Professional',
    description: 'Implement and manage continuous delivery systems and methodologies on AWS.',
    longDescription:
      'Validate advanced expertise in provisioning, operating, and managing distributed application systems on AWS. Covers CI/CD pipelines, infrastructure as code, monitoring, incident management, and security automation.',
    topics: [
      'CI/CD Pipelines',
      'Infrastructure as Code',
      'Monitoring & Logging',
      'Incident Response',
      'Security Automation',
    ],
    hours: 55,
    prepTime: '~5 months',
    successRate: '67%',
    learnUrl: 'https://aws.amazon.com/certification/certified-devops-engineer-professional/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/devops-engineer-professional-02/devops-engineer-professional-02.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=devops+engineer+professional+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'SDLC Automation',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9544/exam-prep-aws-certified-devops-engineer-professional',
      },
      {
        title: 'Configuration Management & IaC',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9544/exam-prep-aws-certified-devops-engineer-professional',
      },
      {
        title: 'Resilient Cloud Solutions',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9544/exam-prep-aws-certified-devops-engineer-professional',
      },
      {
        title: 'Monitoring & Logging',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9544/exam-prep-aws-certified-devops-engineer-professional',
      },
    ],
    prerequisites: 'DVA-C02 or SOA-C02 required. 2+ years of DevOps experience on AWS.',
    nextCerts: [],
  },
  {
    slug: 'scs-c02',
    code: 'SCS-C02',
    title: 'AWS Certified Security – Specialty',
    level: 'Specialty',
    description:
      'Secure AWS workloads with advanced IAM, encryption, and threat detection services.',
    longDescription:
      'Validate your expertise in securing AWS workloads and infrastructure. Covers advanced IAM strategies, data encryption, incident response, infrastructure security, and threat detection using GuardDuty, Macie, and Security Hub.',
    topics: [
      'IAM & Identity',
      'KMS & Encryption',
      'GuardDuty & Threat Detection',
      'Macie & Data Security',
      'Security Hub',
    ],
    hours: 45,
    prepTime: '~4 months',
    successRate: '70%',
    learnUrl: 'https://aws.amazon.com/certification/certified-security-specialty/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/security-specialty-03/security-specialty-03.html',
    practiceUrl: 'https://skillbuilder.aws/search?searchText=security+specialty+practice',
    microcredentialUrl: 'https://skillbuilder.aws/category/type/microcredentials',
    modules: [
      {
        title: 'Threat Detection & Incident Response',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9545/exam-prep-aws-certified-security-specialty',
      },
      {
        title: 'Security Logging & Monitoring',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9545/exam-prep-aws-certified-security-specialty',
      },
      {
        title: 'Infrastructure Security',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9545/exam-prep-aws-certified-security-specialty',
      },
      {
        title: 'Identity & Access Management',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9545/exam-prep-aws-certified-security-specialty',
      },
    ],
    prerequisites: 'SAA-C03 recommended. 5+ years of IT security experience, 2+ years on AWS.',
    nextCerts: ['sap-c02'],
  },
  {
    slug: 'ans-c01',
    code: 'ANS-C01',
    title: 'AWS Certified Advanced Networking – Specialty',
    level: 'Specialty',
    description:
      'Design and implement complex AWS networking architectures including hybrid connectivity.',
    longDescription:
      'Validate your expertise in designing and implementing AWS and hybrid IT network architectures at scale. Covers VPC design, Direct Connect, Transit Gateway, hybrid connectivity, DNS, and network security.',
    topics: [
      'VPC Design',
      'Direct Connect',
      'Transit Gateway',
      'Route 53 & DNS',
      'Network Security',
    ],
    hours: 45,
    prepTime: '~4 months',
    successRate: '69%',
    learnUrl: 'https://aws.amazon.com/certification/certified-advanced-networking-specialty/',
    studyGuideUrl:
      'https://docs.aws.amazon.com/aws-certification/latest/advanced-networking-specialty-01/advanced-networking-specialty-01.html',
    practiceUrl:
      'https://skillbuilder.aws/search?searchText=advanced+networking+specialty+practice',
    microcredentialUrl: null,
    modules: [
      {
        title: 'Network Design & Implementation',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9546/exam-prep-aws-certified-advanced-networking-specialty',
      },
      {
        title: 'Network Security & Compliance',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9546/exam-prep-aws-certified-advanced-networking-specialty',
      },
      {
        title: 'Network Management & Troubleshooting',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9546/exam-prep-aws-certified-advanced-networking-specialty',
      },
      {
        title: 'Hybrid Network Design',
        url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/9546/exam-prep-aws-certified-advanced-networking-specialty',
      },
    ],
    prerequisites: 'SAA-C03 recommended. 5+ years of networking experience.',
    nextCerts: ['sap-c02'],
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function AWSCertDetailPage() {
  const { certSlug } = useParams();
  const cert = ALL_CERTS.find((c) => c.slug === certSlug);

  if (!cert) {
    return (
      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        <div className="text-center py-20">
          <span className="text-amber-400 text-[64px] material-symbols-outlined mb-4 block">
            search_off
          </span>
          <h1 className="text-3xl font-bold text-white mb-4">Certification Not Found</h1>
          <p className="text-foreground mb-8">
            The certification <code className="font-mono text-amber-400">{certSlug}</code> was not
            found.
          </p>
          <Link
            to={routes.education('aws')}
            className="px-6 h-11 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to AWS Education
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
          {cert.code}: {cert.title} | AWS Education | HCW
        </title>
        <meta name="description" content={cert.description} />
        <meta property="og:title" content={`${cert.code}: ${cert.title}`} />
        <meta property="og:description" content={cert.longDescription} />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-foreground/60 mb-8">
          <Link to={routes.education('aws')} className="hover:text-amber-400 transition-colors">
            AWS Education
          </Link>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-foreground">{cert.code}</span>
        </nav>

        {/* Hero */}
        <section
          className={`mb-10 bg-gradient-to-br ${meta.accent} to-card/20 backdrop-blur-md border border-card/40 rounded-2xl p-8 relative overflow-hidden`}
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
                <div className="text-2xl font-bold text-amber-400">{cert.hours}h</div>
              </div>
              <div>
                <div className="text-foreground/60 mb-0.5">Prep Time</div>
                <div className="text-2xl font-bold text-white">{cert.prepTime}</div>
              </div>
              {cert.successRate && (
                <div>
                  <div className="text-foreground/60 mb-0.5">Avg. Pass Rate</div>
                  <div className="text-2xl font-bold text-amber-300">{cert.successRate}</div>
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
                <span className="text-amber-400 material-symbols-outlined text-[20px]">
                  category
                </span>
                Topics Covered
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {cert.topics.map((topic, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-card/50 rounded-xl px-3 py-2.5"
                  >
                    <span className="text-amber-400 material-symbols-outlined text-[16px]">
                      check_circle
                    </span>
                    <span className="text-foreground text-sm">{topic}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Skill Builder Modules */}
            <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-amber-400 material-symbols-outlined text-[20px]">
                  menu_book
                </span>
                AWS Skill Builder Modules
              </h2>
              <div className="space-y-3">
                {cert.modules.map((mod, i) => (
                  <a
                    key={i}
                    href={mod.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 group bg-card/40 hover:bg-card/60 border border-card/30 hover:border-amber-400/30 rounded-xl px-4 py-3 transition-all"
                  >
                    <span className="flex-shrink-0 w-6 h-6 bg-amber-500/20 rounded-full flex items-center justify-center text-xs font-bold text-amber-400">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground group-hover:text-amber-300 transition-colors flex-1">
                      {mod.title}
                    </span>
                    <span className="material-symbols-outlined text-[14px] text-foreground/40 group-hover:text-amber-400 transition-colors shrink-0">
                      open_in_new
                    </span>
                  </a>
                ))}
              </div>
            </section>

            {/* Microcredentials */}
            {cert.microcredentialUrl && (
              <section className="bg-card/40 backdrop-blur-md border border-amber-500/20 rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                  <span className="text-amber-400 material-symbols-outlined text-[20px]">
                    verified
                  </span>
                  AWS Microcredentials
                </h2>
                <p className="text-sm text-foreground/70 mb-4">
                  Focused, skill-specific credentials on Skill Builder that complement this
                  certification with hands-on proof of competency.
                </p>
                <a
                  href={cert.microcredentialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 h-10 px-5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 font-semibold rounded-lg transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  Browse Related Microcredentials
                </a>
              </section>
            )}

            {/* What's Next */}
            {nextCerts.length > 0 && (
              <section className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <span className="text-amber-400 material-symbols-outlined text-[20px]">
                    trending_up
                  </span>
                  What to Study Next
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {nextCerts.map((next) => (
                    <Link
                      key={next.slug}
                      to={getProviderPath('aws', `education/${next.slug}`)}
                      className="group flex items-center gap-3 bg-card/40 hover:bg-card/60 border border-card/30 hover:border-amber-400/30 rounded-xl px-4 py-3 transition-all"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${LEVEL_META[next.level]?.dot}`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-foreground/50">{next.code}</div>
                        <div className="text-sm font-semibold text-foreground group-hover:text-amber-300 transition-colors line-clamp-1">
                          {next.title.replace(/AWS Certified\s+/i, '')}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-[16px] text-foreground/40 group-hover:text-amber-400 transition-colors ml-auto shrink-0">
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
                className="flex items-center justify-center gap-2 w-full h-11 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                View on AWS Certification
              </a>
              {cert.studyGuideUrl && (
                <a
                  href={cert.studyGuideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full h-11 bg-card/50 hover:bg-card/70 text-foreground font-semibold rounded-lg transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">description</span>
                  Official Exam Guide
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
                  Practice Questions
                </a>
              )}
            </div>

            {/* Prerequisites */}
            <div className="bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl p-6">
              <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 material-symbols-outlined text-[18px]">info</span>
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
                  <span className="font-mono font-bold text-amber-400">{cert.code}</span>
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
                    <span className="font-bold text-amber-300">{cert.successRate}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-foreground/60">Skill Builder Modules</span>
                  <span className="font-bold text-white">{cert.modules.length}</span>
                </div>
              </div>
            </div>

            <Link
              to={routes.education('aws')}
              className="flex items-center gap-2 text-sm text-foreground/60 hover:text-amber-400 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to AWS Education
            </Link>
          </aside>
        </div>
      </main>
    </>
  );
}
