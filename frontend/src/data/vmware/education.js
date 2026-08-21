/**
 * vmware education data.
 *
 * Extracted from src/pages/vmware/EducationPage.jsx when that page moved onto the
 * shared EducationTemplate.
 */
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
    id: 'vcp-vcf',
    slug: 'vcp-vcf',
    code: 'VCP-VCF',
    title: 'VMware Certified Professional – Cloud Foundation Administrator',
    level: 'Professional',
    status: 'active',
    description:
      'Validate expertise in configure, deploy, manage, and scale a software-defined data center using VMware Cloud Foundation.',
    topics: ['vSphere SDDC', 'vSAN Integration', 'NSX Networking', 'SDDC Manager'],
    hours: 40,
    prepTime: '~3 months',
    featured: true,
    learnUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    id: 'vcp-vcf-arch',
    slug: 'vcp-vcf-arch',
    code: 'VCP-VCF-ARCH',
    title: 'VMware Certified Professional – Cloud Foundation Architect',
    level: 'Professional',
    status: 'active',
    description:
      'Demonstrate architect-level knowledge designing secure, robust, and highly available multi-site VMware Cloud Foundation topologies.',
    topics: ['Topologies Design', 'Capacity Planning', 'Availability', 'Multi-Region VCF'],
    hours: 45,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://www.broadcom.com/support/education/vmware/certification',
  },
  {
    id: 'vcap-dcv-deploy',
    slug: 'vcap-dcv-deploy',
    code: 'VCAP-DCV',
    title: 'VMware Certified Advanced Professional – Data Center Virtualization Deploy',
    level: 'Advanced',
    status: 'active',
    description:
      'Show advanced hands-on competence in deploying, optimizing, and operating complex enterprise-scale VMware vSphere environments.',
    topics: ['vSphere Advanced', 'ESXi Command CLI', 'High Availability', 'DRS Tuning'],
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
    certCode: 'VCAP-DCV',
    title: 'Advanced Data Center Engineering Path',
    level: 'Advanced',
    hours: 60,
    description:
      'Deep dive into advanced vSphere command line operations, high availability engineering, and complex storage arrays.',
    modules: [
      { title: 'ESXi Advanced Shell CLI' },
      { title: 'Distributed Resource Scheduler Customization' },
      { title: 'vSphere HA Cluster Fine-Tuning' },
      { title: 'Advanced Storage Multipathing' },
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
