/**
 * The seed programs (ADR 0033 §4): seven community programs materialised on
 * the first read of an empty container. Every field is editable afterwards;
 * the requirements are sensible starting points and say so, because each
 * program publishes its own rules and changes them.
 */

const EDIT_NOTE = 'Edit to match the current program rules.';

/** One requirement row; the rule object is what the readiness arithmetic reads. */
const requirement = (id, label, description, { evidenceTypes, minCount, weight }) => ({
  id,
  label,
  description,
  evidenceTypes,
  minCount,
  weight,
});

export const DEFAULT_PROGRAMS = Object.freeze([
  {
    id: 'program-microsoft-mvp',
    name: 'Microsoft MVP',
    provider: 'Microsoft',
    category: 'community-expert',
    description:
      'Microsoft Most Valuable Professional: recognises exceptional technical community leadership over the previous twelve months. Nomination by a Microsoft employee or an existing MVP.',
    applicationUrl: 'https://mvp.microsoft.com/',
    eligibility: [
      'Nominated by a Microsoft full-time employee or a current MVP',
      'Community contributions in the twelve months before review',
      'Not a Microsoft employee',
    ],
    criteria: ['Impact', 'Quality', 'Breadth', 'Technical expertise'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Rolling nominations; reviewed monthly.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Award year runs 1 July to 30 June; renewal reviews the prior year.',
    requirements: [
      requirement(
        'talks',
        'Speaking engagements',
        `Sessions delivered at conferences, user groups or online events. ${EDIT_NOTE}`,
        { evidenceTypes: ['speaking'], minCount: 4, weight: 3 }
      ),
      requirement(
        'articles',
        'Published content',
        `Articles, tutorials or documentation published publicly. ${EDIT_NOTE}`,
        { evidenceTypes: ['content', 'newsletter'], minCount: 6, weight: 3 }
      ),
      requirement(
        'depth',
        'Technical depth',
        `Certifications or labs that evidence depth in the award category. ${EDIT_NOTE}`,
        { evidenceTypes: ['certifications', 'labs'], minCount: 1, weight: 1 }
      ),
      requirement(
        'reach',
        'Audio and video',
        `Podcast episodes, recordings or Listen & Learn chapters. ${EDIT_NOTE}`,
        { evidenceTypes: ['listen-and-learn'], minCount: 2, weight: 1 }
      ),
    ],
    recommendedActivities: [
      'Speak at two or more community events a quarter',
      'Publish one article a month on the award technology',
      'Keep every contribution dated and linked',
    ],
  },
  {
    id: 'program-microsoft-mct',
    name: 'Microsoft Certified Trainer',
    provider: 'Microsoft',
    category: 'training',
    description:
      'MCT: the premier technical and instructional experts on Microsoft technologies. Requires a qualifying certification and instructional experience.',
    applicationUrl: 'https://learn.microsoft.com/credentials/certifications/mct-certification',
    eligibility: [
      'Hold at least one qualifying Microsoft certification',
      'Demonstrate instructional skills (certification or verified experience)',
      'Pay the annual program fee',
    ],
    criteria: ['Qualifying certification', 'Instructional competence'],
    applicationWindow: { opens: null, closes: null, note: 'Apply any time; renew annually.' },
    renewalCadence: 'annual',
    expirationRule: 'Expires one year from enrolment unless renewed.',
    requirements: [
      requirement(
        'cert',
        'Qualifying certification',
        `An active, qualifying Microsoft certification. ${EDIT_NOTE}`,
        { evidenceTypes: ['certifications'], minCount: 1, weight: 4 }
      ),
      requirement(
        'teaching',
        'Instructional evidence',
        `Delivered training, workshops or sessions. ${EDIT_NOTE}`,
        { evidenceTypes: ['speaking', 'listen-and-learn'], minCount: 2, weight: 2 }
      ),
    ],
    recommendedActivities: [
      'Renew the qualifying certification before it lapses',
      'Record delivered workshops as evidence',
    ],
  },
  {
    id: 'program-aws-community-hero',
    name: 'AWS Community Hero',
    provider: 'AWS',
    category: 'community-expert',
    description:
      'AWS Heroes: recognises individuals with an outsized impact on the AWS community through content, speaking and mentorship. By invitation.',
    applicationUrl: 'https://aws.amazon.com/developer/community/heroes/',
    eligibility: [
      'Sustained AWS community contributions',
      'Nominated by AWS or an existing Hero',
      'Not an AWS employee',
    ],
    criteria: ['Community impact', 'Consistency', 'Expertise'],
    applicationWindow: { opens: null, closes: null, note: 'Invitation only; no open application.' },
    renewalCadence: 'ongoing',
    expirationRule: 'Reviewed on an ongoing basis.',
    requirements: [
      requirement('talks', 'AWS talks', `Sessions on AWS topics. ${EDIT_NOTE}`, {
        evidenceTypes: ['speaking'],
        minCount: 4,
        weight: 3,
      }),
      requirement('content', 'AWS content', `Articles and tutorials on AWS. ${EDIT_NOTE}`, {
        evidenceTypes: ['content', 'newsletter'],
        minCount: 6,
        weight: 3,
      }),
      requirement('certs', 'AWS certifications', `Active AWS certifications. ${EDIT_NOTE}`, {
        evidenceTypes: ['certifications'],
        minCount: 2,
        weight: 1,
      }),
    ],
    recommendedActivities: [
      'Lead or speak at an AWS user group',
      'Publish re:Invent recap and deep-dive content',
    ],
  },
  {
    id: 'program-aws-ambassador',
    name: 'AWS Ambassador',
    provider: 'AWS',
    category: 'partner',
    description:
      'AWS Ambassador Program: for technical experts at AWS Partner Network organisations who share AWS knowledge publicly.',
    applicationUrl: 'https://aws.amazon.com/partners/ambassadors/',
    eligibility: [
      'Employed by an AWS Partner Network organisation',
      'Hold AWS Professional or Specialty certifications',
      'Public AWS content and speaking',
    ],
    criteria: ['Certifications', 'Public contributions', 'Partner standing'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Rolling, through the partner organisation.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Annual requalification against the published point thresholds.',
    requirements: [
      requirement(
        'certs',
        'Professional or Specialty certifications',
        `Active AWS Professional or Specialty certifications. ${EDIT_NOTE}`,
        { evidenceTypes: ['certifications'], minCount: 2, weight: 3 }
      ),
      requirement('talks', 'Public speaking', `Sessions on AWS. ${EDIT_NOTE}`, {
        evidenceTypes: ['speaking'],
        minCount: 2,
        weight: 2,
      }),
      requirement(
        'content',
        'Public content',
        `Articles, blogs, open source or videos. ${EDIT_NOTE}`,
        { evidenceTypes: ['content', 'newsletter', 'listen-and-learn'], minCount: 4, weight: 2 }
      ),
    ],
    recommendedActivities: [
      'Track the annual point total against the current thresholds',
      'Renew certifications ahead of the requalification date',
    ],
  },
  {
    id: 'program-github-star',
    name: 'GitHub Star',
    provider: 'GitHub',
    category: 'community-expert',
    description:
      'GitHub Stars: recognises developers who inspire and educate the community, through open source, content and events. Nomination based.',
    applicationUrl: 'https://stars.github.com/',
    eligibility: [
      'Nominated through the GitHub Stars site',
      'Public, sustained community contribution',
      'Not a GitHub or Microsoft employee',
    ],
    criteria: ['Inspiration', 'Education', 'Open source leadership'],
    applicationWindow: { opens: null, closes: null, note: 'Nominations open year-round.' },
    renewalCadence: 'annual',
    expirationRule: 'Reviewed annually.',
    requirements: [
      requirement(
        'content',
        'Educational content',
        `Articles, videos or courses on GitHub and developer workflow. ${EDIT_NOTE}`,
        { evidenceTypes: ['content', 'listen-and-learn', 'newsletter'], minCount: 6, weight: 3 }
      ),
      requirement('talks', 'Community talks', `Sessions and workshops. ${EDIT_NOTE}`, {
        evidenceTypes: ['speaking'],
        minCount: 3,
        weight: 2,
      }),
      requirement(
        'labs',
        'Open source and labs',
        `Repositories, labs and hands-on material. ${EDIT_NOTE}`,
        { evidenceTypes: ['labs', 'manual'], minCount: 2, weight: 2 }
      ),
    ],
    recommendedActivities: [
      'Maintain public repositories with clear READMEs',
      'Publish GitHub Actions and Copilot walkthroughs',
    ],
  },
  {
    id: 'program-docker-captain',
    name: 'Docker Captain',
    provider: 'Docker',
    category: 'community-expert',
    description:
      'Docker Captains: technology experts and leaders in the Docker community who share their knowledge. Selected by Docker.',
    applicationUrl: 'https://www.docker.com/community/captains/',
    eligibility: [
      'Demonstrated Docker expertise',
      'Regular public Docker content or speaking',
      'Not a Docker employee',
    ],
    criteria: ['Expertise', 'Community sharing', 'Consistency'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Selection by Docker; express interest through the program page.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Reviewed annually.',
    requirements: [
      requirement('content', 'Docker content', `Articles and guides on Docker. ${EDIT_NOTE}`, {
        evidenceTypes: ['content', 'newsletter'],
        minCount: 4,
        weight: 3,
      }),
      requirement('talks', 'Docker talks', `Sessions on containers and Docker. ${EDIT_NOTE}`, {
        evidenceTypes: ['speaking'],
        minCount: 2,
        weight: 2,
      }),
      requirement(
        'labs',
        'Hands-on material',
        `Labs, repositories, Compose examples. ${EDIT_NOTE}`,
        { evidenceTypes: ['labs', 'manual'], minCount: 2, weight: 1 }
      ),
    ],
    recommendedActivities: [
      'Publish Docker Desktop and image-building guides',
      'Speak at a Docker community event',
    ],
  },
  {
    id: 'program-vmware-vexpert',
    name: 'VMware vExpert',
    provider: 'Broadcom (VMware)',
    category: 'community-expert',
    description:
      'vExpert: recognises VMware community contributors — bloggers, speakers, book authors and community leaders — through an annual application.',
    applicationUrl: 'https://vexpert.vmware.com/',
    eligibility: [
      'Public VMware community contributions in the prior year',
      'Application in the annual window',
      'Any employer',
    ],
    criteria: ['Evangelist path', 'Customer path', 'Partner path'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Annual window, usually opening in the first quarter.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Calendar-year award; apply again each cycle.',
    requirements: [
      requirement(
        'content',
        'VMware content',
        `Blog posts, podcasts and videos on VMware. ${EDIT_NOTE}`,
        { evidenceTypes: ['content', 'listen-and-learn', 'newsletter'], minCount: 6, weight: 3 }
      ),
      requirement('talks', 'VMware talks', `VMUG and conference sessions. ${EDIT_NOTE}`, {
        evidenceTypes: ['speaking'],
        minCount: 2,
        weight: 2,
      }),
      requirement('certs', 'VMware certifications', `Active VMware certifications. ${EDIT_NOTE}`, {
        evidenceTypes: ['certifications'],
        minCount: 1,
        weight: 1,
      }),
    ],
    recommendedActivities: [
      'Apply in the annual window',
      'Keep a dated log of VMUG sessions and posts',
    ],
  },
]);
