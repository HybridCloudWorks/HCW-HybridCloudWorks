/**
 * The content types on offer and the schema section templates for each.
 *
 * Data, not behaviour: the templates are what Stage 4's section buttons insert
 * and what the readiness checklist looks for, so the headings here and the
 * `required` flags are the contract between those two.
 */
export const CONTENT_TYPE_OPTIONS = [
  { value: 'blog', label: 'Blog' },
  { value: 'framework', label: 'Framework' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'coder_corner', label: 'Coder Corner' },
];

export const SECTION_BLOCKS_BY_TYPE = {
  blog: [
    {
      key: 'overview',
      title: 'Overview',
      heading: '## Overview',
      template:
        '## Overview\n\nExplain the business context, current pain point, and why this matters now.\n',
      required: true,
    },
    {
      key: 'architecture',
      title: 'Architecture Approach',
      heading: '## Architecture Approach',
      template:
        '## Architecture Approach\n\nDescribe the high-level architecture, major components, and data flow.\n',
      required: true,
    },
    {
      key: 'implementation',
      title: 'Implementation Steps',
      heading: '## Implementation Steps',
      template: '## Implementation Steps\n\n1. Step one\n2. Step two\n3. Step three\n',
      required: true,
    },
    {
      key: 'ops',
      title: 'Operations and Risk',
      heading: '## Operations and Risk',
      template:
        '## Operations and Risk\n\nCall out observability, cost impact, security, and rollout risks.\n',
      required: false,
    },
    {
      key: 'next-steps',
      title: 'Next Steps',
      heading: '## Next Steps',
      template: '## Next Steps\n\nSummarize recommended actions and what teams should do next.\n',
      required: false,
    },
  ],
  framework: [
    {
      key: 'problem',
      title: 'Problem Statement',
      heading: '## Problem Statement',
      template:
        '## Problem Statement\n\nDescribe the challenge this framework addresses and expected outcomes.\n',
      required: true,
    },
    {
      key: 'principles',
      title: 'Guiding Principles',
      heading: '## Guiding Principles',
      template:
        '## Guiding Principles\n\nList the principles, guardrails, and design constraints.\n',
      required: true,
    },
    {
      key: 'framework-model',
      title: 'Framework Model',
      heading: '## Framework Model',
      template:
        '## Framework Model\n\nDefine phases, domains, or pillars and how teams apply them.\n',
      required: true,
    },
    {
      key: 'implementation-roadmap',
      title: 'Implementation Roadmap',
      heading: '## Implementation Roadmap',
      template:
        '## Implementation Roadmap\n\nDescribe rollout stages, ownership, and milestones.\n',
      required: false,
    },
    {
      key: 'measurement',
      title: 'Measurement and Governance',
      heading: '## Measurement and Governance',
      template:
        '## Measurement and Governance\n\nDefine KPIs, review cadence, and governance checkpoints.\n',
      required: false,
    },
  ],
  architecture: [
    {
      key: 'context',
      title: 'Context and Requirements',
      heading: '## Context and Requirements',
      template:
        '## Context and Requirements\n\nCapture business goals, technical constraints, and non-functional requirements.\n',
      required: true,
    },
    {
      key: 'system-design',
      title: 'System Design',
      heading: '## System Design',
      template:
        '## System Design\n\nDescribe the architecture, key services, boundaries, and data flow.\n',
      required: true,
    },
    {
      key: 'deployment',
      title: 'Deployment and Operations',
      heading: '## Deployment and Operations',
      template:
        '## Deployment and Operations\n\nExplain deployment model, observability, resilience, and operations runbook.\n',
      required: true,
    },
    {
      key: 'security',
      title: 'Security and Compliance',
      heading: '## Security and Compliance',
      template:
        '## Security and Compliance\n\nDocument threat model, controls, and compliance considerations.\n',
      required: false,
    },
    {
      key: 'trade-offs',
      title: 'Trade-offs and Decisions',
      heading: '## Trade-offs and Decisions',
      template:
        '## Trade-offs and Decisions\n\nCall out key decisions, trade-offs, and alternatives considered.\n',
      required: false,
    },
  ],
  coder_corner: [
    {
      key: 'problem',
      title: 'Problem and Use Case',
      heading: '## Problem and Use Case',
      template:
        '## Problem and Use Case\n\nDescribe the developer problem, expected audience, and when this pattern should be used.\n',
      required: true,
    },
    {
      key: 'solution',
      title: 'Solution Overview',
      heading: '## Solution Overview',
      template:
        '## Solution Overview\n\nExplain the approach, key components, and why this solution is effective.\n',
      required: true,
    },
    {
      key: 'implementation',
      title: 'Implementation Walkthrough',
      heading: '## Implementation Walkthrough',
      template:
        '## Implementation Walkthrough\n\n1. Set up prerequisites\n2. Implement the core logic\n3. Validate the outcome\n',
      required: true,
    },
    {
      key: 'code-notes',
      title: 'Code Notes',
      heading: '## Code Notes',
      template:
        '## Code Notes\n\nCall out the most important code paths, trade-offs, and extension points.\n',
      required: false,
    },
    {
      key: 'testing',
      title: 'Testing and Next Steps',
      heading: '## Testing and Next Steps',
      template:
        '## Testing and Next Steps\n\nDescribe validation steps, known gaps, and logical next improvements.\n',
      required: false,
    },
  ],
};
