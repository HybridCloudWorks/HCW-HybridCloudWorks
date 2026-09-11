/**
 * HashiCorp certification catalogue for /terraform/education (#461).
 *
 * Verified 2026-09-09 against https://developer.hashicorp.com/certifications,
 * which lists exactly four credentials: Terraform Associate (004), Terraform
 * Authoring and Operations Advanced, Vault Associate (003) and Vault
 * Operations Advanced. Terraform Associate 003 was replaced by 004 on
 * 2026-01-08; the Consul Associate exam was retired on 2026-07-15 and no
 * longer appears in HashiCorp's catalogue, so it is kept here only as a
 * retired row.
 *
 * The `code` values (TA-004, TV-003, TA-ADV, TV-ADV) are this page's own
 * short labels — HashiCorp names exams by product and version, not by code.
 *
 * RE-VERIFIED 2026-09-10 (#469) against https://developer.hashicorp.com/certifications
 * and both product tracks under it. Nothing changed. The index still lists
 * exactly the same four, and the two track pages still name the same exam
 * versions — Terraform Associate (004) tests Terraform 1.12, Terraform
 * Authoring and Operations Advanced tests 1.6, Vault Associate (003) tests
 * Vault 1.19, Vault Operations Advanced tests Vault 1.16. All four are valid
 * two years.
 *   https://developer.hashicorp.com/certifications/infrastructure-automation
 *   https://developer.hashicorp.com/certifications/security-automation
 *
 * The IBM acquisition has not consolidated or renamed anything visible here:
 * HashiCorp's catalogue is still published under its own name at the URL
 * above, and the only IBM branding found in this pass was on the HashiConf at
 * IBM TechXchange 2026 onsite-testing notice, which is an exam venue rather
 * than a change to the exams. Consul Associate's retirement still reads
 * 2026-07-15 (last day to schedule 2026-07-13), and no successor has appeared.
 *
 * `status` and any dates are read through `@/lib/certStatus` at render time;
 * `src/data/education-catalogues.test.js` fails when a dated row is past.
 */
export const DATA_AS_OF = '2026-09-10';

export const DATA_SOURCE = {
  label: 'HashiCorp certifications',
  url: 'https://developer.hashicorp.com/certifications',
};

export const certifications = [
  {
    id: 'ta-004',
    slug: 'ta-004',
    code: 'TA-004',
    title: 'HashiCorp Certified: Terraform Associate (004)',
    level: 'Associate',
    status: 'active',
    description:
      'Validate knowledge of infrastructure as code concepts and Terraform using HCL, state, providers, modules, variables, workspaces and HCP Terraform.',
    topics: ['HCL', 'State', 'Providers', 'Modules', 'Variables', 'HCP Terraform'],
    hours: 25,
    prepTime: '~6 weeks',
    featured: true,
    learnUrl: 'https://developer.hashicorp.com/certifications/infrastructure-automation',
  },
  {
    id: 'ta-adv',
    slug: 'ta-adv',
    code: 'TA-ADV',
    title: 'HashiCorp Certified: Terraform Authoring and Operations Advanced',
    level: 'Advanced',
    status: 'active',
    description:
      'Lab-based and multiple-choice assessment of authoring reusable Terraform, operating it in production, and running HCP Terraform workflows at scale.',
    topics: ['Module Authoring', 'Operations', 'HCP Terraform', 'Hands-on Labs'],
    hours: 60,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://developer.hashicorp.com/certifications/infrastructure-automation',
  },
  {
    id: 'tv-003',
    slug: 'tv-003',
    code: 'TV-003',
    title: 'HashiCorp Certified: Vault Associate (003)',
    level: 'Associate',
    status: 'active',
    description:
      'Demonstrate knowledge of HashiCorp Vault for secrets management, auth methods, policies, and dynamic secret generation.',
    topics: ['Secrets Management', 'Auth Methods', 'Policies', 'Dynamic Secrets'],
    hours: 25,
    prepTime: '~6 weeks',
    featured: false,
    learnUrl: 'https://developer.hashicorp.com/certifications/security-automation',
  },
  {
    id: 'tv-adv',
    slug: 'tv-adv',
    code: 'TV-ADV',
    title: 'HashiCorp Certified: Vault Operations Advanced',
    level: 'Advanced',
    status: 'active',
    description:
      'Lab-based and multiple-choice assessment of deploying, operating, securing and troubleshooting Vault clusters in production.',
    topics: ['Cluster Operations', 'Replication', 'Hardening', 'Hands-on Labs'],
    hours: 60,
    prepTime: '~4 months',
    featured: false,
    learnUrl: 'https://developer.hashicorp.com/certifications/security-automation',
  },
  {
    id: 'tc-003',
    slug: 'tc-003',
    code: 'TC-003',
    title: 'HashiCorp Certified: Consul Associate (003)',
    level: 'Associate',
    status: 'retired',
    retiredDate: '2026-07-15',
    description:
      'Retired by HashiCorp on July 15, 2026 with no successor exam. Existing credentials keep their two-year validity.',
    topics: ['Service Mesh', 'KV Store', 'Health Checks', 'ACLs'],
    hours: 20,
    prepTime: '~5 weeks',
    featured: false,
    learnUrl: 'https://developer.hashicorp.com/certifications',
  },
];
