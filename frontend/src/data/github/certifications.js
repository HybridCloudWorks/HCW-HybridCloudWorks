/**
 * GitHub certification catalogue for /github/education (#461).
 *
 * Verified 2026-09-09 against each certification's Microsoft Learn page — the
 * exam code is the `examUid=exam.GH-xxx` in its "Schedule exam" link:
 *   GH-900 Foundations, GH-100 Administration, GH-200 Actions,
 *   GH-300 Copilot, GH-500 Advanced Security, GH-600 Agentic AI Developer.
 * Before this file existed the page carried GH-100 as Foundations, GH-300 as
 * Advanced Security and GH-500 as Administration, and had no GH-900 or
 * Copilot at all.
 *
 * RE-VERIFIED 2026-09-09 (#469 item 1). GitHub now publishes SIX, and the
 * sixth was missing here:
 *
 *   GH-600 GitHub Certified: Agentic AI Developer — 120 minutes, $165 USD,
 *     English, proctored, with two Microsoft Learn paths as the
 *     recommended prep route.
 *     https://learn.microsoft.com/en-us/credentials/certifications/agentic-ai-developer/
 *
 * RE-VERIFIED 2026-09-10 (#469) against the `DATA_SOURCE` browse listing and
 * each certification's own Microsoft Learn page, re-reading the
 * `examUid=exam.GH-xxx` in every "Schedule exam" link. All six codes still sit
 * on the titles above, still SIX, and nothing is retired. Two things were
 * checked because they looked like they might have moved, and had not:
 *
 *   GH-100 is NOT in beta. A stale cache of its Learn page still titles it
 *     "GitHub Administration (beta)" and carries the eight-weeks-for-results
 *     notice; the live page is titled "GitHub Administration", was last
 *     updated 05/04/2026, and has no beta notice. It is English only, $99.
 *     https://learn.microsoft.com/en-us/credentials/certifications/github-administration/
 *   GH-500 is NOT retired. It is absent from the tile list at
 *     `learn.github.com/credentials`, which shows only the other five — but
 *     its Learn page is live (updated 05/04/2026, $99, five languages) and
 *     its study guide took a significant objectives revision in July 2026.
 *     An omission from a marketing page is not a retirement.
 *     https://learn.microsoft.com/en-us/credentials/certifications/github-advanced-security/
 *
 * GH-600's numbers were re-read at the source and are unchanged: 120 minutes,
 * $165 USD. Microsoft titles it "GitHub Certified: Agentic AI Developer"; the
 * short form here is deliberate and `education-catalogues.test.js` pins it.
 *
 * Worth knowing for the next pass: `docs.github.com`'s "About GitHub
 * Certifications" page still lists only five and does not mention GH-600, so
 * it is NOT a usable source for the set. `learn.github.com/credentials` is
 * not one either — as of this pass it drops GH-500. Read the source this file
 * names, not the one that is easiest to find.
 *
 * `status` and any dates are read through `@/lib/certStatus` at render time;
 * `src/data/education-catalogues.test.js` fails when a dated row is past.
 */
export const DATA_AS_OF = '2026-09-10';

export const DATA_SOURCE = {
  label: 'Microsoft Learn GitHub certifications',
  url: 'https://learn.microsoft.com/en-us/credentials/browse/?products=github&credential_types=certification',
};

export const certifications = [
  {
    id: 'gh-900',
    slug: 'gh-900',
    code: 'GH-900',
    title: 'GitHub Foundations',
    level: 'Foundations',
    status: 'active',
    description:
      'Demonstrate foundational knowledge of Git, GitHub repositories, collaboration workflows, issues, and project management.',
    topics: ['Git', 'Repos', 'Collaboration', 'PRs', 'Issues', 'Projects'],
    hours: 20,
    prepTime: '~4 weeks',
    featured: false,
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/github-foundations/',
  },
  {
    id: 'gh-200',
    slug: 'gh-200',
    code: 'GH-200',
    title: 'GitHub Actions',
    level: 'Associate',
    status: 'active',
    description:
      'Automate workflows, manage runners, secure secrets, build matrices, and handle artifacts with GitHub Actions.',
    topics: ['Workflows', 'Runners', 'Secrets', 'Matrices', 'Artifacts'],
    hours: 30,
    prepTime: '~6 weeks',
    featured: true,
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/github-actions/',
  },
  {
    id: 'gh-300',
    slug: 'gh-300',
    code: 'GH-300',
    title: 'GitHub Copilot',
    level: 'Associate',
    status: 'active',
    description:
      'Use GitHub Copilot responsibly and effectively — prompt engineering, context crafting, privacy safeguards, and productivity across plans and IDEs.',
    topics: ['Responsible AI', 'Prompt Engineering', 'Copilot Features', 'Privacy'],
    hours: 25,
    prepTime: '~5 weeks',
    featured: false,
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/github-copilot/',
  },
  {
    id: 'gh-500',
    slug: 'gh-500',
    code: 'GH-500',
    title: 'GitHub Advanced Security',
    level: 'Professional',
    status: 'active',
    description:
      'Secure code, secrets, and dependencies with secret protection, supply chain security, code security with CodeQL, and security operations.',
    topics: ['CodeQL', 'Secret Protection', 'Supply Chain', 'Security Ops'],
    hours: 40,
    prepTime: '~8 weeks',
    featured: false,
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/certifications/github-advanced-security/',
  },
  {
    id: 'gh-100',
    slug: 'gh-100',
    code: 'GH-100',
    title: 'GitHub Administration',
    level: 'Professional',
    status: 'active',
    description:
      'Administer GitHub Enterprise Cloud and Server — identities and access, enterprise governance, GitHub Actions at scale, secure development, and usage monitoring.',
    topics: ['Enterprise', 'Identity & Access', 'Governance', 'Actions', 'Monitoring'],
    hours: 35,
    prepTime: '~8 weeks',
    featured: false,
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/github-administration/',
  },
  {
    id: 'gh-600',
    slug: 'gh-600',
    code: 'GH-600',
    title: 'GitHub Agentic AI Developer',
    level: 'Associate',
    status: 'active',
    description:
      'Build and operate agentic AI systems on GitHub — designing agent workflows, wiring tools and context, and evaluating and shipping them responsibly. 120 minutes, $165, English, proctored.',
    topics: [
      'Agentic Workflows',
      'Tool Use',
      'Context Engineering',
      'Evaluation',
      'Responsible AI',
    ],
    hours: 25,
    prepTime: '~5 weeks',
    featured: false,
    learnUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/agentic-ai-developer/',
  },
];
