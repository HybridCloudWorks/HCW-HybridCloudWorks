/**
 * vmware education data.
 *
 * Extracted from src/pages/vmware/EducationPage.jsx when that page moved onto the
 * shared EducationTemplate.
 *
 * Certification catalogue verified 2026-09-09 (#461) against Broadcom's VMware
 * certification pages and exam guides:
 *   VCP-VVF Administrator 2V0-16.25, VCP-VCF Administrator 2V0-17.25 and
 *   VCP-VCF Architect 2V0-13.25 (Broadcom certification pages);
 *   VCAP-VCF Administrator 3V0-11.26, Architect 3V0-12.26 and Support
 *   3V0-13.26 — the role-based VCAPs whose exam guides Broadcom dated
 *   August 18, 2026 — replace the VCAP-DCV Deploy entry this file used to
 *   carry, which no longer appears on Broadcom's certification path.
 *   VCTA-DCV is the Data Center Virtualization track named in Broadcom's
 *   VCTA FAQ; Broadcom publishes no per-track VCTA page today.
 *
 * `status` and any dates are read through `@/lib/certStatus` at render time;
 * `src/data/education-catalogues.test.js` fails when a dated row is past.
 */
export const DATA_AS_OF = '2026-09-09';

export const DATA_SOURCE = {
  label: 'Broadcom VMware certification',
  url: 'https://www.broadcom.com/support/education/vmware/certification',
};

export const levelMeta = {
  Foundational: {
    badge: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
    accent: 'border-l-sky-500',
    dot: 'bg-sky-500',
    label: 'Foundational',
  },
  Professional: {
    badge: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    accent: 'border-l-emerald-500',
    dot: 'bg-emerald-500',
    label: 'Professional',
  },
  Advanced: {
    badge: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
    accent: 'border-l-violet-500',
    dot: 'bg-violet-500',
    label: 'Advanced',
  },
};

export const filterLevels = ['All', 'Foundational', 'Professional', 'Advanced'];

