/**
 * The content types on offer and the schema section templates for each.
 *
 * Data, not behaviour: the templates are what Stage 4's section buttons insert
 * and what the readiness checklist looks for.
 */

/**
 * One section block, built from its title.
 *
 * `heading` and the template's first line are DERIVED rather than repeated,
 * because the readiness checklist matches a section by its HEADING while the
 * button that inserts it is labelled by its TITLE. Written out separately, an
 * edit to one that missed the other would quietly stop the checklist finding a
 * section the operator can plainly see in the draft, and the draft could never
 * be marked ready.
 *
 * All twenty entries already held that invariant. This makes it unbreakable,
 * and removes the four similar-code findings Qlty raised on this file.
 */
const block = (key, title, prose, required = false) => ({
  key,
  title,
  heading: `## ${title}`,
  template: `## ${title}\n\n${prose}\n`,
  required,
});

export const CONTENT_TYPE_OPTIONS = [
  { value: 'blog', label: 'Blog' },
  { value: 'framework', label: 'Framework' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'coder_corner', label: 'Coder Corner' },
];

export const SECTION_BLOCKS_BY_TYPE = {
  blog: [
    block(
      'overview',
      'Overview',
      'Explain the business context, current pain point, and why this matters now.',
      true
    ),
    block(
      'architecture',
      'Architecture Approach',
      'Describe the high-level architecture, major components, and data flow.',
      true
    ),
    block(
      'implementation',
      'Implementation Steps',
      '1. Step one\n2. Step two\n3. Step three',
      true
    ),
    block(
      'ops',
      'Operations and Risk',
      'Call out observability, cost impact, security, and rollout risks.'
    ),
    block(
      'next-steps',
      'Next Steps',
      'Summarize recommended actions and what teams should do next.'
    ),
  ],
  framework: [
    block(
      'problem',
      'Problem Statement',
      'Describe the challenge this framework addresses and expected outcomes.',
      true
    ),
    block(
      'principles',
      'Guiding Principles',
      'List the principles, guardrails, and design constraints.',
      true
    ),
    block(
      'framework-model',
      'Framework Model',
      'Define phases, domains, or pillars and how teams apply them.',
      true
    ),
    block(
      'implementation-roadmap',
      'Implementation Roadmap',
      'Describe rollout stages, ownership, and milestones.'
    ),
    block(
      'measurement',
      'Measurement and Governance',
      'Define KPIs, review cadence, and governance checkpoints.'
    ),
  ],
  architecture: [
    block(
      'context',
      'Context and Requirements',
      'Capture business goals, technical constraints, and non-functional requirements.',
      true
    ),
    block(
      'system-design',
      'System Design',
      'Describe the architecture, key services, boundaries, and data flow.',
      true
    ),
    block(
      'deployment',
      'Deployment and Operations',
      'Explain deployment model, observability, resilience, and operations runbook.',
      true
    ),
    block(
      'security',
      'Security and Compliance',
      'Document threat model, controls, and compliance considerations.'
    ),
    block(
      'trade-offs',
      'Trade-offs and Decisions',
      'Call out key decisions, trade-offs, and alternatives considered.'
    ),
  ],
  coder_corner: [
    block(
      'problem',
      'Problem and Use Case',
      'Describe the developer problem, expected audience, and when this pattern should be used.',
      true
    ),
    block(
      'solution',
      'Solution Overview',
      'Explain the approach, key components, and why this solution is effective.',
      true
    ),
    block(
      'implementation',
      'Implementation Walkthrough',
      '1. Set up prerequisites\n2. Implement the core logic\n3. Validate the outcome',
      true
    ),
    block(
      'code-notes',
      'Code Notes',
      'Call out the most important code paths, trade-offs, and extension points.'
    ),
    block(
      'testing',
      'Testing and Next Steps',
      'Describe validation steps, known gaps, and logical next improvements.'
    ),
  ],
};