export const certifications = [
  {
    id: 'vcta-dcv',
    slug: 'vcta-dcv',
    code: 'VCTA-DCV',
    title: 'VMware Certified Technical Associate – Data Center Virtualization',
    level: 'Foundational',
    status: 'active',
    description:
      'Demonstrate basic knowledge of virtualization concepts, vSphere navigation, basic VM administration, and troubleshooting.',
    topics: ['vSphere Basics', 'VM Management', 'Storage & Network Intro', 'Troubleshooting'],
    hours: 15,
    prepTime: '~4 weeks',
    featured: false,
    learnUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    id: 'vcp-vvf',
    slug: 'vcp-vvf',
    code: 'VCP-VVF',
    examCode: '2V0-16.25',
    title: 'VMware Certified Professional – vSphere Foundation Administrator',
    level: 'Professional',
    status: 'active',
    description:
      'Deploy, manage, and support private cloud environments built on VMware vSphere Foundation — vSphere, vSAN and VCF Operations without the full Cloud Foundation stack.',
    topics: ['vSphere', 'vSAN', 'VCF Operations', 'Lifecycle'],
    hours: 35,
    prepTime: '~3 months',
    featured: false,
    learnUrl:
      'https://www.broadcom.com/support/education/vmware/certification/vcp-vvf-administrator',
  },
  {
    id: 'vcp-vcf',
    slug: 'vcp-vcf',
    code: 'VCP-VCF',
    examCode: '2V0-17.25',
    title: 'VMware Certified Professional – VMware Cloud Foundation Administrator',
    level: 'Professional',
    status: 'active',
    description:
      'Validate expertise in configure, deploy, manage, and scale a software-defined data center using VMware Cloud Foundation.',
    topics: ['vSphere SDDC', 'vSAN Integration', 'NSX Networking', 'SDDC Manager'],
    hours: 40,
    prepTime: '~3 months',
    featured: true,
    learnUrl:
      'https://www.broadcom.com/support/education/vmware/certification/vcp-vcf-administrator',
  },
  {
    id: 'vcp-vcf-arch',
    slug: 'vcp-vcf-arch',
    code: 'VCP-VCF-ARCH',
    examCode: '2V0-13.25',
    title: 'VMware Certified Professional – VMware Cloud Foundation Architect',
    level: 'Professional',
    status: 'active',
    description:
      'Demonstrate architect-level knowledge designing secure, robust, and highly available multi-site VMware Cloud Foundation topologies.',
    topics: ['Topologies Design', 'Capacity Planning', 'Availability', 'Multi-Region VCF'],
    hours: 45,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://www.broadcom.com/support/education/vmware/certification/vcp-vcf-architect',
  },
  {
    id: 'vcap-vcf-admin',
    slug: 'vcap-vcf-admin',
    code: 'VCAP-VCF-ADMIN',
    examCode: '3V0-11.26',
    title: 'VMware Certified Advanced Professional – VMware Cloud Foundation Administrator',
    level: 'Advanced',
    status: 'active',
    description:
      'Manage, maintain, and scale multi-region VCF 9 private clouds — lifecycle management, workload domains, VCF Automation and Operations, NSX VPCs, and vSphere Kubernetes Service.',
    topics: ['VCF 9 Operations', 'VCF Automation', 'NSX VPCs', 'VKS'],
    hours: 60,
    prepTime: '~6 months',
    featured: false,
    learnUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    id: 'vcap-vcf-arch',
    slug: 'vcap-vcf-arch',
    code: 'VCAP-VCF-ARCH',
    examCode: '3V0-12.26',
    title: 'VMware Certified Advanced Professional – VMware Cloud Foundation Architect',
    level: 'Advanced',
    status: 'active',
    description:
      'Architect scalable, resilient VCF 9 private cloud infrastructures that align with business requirements — design, strategic planning, and multi-site topologies.',
    topics: ['VCF 9 Design', 'Requirements', 'Resilience', 'Multi-Site'],
    hours: 60,
    prepTime: '~6 months',
    featured: false,
    learnUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    id: 'vcap-vcf-support',
    slug: 'vcap-vcf-support',
    code: 'VCAP-VCF-SUPPORT',
    examCode: '3V0-13.26',
    title: 'VMware Certified Advanced Professional – VMware Cloud Foundation Support',
    level: 'Advanced',
    status: 'active',
    description:
      'Troubleshoot and maintain VCF 9 platforms — hands-on diagnostics, performance optimization, and root cause analysis across the stack.',
    topics: ['Troubleshooting', 'Performance', 'Root Cause Analysis', 'VCF 9'],
    hours: 60,
    prepTime: '~6 months',
    featured: false,
    learnUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
];

export const learningPaths = [
  {
    id: 0,
    certCode: 'VCTA-DCV',
    title: 'Virtualization Foundations Path',
    level: 'Beginner',
    hours: 15,
    description:
      'Learn the fundamentals of server virtualization, vSphere administration basics, and hosting virtual machines.',
    modules: [
      { title: 'Intro to Virtualization' },
      { title: 'vSphere Architecture Overview' },
      { title: 'Basic VM Management' },
      { title: 'Troubleshooting Common Issues' },
    ],
    certUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    id: 1,
    certCode: 'VCP-VCF',
    title: 'VCF Administrator Path',
    level: 'Intermediate',
    hours: 40,
    description:
      'Master enterprise software-defined data center orchestration using VMware Cloud Foundation (VCF) and SDDC Manager.',
    modules: [
      { title: 'SDDC & Cloud Architecture' },
      { title: 'vSphere & vSAN Deployment' },
      { title: 'NSX-T Networking Foundations' },
      { title: 'SDDC Manager Lifecycle Operations' },
    ],
    certUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    id: 2,
    certCode: 'VCAP-VCF-ADMIN',
    title: 'Advanced VCF Operations Path',
    level: 'Advanced',
    hours: 60,
    description:
      'Deep dive into VCF 9 day-2 operations — fleet lifecycle, VCF Automation and Operations, NSX VPCs with stateful services, and the vSphere Supervisor with VKS.',
    modules: [
      { title: 'Fleet Lifecycle & Workload Domains' },
      { title: 'VCF Automation: Providers, Projects, Blueprints' },
      { title: 'NSX VPCs & Stateful Gateway Services' },
      { title: 'vSphere Supervisor & VKS at Scale' },
    ],
    certUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
];

export const resources = [
  {
    id: 'broadcom-support',
    title: 'Broadcom Support Portal',
    description:
      'Official portal for VMware license management, support tickets, product downloads, and knowledge base.',
    type: 'Documentation',
    icon: 'description',
    url: 'https://support.broadcom.com/',
  },
  {
    id: 'vmware-customer-connect',
    title: 'VMware Customer Connect',
    description:
      'Official VMware digital learning platform, product documentation, community forums, and training transcripts.',
    type: 'Learning Platform',
    icon: 'school',
    url: 'https://customerconnect.vmware.com/',
  },
  {
    id: 'vmware-hol',
    title: 'VMware Hands-on Labs',
    description:
      'Free, web-based sandbox environments that allow testing and exploring VMware products without installation.',
    type: 'Labs',
    icon: 'science',
    url: 'https://hol.vmware.com/',
  },
  {
    id: 'vmware-press',
    title: 'VMware Press Books',
    description:
      'Official certification guides, best practice blueprints, and technical books from leading VMware architects.',
    type: 'Guides',
    icon: 'menu_book',
    url: 'https://www.vmwarepress.com/',
  },
  {
    id: 'vcf-docs',
    title: 'VCF Product Docs',
    description:
      'Technical product documentation for SDDC Manager, VMware Cloud Foundation, vSphere, and vSAN components.',
    type: 'Documentation',
    icon: 'article',
    url: 'https://docs.vmware.com/en/VMware-Cloud-Foundation/index.html',
  },
  {
    id: 'vmware-explore',
    title: 'VMware Explore Videos',
    description:
      'Sessions, deep dives, announcements, and customer case studies on-demand from the annual VMware Explore conference.',
    type: 'Video',
    icon: 'play_circle',
    url: 'https://www.vmware.com/explore.html',
  },
];
